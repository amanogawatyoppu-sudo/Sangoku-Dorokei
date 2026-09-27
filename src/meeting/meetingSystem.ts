import type { Point } from '../config/nations';
import { NATIONS } from '../config/nations';
import { roleName } from '../config/roles';
import { TOWER } from '../config/map';
import { MEETING_AUTO_CLOSE, MEETING_RANGE, TERMINAL_TIME } from '../config/constants';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { emit } from '../sim/state';
import { dist } from '../sim/systems/collision';
import { suspStars } from '../sim/systems/suspicion';

export interface MeetingZone extends Point {
  label: string;
}

export interface MeetingState {
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

function mateLine(state: GameState, m: Entity, foes: Entity[], topSusp: Entity | undefined): string | null {
  const p = state.player;
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
  if (p.meetingsLeft <= 0) { emit(state, { type: 'MEETING_DENIED', reason: 'none_left' }); return false; }
  if (dist(p, NATIONS[p.nation].base) > MEETING_RANGE) { emit(state, { type: 'MEETING_DENIED', reason: 'too_far' }); return false; }
  p.meetingsLeft--;
  state.terminalActive[p.nation] = state.time + TERMINAL_TIME;
  state.commands = [];

  const mates = state.entities.filter((e) => e.nation === p.nation && e !== p && e.alive);
  const foes = state.entities.filter((e) => e.nation !== p.nation && e.alive && !e.jailed);
  const topSusp = [...foes].sort((a, b) => b.susp - a.susp)[0];
  const lines = ['（自国が生存中の仲間が集まった）'];
  // With a big roster, only the first few reports are read out.
  const reports = mates.map((m) => mateLine(state, m, foes, topSusp)).filter((l): l is string => !!l);
  lines.push(...reports.slice(0, 6));
  if (reports.length > 6) lines.push(`（ほか ${reports.length - 6} 人の報告は省略）`);
  if (!mates.length) lines.push('（生存している仲間がいない…）');

  const choices = ['管制塔を優先しよう', '牢屋を警戒しよう', '情報が足りない'];
  if (topSusp) choices.unshift(NATIONS[topSusp.nation].name + '方面は怪しいと共有する');

  const zones: MeetingZone[] = [
    { label: NATIONS.sun.name + '国拠点周辺', ...NATIONS.sun.base },
    { label: NATIONS.moon.name + '国拠点周辺', ...NATIONS.moon.base },
    { label: NATIONS.star.name + '国拠点周辺', ...NATIONS.star.base },
    { label: '管制塔周辺', x: TOWER.x, z: TOWER.z },
  ].filter((z) => z.label.indexOf(NATIONS[p.nation].name) !== 0);

  state.meeting = { lines, choices, zones, voted: false, elapsedMs: 0 };
  emit(state, { type: 'MEETING_OPENED' });
  return true;
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
  state.teamFocus[state.player.nation] = { x: z.x, z: z.z, t: state.time };
  m.lines.push('→ 重点捜索対象:「' + z.label + '」に決定');
}

export function closeMeeting(state: GameState): void {
  if (!state.meeting) return;
  state.meeting = null;
  emit(state, { type: 'MEETING_CLOSED', focusSet: !!state.teamFocus[state.player.nation] });
}

/** Advances the open meeting by real (wall-clock) time and auto-closes it after 30s. */
export function updateMeeting(state: GameState, realMs: number): void {
  const m = state.meeting;
  if (!m) return;
  m.elapsedMs += Math.max(0, realMs);
  if (m.elapsedMs >= MEETING_AUTO_CLOSE) closeMeeting(state);
}
