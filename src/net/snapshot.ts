import { CONTRIB_KEYS, contribution } from '../sim/contrib';
import { PING_KINDS } from '../sim/ping';
import type { NationId } from '../config/nations';
import { NATION_IDS } from '../config/nations';
import type { AiState } from '../ai/memory';
import type { MeetingState, MeetingView, MeetingZone } from '../meeting/meetingSystem';
import { teleport } from '../sim/entity';
import type { GameEvent } from '../sim/events';
import type { GameState, SquadOrder } from '../sim/state';

/**
 * Online matches: the host runs the simulation and shares what everyone needs to
 * draw the match as a compact snapshot (about 10 a second). Friends' devices keep
 * a mirror GameState filled from it, so the HUD, minimap and 3D view work as
 * they do offline. Everything here is plain data (JSON-safe) and never trusted
 * beyond drawing: a device only ever controls its own character.
 */

const AI_STATES: AiState[] = ['PATROL', 'INVESTIGATE', 'CHASE', 'INTERCEPT', 'SEARCH', 'GUARD', 'ESCORT', 'RESCUE', 'FLEE', 'HOLD', 'SQUAD'];
const ORDERS: SquadOrder[] = ['follow', 'spread', 'hold'];
/** Bytes per character in the packed entity table. */
export const ENTITY_BYTES = 20;
/** Presence strings must stay under 1 KiB each: the table is split into chunks. */
const CHUNK = 960;
/** Recent events kept in each snapshot (a device that misses more loses log lines only). */
const EVENT_WINDOW = 16;

export interface NetEvent {
  /** Sequence number, increasing through the match. */
  s: number;
  e: GameEvent;
}

/** One nation's view of an open meeting, as sent to its people. */
export interface NetMeeting {
  /** Index of the first line in `l` (older lines were sent before). */
  o: number;
  l: string[];
  c: string[];
  z: [string, number, number][];
}

export interface Snapshot {
  v: 1;
  /** Game time (ms). */
  t: number;
  /** Globals: see `packGlobals`. */
  g: number[];
  /** Packed entity table (base64 chunks). */
  e: string[];
  /** Per-person numbers: [id, capture cd ×10, special cd ×10, meetings left, captures, rescues, king hits, king captures, king rescues, tower time ×10, squad order, eliminated at ×10 (-1 = no)]. */
  h: number[][];
  ev: NetEvent[];
  /** The war: per sector [owner, capturer, gauge %, contested, sun, moon, star on the point]; ceasefires [a, b, until]; ceasefires held. */
  w?: { s: number[][]; t: [number, number, number][]; n: number };
  /** 貢献度 at the end of the match: everyone's total, and the full row (CONTRIB_KEYS order, ×10) for each person playing. */
  ct?: { tot: number[]; rows: Record<number, number[]> };
  /** Pings: [id, nation, by, kind, x, y, z, placed at]. */
  pg?: number[][];
  /** Open meeting: its kind (0 emergency, 1 scheduled) and each nation's view. */
  m?: { k: number; n: Partial<Record<NationId, NetMeeting>> };
}

const nIdx = (n: NationId | null) => (n ? NATION_IDS.indexOf(n) : -1);
const nAt = (i: number): NationId | null => NATION_IDS[i] ?? null;
const fin = (v: number) => (Number.isFinite(v) ? Math.round(v) : -1);
const unfin = (v: number) => (v < 0 ? Infinity : v);

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function packEntities(state: GameState): string[] {
  const buf = new Uint8Array(state.entities.length * ENTITY_BYTES);
  const dv = new DataView(buf.buffer);
  const now = state.time;
  const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
  const u8 = (v: number | null) => (v === null ? 255 : Math.max(0, Math.min(254, v)));
  for (const e of state.entities) {
    const o = e.id * ENTITY_BYTES;
    dv.setInt16(o, clamp16(e.x));
    dv.setInt16(o + 2, clamp16(e.y * 2));
    dv.setInt16(o + 4, clamp16(e.z));
    const yaw = Math.atan2(e.dirX, e.dirZ);
    buf[o + 6] = Math.round(((yaw + Math.PI) / (2 * Math.PI)) * 256) & 255;
    dv.setInt8(o + 7, Math.max(-127, Math.min(127, Math.round(e.speed / 5))));
    const fake = e.fakeUntil > now && e.fakeNation !== null;
    buf[o + 8] = (e.alive ? 1 : 0) | (e.jailed ? 2 : 0) | (e.dashing ? 4 : 0) | (e.revealUntil > now ? 8 : 0)
      | (fake ? 16 : 0) | (e.channeling ? 32 : 0) | (e.remote || e.isPlayer ? 64 : 0) | (e.sprintUntil > now ? 128 : 0);
    buf[o + 9] = (fake ? nIdx(e.fakeNation) & 3 : 0) | ((e.hp & 3) << 2) | ((e.tp & 15) << 4);
    buf[o + 10] = Math.min(255, Math.max(0, Math.ceil((e.stunUntil - now) / 100)));
    buf[o + 11] = Math.max(0, Math.min(255, Math.round(e.susp)));
    buf[o + 12] = Math.max(0, AI_STATES.indexOf(e.ai.state));
    buf[o + 13] = u8(e.ai.targetId);
    buf[o + 14] = u8(e.ai.leaderId);
    buf[o + 15] = u8(e.ai.aimId);
    buf[o + 16] = e.channeling ? Math.round((e.channeling.prog / e.channeling.need) * 100) : 0;
    buf[o + 17] = e.capturedBy ? nIdx(e.capturedBy) + 1 : 0;
    dv.setUint16(o + 18, Math.max(0, Math.min(65535, Math.round(e.jailedAt / 100))));
  }
  const b64 = toBase64(buf), out: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK) out.push(b64.slice(i, i + CHUNK));
  return out;
}

/**
 * Globals: [tower owner, radar ×3, radar (all), terminal ×3, jail reveal ×3, rescue alert ×3,
 * speed boost until, next meeting at, meetings held, winner (-1 none, 3 draw), over,
 * team focus ×3 (x, z, t; t -1 = none), nation stats ×3 (cap, res, tower, hit), king beacon ×3 (until, ready at)].
 */
function packGlobals(state: GameState): number[] {
  const g: number[] = [nIdx(state.tower.owner)];
  for (const n of NATION_IDS) g.push(fin(state.radar[n]));
  g.push(fin(state.radarAll));
  for (const n of NATION_IDS) g.push(fin(state.terminalActive[n]));
  for (const n of NATION_IDS) g.push(fin(state.jailReveal[n]));
  for (const n of NATION_IDS) g.push(fin(state.rescueUntil[n]));
  g.push(fin(state.speedBoostUntil), fin(state.nextMeetingAt), state.meetingsHeld);
  g.push(state.winner === 'draw' ? 3 : nIdx(state.winner), state.over ? 1 : 0);
  for (const n of NATION_IDS) {
    const f = state.teamFocus[n];
    g.push(f ? Math.round(f.x) : 0, f ? Math.round(f.z) : 0, f ? fin(f.t) : -1);
  }
  for (const n of NATION_IDS) {
    const s = state.natStats[n];
    g.push(s.cap, s.res, Math.round(s.tower * 10), s.hit);
  }
  for (const n of NATION_IDS) g.push(fin(state.kingBeacon[n]), fin(state.beaconReadyAt[n]));
  for (const n of NATION_IDS) { const d = state.decoy[n]; g.push(d ? d.id : -1, d ? fin(d.until) : 0, state.decoyUsed[n] ? 1 : 0); }
  return g;
}

function packMeeting(state: GameState): Snapshot['m'] {
  const m = state.meeting;
  if (!m) return undefined;
  const view = (v: MeetingView): NetMeeting => ({
    o: Math.max(0, v.lines.length - 10),
    l: v.lines.slice(-10).map((s) => s.slice(0, 120)),
    c: v.choices,
    z: v.zones.map((z) => [z.label.slice(0, 60), Math.round(z.x), Math.round(z.z)]),
  });
  const n: Partial<Record<NationId, NetMeeting>> = {};
  const wanted = new Set(state.humans.map((id) => state.entities[id]).filter((e) => e.remote).map((e) => e.nation));
  for (const nation of wanted) {
    const v = nation === state.player.nation ? m : m.others[nation];
    if (v) n[nation] = view(v);
  }
  return { k: m.kind === 'scheduled' ? 1 : 0, n };
}

/** The host's snapshot of the match. `events` is the recent-event window. */
export function encodeSnapshot(state: GameState, events: NetEvent[]): Snapshot {
  const h = state.humans.map((id) => {
    const e = state.entities[id];
    const order = e.isPlayer ? state.squadOrder : state.humanOrders[id]?.order ?? 'follow';
    return [id, Math.round(e.cd.capture * 10), Math.round(e.cd.special * 10), e.meetingsLeft, e.capturesMade, e.rescuesMade,
      e.kingHits, e.kingCaptures, e.kingRescues, Math.round(e.towerTime * 10), ORDERS.indexOf(order), e.eliminatedAt === null ? -1 : Math.round(e.eliminatedAt * 10)];
  });
  // Nobody moves during a meeting: the character table is left out to make room for the talk.
  const snap: Snapshot = { v: 1, t: Math.round(state.time), g: packGlobals(state), e: state.meeting ? [] : packEntities(state), h, ev: events.slice(-EVENT_WINDOW) };
  const m = packMeeting(state);
  if (m) snap.m = m;
  snap.w = {
    s: state.war.sectors.map((x) => [nIdx(x.owner), nIdx(x.capturer), Math.round(x.progress * 100), x.contested ? 1 : 0, x.count.sun, x.count.moon, x.count.star]),
    t: state.war.truces.map((t) => [nIdx(t.a), nIdx(t.b), Math.round(t.until)]),
    n: state.war.trucesHeld,
  };
  if (state.over) {
    // The match is over: nobody moves, so the character table makes way for the result.
    snap.e = [];
    snap.ct = {
      tot: state.entities.map((e) => contribution(state, e).total),
      rows: Object.fromEntries(state.humans.map((id) => [id, CONTRIB_KEYS.map((k) => Math.round(state.contrib.table[id][k] * 10))])),
    };
  }
  if (state.pings.length) snap.pg = state.pings.map((p) => [p.id, nIdx(p.nation), p.by, PING_KINDS.indexOf(p.kind), Math.round(p.x), Math.round(p.y), Math.round(p.z), Math.round(p.t)]);
  return snap;
}

/** Keeps a snapshot within the presence budget: drops old events, then meeting lines. */
export function fitSnapshot(snap: Snapshot, maxBytes: number, extraBytes = 0): Snapshot {
  const size = () => new TextEncoder().encode(JSON.stringify(snap)).length + extraBytes;
  while (size() > maxBytes && snap.ev.length) snap.ev = snap.ev.slice(1);
  if (snap.m) {
    for (const v of Object.values(snap.m.n)) {
      while (size() > maxBytes && v && v.l.length > 3) { v.l.shift(); v.o++; }
    }
  }
  return snap;
}

/** Where the host last put another character; the mirror eases toward it. */
interface Target {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  /** Real time (ms) the snapshot arrived. */
  at: number;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * A friend's device: fills its mirror GameState from the host's snapshots and
 * moves other characters smoothly between them. The device's own character is
 * moved locally (no lag) and only reset when the host teleports it.
 */
export class Mirror {
  private targets = new Map<number, Target>();
  private lastT = -1;
  lastEventSeq = -1;

  /**
   * Applies a snapshot (ignored if older than the last one). Returns the new
   * events in order, and whether the host moved this device's character.
   */
  apply(state: GameState, snap: Snapshot, nowMs: number): { events: GameEvent[]; teleported: boolean } | null {
    if (!snap || snap.v !== 1 || !Array.isArray(snap.e) || num(snap.t, -1) < this.lastT) return null;
    this.lastT = snap.t;
    state.time = snap.t;
    let bytes: Uint8Array;
    try { bytes = fromBase64(snap.e.join('')); } catch { return null; }
    // An empty table (during a meeting) leaves everyone where they are.
    if (bytes.length && bytes.length !== state.entities.length * ENTITY_BYTES) return null;
    this.applyGlobals(state, Array.isArray(snap.g) ? snap.g : []);
    const teleported = bytes.length ? this.applyEntities(state, bytes, nowMs) : false;
    this.applyHumans(state, Array.isArray(snap.h) ? snap.h : []);
    this.applyMeeting(state, snap.m);
    this.applyWar(state, snap.w);
    if (snap.ct) {
      state.contrib.totals = snap.ct.tot.map((v) => num(v, 0));
      for (const [id, row] of Object.entries(snap.ct.rows)) {
        const r = state.contrib.table[Number(id)];
        if (r && Array.isArray(row)) CONTRIB_KEYS.forEach((k, i) => { r[k] = num(row[i], 0) / 10; });
      }
    }
    state.pings = (snap.pg ?? []).flatMap((r) => {
      const nation = nAt(num(r[1], -1)), kind = PING_KINDS[num(r[3], -1)];
      return nation && kind ? [{ id: num(r[0], 0), nation, by: num(r[2], 0), kind, x: num(r[4], 0), y: num(r[5], 0), z: num(r[6], 0), t: num(r[7], 0) }] : [];
    });
    const events: GameEvent[] = [];
    for (const ev of Array.isArray(snap.ev) ? snap.ev : []) {
      if (num(ev?.s, -1) <= this.lastEventSeq || !ev.e || typeof ev.e.type !== 'string') continue;
      this.lastEventSeq = ev.s;
      events.push(ev.e);
    }
    return { events, teleported };
  }

  private applyGlobals(state: GameState, g: number[]): void {
    let i = 0;
    const next = () => num(g[i++], -1);
    state.tower.owner = nAt(next());
    for (const n of NATION_IDS) state.radar[n] = unfin(next());
    state.radarAll = unfin(next());
    for (const n of NATION_IDS) state.terminalActive[n] = unfin(next());
    for (const n of NATION_IDS) state.jailReveal[n] = unfin(next());
    for (const n of NATION_IDS) state.rescueUntil[n] = unfin(next());
    state.speedBoostUntil = unfin(next());
    state.nextMeetingAt = unfin(next());
    state.meetingsHeld = Math.max(0, next());
    const w = next();
    state.winner = w === 3 ? 'draw' : nAt(w);
    state.over = next() === 1;
    for (const n of NATION_IDS) {
      const x = next(), z = next(), t = next();
      state.teamFocus[n] = t < 0 ? null : { x, z, t };
    }
    for (const n of NATION_IDS) {
      const s = state.natStats[n];
      s.cap = next(); s.res = next(); s.tower = next() / 10; s.hit = next();
    }
    for (const n of NATION_IDS) { state.kingBeacon[n] = Math.max(0, next()); state.beaconReadyAt[n] = Math.max(0, next()); }
    for (const n of NATION_IDS) {
      const id = next(), until = next(), used = next();
      state.decoy[n] = id >= 0 && id < state.entities.length ? { id, until: Math.max(0, until) } : null;
      state.decoyUsed[n] = used === 1;
    }
  }

  private applyEntities(state: GameState, buf: Uint8Array, nowMs: number): boolean {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const now = state.time;
    const id8 = (v: number) => (v === 255 || v >= state.entities.length ? null : v);
    let teleported = false;
    for (const e of state.entities) {
      const o = e.id * ENTITY_BYTES;
      const x = dv.getInt16(o), y = dv.getInt16(o + 2) / 2, z = dv.getInt16(o + 4);
      const yaw = (buf[o + 6] / 256) * 2 * Math.PI - Math.PI;
      const speed = dv.getInt8(o + 7) * 5;
      const f = buf[o + 8], b9 = buf[o + 9];
      const tp = b9 >> 4;
      e.alive = !!(f & 1);
      e.jailed = !!(f & 2);
      e.revealUntil = f & 8 ? now + 400 : 0;
      e.fakeNation = f & 16 ? nAt(b9 & 3) : null;
      e.fakeUntil = f & 16 ? now + 400 : 0;
      e.hp = (b9 >> 2) & 3;
      e.sprintUntil = f & 128 ? now + 300 : 0;
      e.stunUntil = buf[o + 10] ? now + buf[o + 10] * 100 : 0;
      e.susp = buf[o + 11];
      e.ai.state = AI_STATES[buf[o + 12]] ?? 'PATROL';
      e.ai.targetId = id8(buf[o + 13]);
      e.ai.leaderId = id8(buf[o + 14]);
      e.ai.aimId = id8(buf[o + 15]);
      e.channeling = f & 32 ? { target: e, prog: buf[o + 16], need: 100 } : null;
      e.capturedBy = nAt(buf[o + 17] - 1);
      e.jailedAt = dv.getUint16(o + 18) * 100;
      if (e.isPlayer) {
        // Our own character: the host only moves it by teleporting (jail, release).
        if ((e.tp & 15) !== tp) {
          teleport(e, x, z, y);
          e.tp = (e.tp & ~15) | tp;
          e.speed = 0;
          teleported = true;
        }
        if (e.jailed || !e.alive) { e.x = e.prevX = x; e.z = e.prevZ = z; e.y = e.prevY = y; }
        continue;
      }
      e.dashing = !!(f & 4);
      const t: Target = { x, y, z, dirX: Math.sin(yaw), dirZ: Math.cos(yaw), speed, at: nowMs };
      const prev = this.targets.get(e.id);
      this.targets.set(e.id, t);
      // First sight, or a jump (jail, release): place it there at once.
      if (!prev || Math.hypot(x - e.x, z - e.z) > 160 || Math.abs(y - e.y) > 60) {
        e.x = e.prevX = x; e.y = e.prevY = y; e.z = e.prevZ = z;
        e.dirX = t.dirX; e.dirZ = t.dirZ;
      }
    }
    return teleported;
  }

  private applyHumans(state: GameState, h: number[][]): void {
    for (const row of h) {
      if (!Array.isArray(row)) continue;
      const e = state.entities[num(row[0], -1)];
      if (!e) continue;
      e.cd.capture = num(row[1]) / 10;
      e.cd.special = num(row[2]) / 10;
      e.meetingsLeft = num(row[3]);
      e.capturesMade = num(row[4]);
      e.rescuesMade = num(row[5]);
      e.kingHits = num(row[6]);
      e.kingCaptures = num(row[7]);
      e.kingRescues = num(row[8]);
      e.towerTime = num(row[9]) / 10;
      const el = num(row[11], -1);
      e.eliminatedAt = el < 0 ? null : el / 10;
      if (e.isPlayer) state.squadOrder = ORDERS[num(row[10])] ?? state.squadOrder;
    }
  }

  private applyWar(state: GameState, w: Snapshot['w']): void {
    if (!w || !Array.isArray(w.s)) return;
    state.war.sectors.forEach((x, i) => {
      const r = w.s[i];
      if (!Array.isArray(r)) return;
      x.owner = nAt(num(r[0], -1));
      x.capturer = nAt(num(r[1], -1));
      x.progress = num(r[2]) / 100;
      x.contested = r[3] === 1;
      x.count = { sun: num(r[4]), moon: num(r[5]), star: num(r[6]) };
    });
    state.war.truces = (Array.isArray(w.t) ? w.t : []).flatMap((t) => {
      const a = nAt(num(t?.[0], -1)), b = nAt(num(t?.[1], -1));
      return a && b ? [{ a, b, until: num(t[2]) }] : [];
    });
    state.war.trucesHeld = num(w.n);
  }

  private applyMeeting(state: GameState, m: Snapshot['m']): void {
    const mine = m?.n?.[state.player.nation];
    if (!m || !mine) { state.meeting = null; return; }
    const zones: MeetingZone[] = (Array.isArray(mine.z) ? mine.z : []).map((z) => ({ label: String(z[0]), x: num(z[1]), z: num(z[2]) }));
    if (!state.meeting) {
      state.meeting = {
        kind: m.k === 1 ? 'scheduled' : 'emergency', closeAfterMs: Infinity, lines: [], script: [], nextLineAt: Infinity,
        choices: (Array.isArray(mine.c) ? mine.c : []).map(String), zones, voted: false, elapsedMs: 0, others: {}, votes: {}, ready: [],
      } satisfies MeetingState;
    }
    // The talk so far: lines arrive a window at a time, each at its place in the log.
    const lines = state.meeting.lines, o = Math.max(0, Math.min(500, num(mine.o)));
    (Array.isArray(mine.l) ? mine.l : []).forEach((l, i) => { lines[o + i] = String(l); });
    for (let i = 0; i < lines.length; i++) if (lines[i] === undefined) lines[i] = '…';
  }

  /**
   * One fixed step on a friend's device: other characters ease toward where the
   * host last put them (extrapolated along their heading for a moment).
   */
  smooth(state: GameState, dt: number, nowMs: number): void {
    for (const e of state.entities) {
      if (e.isPlayer) continue;
      const t = this.targets.get(e.id);
      if (!t) continue;
      const age = Math.min(0.25, Math.max(0, (nowMs - t.at) / 1000));
      const moving = e.alive && !e.jailed && e.stunUntil <= state.time && !e.channeling;
      const tx = t.x + (moving ? t.dirX * t.speed * age : 0), tz = t.z + (moving ? t.dirZ * t.speed * age : 0);
      const k = Math.min(1, dt * 12);
      e.x += (tx - e.x) * k;
      e.z += (tz - e.z) * k;
      e.y += (t.y - e.y) * k;
      e.speed = moving ? t.speed : 0;
      // Turn the short way round.
      const a0 = Math.atan2(e.dirX, e.dirZ), a1 = Math.atan2(t.dirX, t.dirZ);
      const a = a0 + Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) * k;
      e.dirX = Math.sin(a);
      e.dirZ = Math.cos(a);
    }
  }
}

