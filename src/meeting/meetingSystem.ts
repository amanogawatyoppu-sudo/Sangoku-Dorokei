import type { NationId, Point } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import { roleName } from '../config/roles';
import { HOTSPOTS, TOWER } from '../config/map';
import {
  MEETING_AUTO_CLOSE, MEETING_RANGE, ONLINE_MEETING_CLOSE, SCHEDULED_MEETING_CLOSE, SCHEDULED_MEETING_WARN, TERMINAL_TIME,
} from '../config/constants';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { elapsedSec, emit, isOnline, timeLeftSec } from '../sim/state';
import { dist } from '../sim/systems/collision';
import { suspStars } from '../sim/systems/suspicion';

export interface MeetingZone extends Point {
  label: string;
}

export interface MeetingState {
  /** Emergency (called by the player at their base) or scheduled (everyone, once at half time). */
  kind: 'emergency' | 'scheduled';
  /** Real-time length before it closes by itself. */
  closeAfterMs: number;
  /** Dialogue shown in the meeting log, oldest first. */
  lines: string[];
  choices: string[];
  zones: MeetingZone[];
  voted: boolean;
  /**
   * Real time the meeting has been open. Game time is frozen during a meeting,
   * so the auto-close deadline is tracked per meeting instead of via setTimeout;
   * a closed meeting's deadline disappears with it.
   */
  elapsedMs: number;
  /** Online: the meeting as each other nation with people in it sees it. */
  others: Partial<Record<NationId, MeetingView>>;
  /** Online: each person's vote (entity id → zone index in their nation's list). */
  votes: Record<number, number>;
  /** Online: people who are done; the meeting closes once everyone is. */
  ready: number[];
}

/** What one nation's people see and vote on. */
export interface MeetingView {
  lines: string[];
  choices: string[];
  zones: MeetingZone[];
}

const DIRS = ['東', '南東', '南', '南西', '西', '北西', '北', '北東'];

/** 8-way compass label for a world-space offset (+z is 南, as on the minimap). */
export function compass(dx: number, dz: number): string {
  const a = (Math.atan2(dz, dx) * 180) / Math.PI;
  return DIRS[Math.round(((a + 360) % 360) / 45) % 8];
}

function starsText(s: number): string {
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}

function mateLine(state: GameState, p: Entity, m: Entity, foes: Entity[], topSusp: Entity | undefined): string | null {
  const target = m.persona === 'trickster' ? foes[Math.floor(state.rng() * Math.max(1, foes.length))] : topSusp ?? foes[0];
  if (!target) return null;
  const label = NATIONS[target.nation].name + 'の(' + compass(target.x - p.x, target.z - p.z) + '方向にいた人物)';
  const stars = starsText(suspStars(target.susp));
  const who = roleName(m.role);
  if (m.persona === 'cautious') return who + '「' + label + 'を見た。確証はないけど…」' + stars;
  if (m.persona === 'aggressive') return who + '「' + label + 'は絶対王候補だ！」' + stars;
  if (m.persona === 'analytical') return who + '「証拠を照らすと' + label + 'が怪しい」' + stars;
  return who + '「いや、' + label + 'の方が怪しいと思う」' + '★'.repeat(1 + Math.floor(state.rng() * 3));
}

/** Opens an emergency meeting for the player's nation. Pauses the simulation while open. */
export function openMeeting(state: GameState): boolean {
  if (state.over || state.meeting) return false;
  const p = state.player;
  if (isOnline(state)) return false;
  if (p.meetingsLeft <= 0) { emit(state, { type: 'MEETING_DENIED', reason: 'none_left' }); return false; }
  if (dist(p, NATIONS[p.nation].base) > MEETING_RANGE) { emit(state, { type: 'MEETING_DENIED', reason: 'too_far' }); return false; }
  p.meetingsLeft--;
  state.terminalActive[p.nation] = state.time + TERMINAL_TIME;
  state.commands = [];

  const lines = ['（自国が生存中の仲間が集まった）'];
  const { choices, zones } = discussion(state, p, lines);
  state.meeting = { kind: 'emergency', closeAfterMs: MEETING_AUTO_CLOSE, lines, choices, zones, voted: false, elapsedMs: 0, others: {}, votes: {}, ready: [] };
  state.meetingsHeld++;
  emit(state, { type: 'MEETING_OPENED', kind: 'emergency' });
  return true;
}

/** Teammates' reports, the talking points and the places to vote for (shared by both kinds of meeting). */
function discussion(state: GameState, p: Entity, lines: string[], extraZones: MeetingZone[] = []): { choices: string[]; zones: MeetingZone[] } {
  const mates = state.entities.filter((e) => e.nation === p.nation && e !== p && e.alive);
  const foes = state.entities.filter((e) => e.nation !== p.nation && e.alive && !e.jailed);
  const topSusp = [...foes].sort((a, b) => b.susp - a.susp)[0];
  // With a big roster, only the first few reports are read out.
  // Same opinion from several people: one line with how many agree.
  const said = new Map<string, { who: string; n: number }>();
  for (const m of mates) {
    const line = mateLine(state, p, m, foes, topSusp);
    if (!line) continue;
    const who = roleName(m.role), body = line.slice(who.length);
    const prev = said.get(body);
    if (prev) prev.n++;
    else said.set(body, { who, n: 1 });
  }
  const reports = [...said].map(([body, { who, n }]) => who + body + (n > 1 ? `（ほか${n - 1}人も同意）` : ''));
  lines.push(...reports.slice(0, 6));
  if (reports.length > 6) lines.push(`（ほか ${reports.length - 6} 件の報告は省略）`);
  if (!mates.length) lines.push('（生存している仲間がいない…）');

  const choices = ['管制塔を優先しよう', '牢屋を警戒しよう', '情報が足りない'];
  if (topSusp) choices.unshift(NATIONS[topSusp.nation].name + '方面は怪しいと共有する');

  const zones: MeetingZone[] = [
    ...extraZones,
    ...[
      { label: NATIONS.sun.name + '国拠点周辺', ...NATIONS.sun.base },
      { label: NATIONS.moon.name + '国拠点周辺', ...NATIONS.moon.base },
      { label: NATIONS.star.name + '国拠点周辺', ...NATIONS.star.base },
      { label: '管制塔周辺', x: TOWER.x, z: TOWER.z },
    ].filter((z) => z.label.indexOf(NATIONS[p.nation].name) !== 0),
  ];
  return { choices, zones };
}

const clock = (sec: number) => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');

/** Nearest named place (for "seen near 秋葉原"). */
function placeName(x: number, z: number): (typeof HOTSPOTS)[number] {
  return HOTSPOTS.reduce((best, h) => (Math.hypot(h.x - x, h.z - z) < Math.hypot(best.x - x, best.z - z) ? h : best), HOTSPOTS[0]);
}

interface SightingGroup { nation: NationId; place: (typeof HOTSPOTS)[number]; count: number; ageSec: number; king: number }

/** A nation's recent sightings of enemies, grouped by nation and nearest place, busiest first. */
function sightings(state: GameState, n: NationId): SightingGroup[] {
  const groups = new Map<string, SightingGroup>();
  const f = state.factions[n];
  for (const s of f.intel.values()) {
    const age = (state.time - s.t) / 1000;
    const t = state.entities[s.id];
    if (age > 25 || !t || !t.alive || t.jailed) continue;
    const place = placeName(s.x, s.z), key = t.nation + place.name;
    const g = groups.get(key) ?? { nation: t.nation, place, count: 0, ageSec: age, king: 0 };
    g.count++;
    g.ageSec = Math.min(g.ageSec, age);
    g.king = Math.max(g.king, f.belief.get(s.id) ?? 0);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count + b.king - (a.count + a.king) || a.ageSec - b.ageSec);
}

/** Where a nation's members agree to search: the busiest sighting, else the tower or a rival base. */
function agreedFocus(state: GameState, n: NationId): MeetingZone {
  const g = sightings(state, n)[0];
  if (g) return { label: g.place.name + '付近', x: g.place.x, z: g.place.z };
  if (state.tower.owner !== n) return { label: '管制塔周辺', x: TOWER.x, z: TOWER.z };
  const rival = NATION_IDS.filter((o) => o !== n)[state.meetingsHeld % 2];
  return { label: NATIONS[rival].name + '国拠点周辺', ...NATIONS[rival].base };
}

/**
 * Half-time meeting (ハーフタイム会議): every kingdom meets at the same moment, so the
 * whole match pauses. The player hears a situation report (tower, prisoners,
 * kings, sightings by area), the teammates' reports, and votes where to search;
 * the AI kingdoms settle their own search focus from what they have seen.
 */
export function openScheduledMeeting(state: GameState): void {
  state.commands = [];
  const own = scheduledView(state, state.player);
  // Online: each other nation with people in it gets its own meeting; nations of only AI decide by themselves.
  const others: MeetingState['others'] = {};
  for (const id of state.humans) {
    const h = state.entities[id];
    if (h.nation !== state.player.nation && !others[h.nation]) others[h.nation] = scheduledView(state, h);
  }
  for (const n of NATION_IDS) if (n !== state.player.nation && !others[n]) state.teamFocus[n] = { ...agreedFocus(state, n), t: state.time };
  state.meeting = { kind: 'scheduled', closeAfterMs: isOnline(state) ? ONLINE_MEETING_CLOSE : SCHEDULED_MEETING_CLOSE, ...own, voted: false, elapsedMs: 0, others, votes: {}, ready: [] };
  state.meetingsHeld++;
  emit(state, { type: 'MEETING_OPENED', kind: 'scheduled' });
}

/** The half-time report for `p`'s nation, told from where `p` stands. */
function scheduledView(state: GameState, p: Entity): MeetingView {
  const lines = [`【ハーフタイム会議】経過 ${clock(elapsedSec(state))}／残り ${clock(timeLeftSec(state))}`];
  lines.push('管制塔: ' + (state.tower.owner ? NATIONS[state.tower.owner].name + '国が占領中' : '未占領'));
  const jailed = NATION_IDS.map((n) => NATIONS[n].name + state.entities.filter((e) => e.nation === n && e.jailed).length + '人').join('・');
  lines.push('捕まっている人数: ' + jailed);
  for (const n of NATION_IDS) {
    const k = state.entities.find((e) => e.nation === n && e.role === 'king');
    if (k?.jailed && k.capturedBy) lines.push(`⚠ ${NATIONS[n].name}国の王が${NATIONS[k.capturedBy].name}国の牢屋に捕まっている！`);
  }
  const seen = sightings(state, p.nation);
  if (!seen.length) lines.push('目撃情報: 直近の目撃はなし');
  for (const g of seen.slice(0, 4)) {
    lines.push(`目撃: ${NATIONS[g.nation].name}国の人物${g.count}人 ― ${g.place.name}付近（${Math.round(g.ageSec)}秒前）${g.king >= 2 ? '　護衛付き＝王の可能性' : ''}`);
  }
  const extra = seen.slice(0, 2).map((g) => ({ label: `${g.place.name}付近（${NATIONS[g.nation].name}${g.count}人）`, x: g.place.x, z: g.place.z }));
  const { choices, zones } = discussion(state, p, lines, extra);
  return { lines, choices, zones };
}

/** Announces and opens the half-time meeting (called every simulation step). */
export function scheduledMeetingTick(state: GameState): void {
  if (state.over || state.meeting) return;
  const until = state.nextMeetingAt - state.time;
  if (!state.meetingWarned && until <= SCHEDULED_MEETING_WARN) {
    state.meetingWarned = true;
    emit(state, { type: 'MEETING_SOON', inSec: Math.max(1, Math.ceil(until / 1000)) });
  }
  if (until > 0) return;
  state.nextMeetingAt = Infinity; // once per match
  state.meetingWarned = false;
  if (timeLeftSec(state) > 15) openScheduledMeeting(state);
}

export function sayInMeeting(state: GameState, choice: string): void {
  state.meeting?.lines.push('あなた:「' + choice + '」');
}

export function voteInMeeting(state: GameState, zoneIndex: number): void {
  const m = state.meeting;
  if (!m || m.voted) return;
  const z = m.zones[zoneIndex];
  if (!z) return;
  m.voted = true;
  m.votes[state.player.id] = zoneIndex;
  state.teamFocus[state.player.nation] = { x: z.x, z: z.z, t: state.time };
  m.lines.push('→ 重点捜索対象:「' + z.label + '」に決定');
}

/** Online: a friend's vote, in their own nation's list of places. */
export function remoteVote(state: GameState, id: number, zoneIndex: number): void {
  const m = state.meeting, e = state.entities[id];
  if (!m || !e?.remote || m.votes[id] !== undefined) return;
  const view = e.nation === state.player.nation ? m : m.others[e.nation];
  if (!view?.zones[zoneIndex]) return;
  m.votes[id] = zoneIndex;
}

/** Online: a friend is done with the meeting. */
export function remoteReady(state: GameState, id: number): void {
  const m = state.meeting;
  if (m && state.entities[id]?.remote && !m.ready.includes(id)) m.ready.push(id);
}

export function closeMeeting(state: GameState): void {
  const m = state.meeting;
  if (!m) return;
  // Each nation with people goes where most of them voted; with no votes, the
  // teammates settle it by majority (the busiest sighting).
  const nations = new Set([state.player.nation, ...(Object.keys(m.others) as NationId[])]);
  for (const n of nations) {
    const zones = n === state.player.nation ? m.zones : m.others[n]!.zones;
    const tally = new Map<number, number>();
    for (const [id, z] of Object.entries(m.votes)) if (state.entities[+id].nation === n) tally.set(z, (tally.get(z) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (top && zones[top[0]]) state.teamFocus[n] = { x: zones[top[0]].x, z: zones[top[0]].z, t: state.time };
    else if (m.kind === 'scheduled') state.teamFocus[n] = { ...agreedFocus(state, n), t: state.time };
  }
  state.meeting = null;
  emit(state, { type: 'MEETING_CLOSED', focusSet: !!state.teamFocus[state.player.nation] });
}

/** Advances the open meeting by real (wall-clock) time and auto-closes it (30 s emergency, 20 s scheduled). */
export function updateMeeting(state: GameState, realMs: number): void {
  const m = state.meeting;
  if (!m) return;
  m.elapsedMs += Math.max(0, realMs);
  const allReady = isOnline(state) && state.humans.every((id) => state.entities[id].isPlayer ? m.ready.includes(id) : !state.entities[id].remote || m.ready.includes(id));
  if (m.elapsedMs >= m.closeAfterMs || allReady) closeMeeting(state);
}
