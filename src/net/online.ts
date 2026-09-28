import type { NationId } from '../config/nations';
import { NATION_IDS } from '../config/nations';
import type { RoleId, RosterSize } from '../config/roles';
import { ROLES, ROSTER_SIZES } from '../config/roles';
import { BOUNDS } from '../config/map';
import { PLAYER_DASH } from '../config/constants';
import { humanSay, remoteReady, remoteVote } from '../meeting/meetingSystem';
import type { GameEvent } from '../sim/events';
import type { Command, GameState, HumanSeat } from '../sim/state';
import { queueCommand } from '../sim/state';
import type { NetEvent, Snapshot } from './snapshot';
import { Mirror, encodeSnapshot, fitSnapshot } from './snapshot';

/*
 * Playing with friends over the page's `room` capability (claude.ai). Everyone in
 * a match joins the named room "sgdk-<code>". Each device keeps one presence
 * object there:
 *   lobby: n (nickname), na (nation), ro (role), h (1 = host)
 *   host:  st (the start: seed, roster size, seats), snap (the match snapshot)
 *   friend: g (their character's pose, button presses, meeting vote / done)
 * Presence is untrusted: a device can only steer its own character.
 */

/** The parts of the room capability this page uses (see the artifact runtime's room.d.ts). */
export interface RoomPeer {
  peer: string;
  isMe: boolean;
  sameTab: boolean;
  kind: string;
  presence: Readonly<Record<string, unknown>>;
}
export interface NamedRoom {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly RoomPeer[];
  onPeers(handler: (change: { peers: readonly RoomPeer[] }) => void, onError?: (e: { code: string }) => void): () => void;
  connected(): boolean;
  leave(): Promise<void>;
}
export interface RoomApi {
  join(name: string): Promise<NamedRoom>;
}

/** The room capability, or null when this page is not open in claude.ai with it (a saved file, a public link). */
export async function roomApi(): Promise<RoomApi | null> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!c?.use) return null;
  try { return (await c.use('room')) as RoomApi | null; } catch { return null; }
}

/** Presence stays under 4 KiB; a little headroom for the lobby fields. */
const PRESENCE_MAX = 3900;
export const MAX_PLAYERS = 9;
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newRoomCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/** Normalizes a typed room code (case, spaces); null if it is not one. */
export function parseRoomCode(text: string): string | null {
  const c = text.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^[a-z0-9]{3,12}$/.test(c) ? c : null;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const isNation = (v: unknown): v is NationId => typeof v === 'string' && (NATION_IDS as readonly string[]).includes(v);
const isRole = (v: unknown): v is RoleId => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface LobbyMember {
  peer: string;
  nick: string;
  nation: NationId | null;
  role: RoleId | null;
  host: boolean;
  me: boolean;
}

/** One seat of a started match: who, where they play, and their nickname. */
export type StartSeat = [peer: string, nation: NationId, role: RoleId, nick: string];

export interface StartInfo {
  seed: number;
  size: RosterSize;
  seats: StartSeat[];
}

/** A room before the match: who is in it and what they picked; the host starts it. */
export class Lobby {
  private unsub: () => void;
  private listeners: (() => void)[] = [];

  private constructor(readonly room: NamedRoom, readonly code: string, readonly isHost: boolean) {
    this.unsub = room.onPeers(() => { for (const f of this.listeners) f(); });
  }

  static async open(api: RoomApi, code: string, isHost: boolean): Promise<Lobby> {
    const room = await api.join('sgdk-' + code);
    return new Lobby(room, code, isHost);
  }

  onChange(f: () => void): void {
    this.listeners.push(f);
  }

  setMe(nick: string, nation: NationId | null, role: RoleId | null): void {
    void this.room.presence({ n: nick.slice(0, 12) || '名無し', na: nation, ro: role, h: this.isHost ? 1 : null }).catch(() => {});
  }

  get myPeer(): string | null {
    return this.room.peers().find((p) => p.sameTab)?.peer ?? null;
  }

  members(): LobbyMember[] {
    return this.room.peers()
      .filter((p) => p.kind === 'viewer' && typeof p.presence.n === 'string')
      .map((p) => ({
        peer: p.peer, nick: str(p.presence.n, 12), host: p.presence.h === 1, me: p.sameTab,
        nation: isNation(p.presence.na) ? p.presence.na : null, role: isRole(p.presence.ro) ? p.presence.ro : null,
      }))
      .sort((a, b) => Number(b.host) - Number(a.host) || (a.peer < b.peer ? -1 : 1));
  }

  host(): RoomPeer | undefined {
    return this.room.peers().filter((p) => p.presence.h === 1 && !p.sameTab).sort((a, b) => (a.peer < b.peer ? -1 : 1))[0];
  }

  /** The host's start, once the match has begun (validated). */
  startInfo(): StartInfo | null {
    const st = this.host()?.presence.st as { seed?: unknown; size?: unknown; seats?: unknown } | undefined;
    if (!st || !finite(st.seed) || !(ROSTER_SIZES as readonly number[]).includes(st.size as number) || !Array.isArray(st.seats)) return null;
    const seats = st.seats.filter((s): s is StartSeat => Array.isArray(s) && typeof s[0] === 'string' && isNation(s[1]) && isRole(s[2]))
      .map((s) => [s[0], s[1], s[2], str(s[3], 12)] as StartSeat);
    return seats.length ? { seed: st.seed, size: st.size as RosterSize, seats } : null;
  }

  /** Host: fixes the seats (host first, up to MAX_PLAYERS) and announces the start. */
  start(size: RosterSize, me: { nick: string; nation: NationId; role: RoleId }): StartInfo {
    const seats: StartSeat[] = [[this.myPeer ?? 'host', me.nation, me.role, me.nick]];
    for (const m of this.members()) {
      if (m.me || seats.length >= MAX_PLAYERS) continue;
      seats.push([m.peer, m.nation ?? NATION_IDS[seats.length % 3], m.role ?? 'soldier', m.nick]);
    }
    const info: StartInfo = { seed: Math.floor(Math.random() * 2 ** 31), size, seats };
    void this.room.presence({ st: info }).catch(() => {});
    return info;
  }

  close(): void {
    this.unsub();
    void this.room.leave().catch(() => {});
  }
}

export const seatsOf = (info: StartInfo): HumanSeat[] => info.seats.map(([, nation, role]) => ({ nation, role }));

/** A friend's input as it travels in presence. */
interface NetInput {
  x: number; y: number; z: number; dx: number; dz: number; s: number; d: 0 | 1; tp: number;
  /** Recent button presses: [sequence, kind, squad order]. */
  c: [number, string, string?][];
  /** Meeting vote: [meeting number, zone index]. */
  v: [number, number] | null;
  /** Done with meeting number r. */
  r: number | null;
  /** Remarks in the meeting: [meeting number, choice indexes in the order said]. */
  say?: [number, number[]];
}

/** Host side: reads friends' input into the simulation and publishes snapshots. */
export class HostLink {
  private lastCmd = new Map<number, number>();
  private said = new Map<number, number>();
  private events: NetEvent[] = [];
  private seq = 0;
  private lastSend = -Infinity;
  private missingSince = new Map<number, number>();
  private readonly byPeer = new Map<string, number>();

  constructor(private room: NamedRoom, info: StartInfo, humanIds: number[]) {
    info.seats.forEach(([peer], i) => { if (i > 0) this.byPeer.set(peer, humanIds[i]); });
  }

  /**
   * Applies friends' latest input. Returns the ids of characters whose person has
   * left (for a few seconds): the caller hands them to the AI.
   */
  ingest(state: GameState, nowMs: number): number[] {
    const here = new Set<number>();
    for (const p of this.room.peers()) {
      const id = this.byPeer.get(p.peer);
      if (id === undefined) continue;
      const e = state.entities[id];
      here.add(id);
      if (!e.remote) continue;
      const g = p.presence.g as Partial<NetInput> | undefined;
      if (!g || typeof g !== 'object') continue;
      if (finite(g.x) && finite(g.y) && finite(g.z) && finite(g.dx) && finite(g.dz) && finite(g.s) && finite(g.tp)) {
        const lim = PLAYER_DASH * 1.6;
        state.remotePose[id] = {
          x: Math.max(BOUNDS.minX - 1500, Math.min(BOUNDS.maxX + 1500, g.x)),
          y: Math.max(-50, Math.min(3000, g.y)),
          z: Math.max(BOUNDS.minZ - 1500, Math.min(BOUNDS.maxZ + 1500, g.z)),
          dirX: g.dx, dirZ: g.dz, speed: Math.max(-lim, Math.min(lim, g.s)), dash: g.d === 1, tp: g.tp & 15,
        };
      }
      if (Array.isArray(g.c)) {
        let last = this.lastCmd.get(id) ?? -1;
        for (const c of g.c) {
          if (!Array.isArray(c) || !finite(c[0]) || c[0] <= last) continue;
          last = c[0];
          const cmd: Command | null = c[1] === 'capture' ? { type: 'capture', by: id }
            : c[1] === 'special' ? { type: 'special', by: id }
              : c[1] === 'squad' && (c[2] === 'follow' || c[2] === 'spread' || c[2] === 'hold') ? { type: 'squad', order: c[2], by: id } : null;
          if (cmd) queueCommand(state, cmd);
        }
        this.lastCmd.set(id, last);
      }
      if (state.meeting) {
        if (Array.isArray(g.v) && g.v[0] === state.meetingsHeld && finite(g.v[1])) remoteVote(state, id, g.v[1]);
        if (g.r === state.meetingsHeld) remoteReady(state, id);
        if (Array.isArray(g.say) && g.say[0] === state.meetingsHeld && Array.isArray(g.say[1])) {
          const said = this.said.get(id) ?? 0, view = state.entities[id].nation === state.player.nation ? state.meeting : state.meeting.others[state.entities[id].nation];
          for (const i of g.say[1].slice(said, said + 4)) if (finite(i) && view?.choices[i]) humanSay(state, id, view.choices[i]);
          this.said.set(id, Math.max(said, Math.min(g.say[1].length, said + 4)));
        }
      }
    }
    const left: number[] = [];
    for (const id of this.byPeer.values()) {
      if (here.has(id) || !state.entities[id].remote) { this.missingSince.delete(id); continue; }
      const since = this.missingSince.get(id) ?? nowMs;
      this.missingSince.set(id, since);
      if (nowMs - since > 4000) left.push(id);
    }
    return left;
  }

  /** Records a simulation event for friends' devices (footsteps stay local). */
  record(ev: GameEvent): void {
    if (ev.type === 'FOOTSTEP') return;
    this.events.push({ s: ++this.seq, e: ev });
    if (this.events.length > 32) this.events.shift();
  }

  /** Publishes the snapshot about 10 times a second (and at once when `force`). */
  publish(state: GameState, nowMs: number, force = false): void {
    if (!force && nowMs - this.lastSend < 100) return;
    this.lastSend = nowMs;
    const snap = fitSnapshot(encodeSnapshot(state, this.events), PRESENCE_MAX, this.lobbyBytes());
    void this.room.presence({ snap }).catch(() => {});
  }

  private lobbyBytes(): number {
    const me = this.room.peers().find((p) => p.sameTab)?.presence ?? {};
    const { snap: _s, ...rest } = me as Record<string, unknown>;
    return new TextEncoder().encode(JSON.stringify(rest)).length + 16;
  }
}

/** A friend's side: mirrors the host's snapshots and sends this device's input. */
export class ClientLink {
  readonly mirror = new Mirror();
  private lastSnap: unknown = null;
  private seq = 0;
  private cmds: [number, string, string?][] = [];
  private vote: [number, number] | null = null;
  private ready: number | null = null;
  private says: [number, number[]] = [-1, []];
  private lastSend = -Infinity;
  private hostSeenAt: number;

  constructor(private room: NamedRoom, private hostPeer: string, nowMs: number) {
    this.hostSeenAt = nowMs;
  }

  /** Applies the host's newest snapshot, if any. Returns its new events. */
  poll(state: GameState, nowMs: number): { events: GameEvent[]; teleported: boolean } | null {
    const host = this.room.peers().find((p) => p.peer === this.hostPeer);
    if (!host) return null;
    this.hostSeenAt = nowMs;
    const snap = host.presence.snap as Snapshot | undefined;
    if (!snap || snap === this.lastSnap) return null;
    this.lastSnap = snap;
    return this.mirror.apply(state, snap, nowMs);
  }

  /** The host has been gone for a few seconds (closed the page or lost connection). */
  hostGone(nowMs: number): boolean {
    return nowMs - this.hostSeenAt > 5000;
  }

  command(kind: 'capture' | 'special' | 'squad', order?: string): void {
    this.cmds.push(order ? [++this.seq, kind, order] : [++this.seq, kind]);
    if (this.cmds.length > 8) this.cmds.shift();
  }

  voteFor(state: GameState, zone: number): void {
    this.vote = [state.meetingsHeld, zone];
  }

  done(state: GameState): void {
    this.ready = state.meetingsHeld;
  }

  /** Something said in the meeting (index into the meeting's choices). */
  sayChoice(state: GameState, index: number): void {
    if (this.says[0] !== state.meetingsHeld) this.says = [state.meetingsHeld, []];
    this.says[1].push(index);
  }

  /** Sends this device's character and buttons about 15 times a second. */
  send(state: GameState, nowMs: number): void {
    if (nowMs - this.lastSend < 66) return;
    this.lastSend = nowMs;
    const p = state.player;
    const r = (v: number) => Math.round(v * 10) / 10;
    const g: NetInput = {
      x: r(p.x), y: r(p.y), z: r(p.z), dx: r(p.dirX * 100) / 100, dz: r(p.dirZ * 100) / 100, s: Math.round(p.speed), d: p.dashing ? 1 : 0,
      tp: p.tp & 15, c: this.cmds, v: this.vote, r: this.ready, say: this.says,
    };
    void this.room.presence({ g }).catch(() => {});
  }
}
