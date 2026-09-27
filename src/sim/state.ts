import type { NationId, Point } from '../config/nations';
import { NATION_IDS } from '../config/nations';
import type { RoleId } from '../config/roles';
import type { RosterSize } from '../config/roles';
import { ROSTERS } from '../config/roles';
import { FIRST_EVENT_AT, GAME_TIME, SCHEDULED_MEETING_EVERY } from '../config/constants';
import type { Rng } from '../core/rng';
import { createRng } from '../core/rng';
import type { MeetingState } from '../meeting/meetingSystem';
import type { Faction } from '../ai/faction';
import { createFaction } from '../ai/faction';
import type { Entity } from './entity';
import { createEntity } from './entity';
import type { GameEvent } from './events';

export type PerNation<T> = Record<NationId, T>;

export interface NationStats {
  cap: number;
  res: number;
  tower: number;
  hit: number;
}

export interface TeamFocus extends Point {
  t: number;
}

/** Character-relative movement intent for the player. */
export interface PlayerInput {
  /** +1 = forward along the facing (W), -1 = back away (S). */
  forward: number;
  /** +1 = turn right (D), -1 = turn left (A). */
  turn: number;
  dash: boolean;
}

export type Command =
  | { type: 'capture' }
  | { type: 'special' }
  /** Turn the player in place toward a world-space direction (振り向き). */
  | { type: 'face'; x: number; z: number };

export interface GameState {
  /** Game time in ms. Only advances inside `stepSimulation`. */
  time: number;
  rng: Rng;
  entities: Entity[];
  player: Entity;
  tower: { owner: NationId | null; channel: PerNation<number> };
  radar: PerNation<number>;
  radarAll: number;
  rescueUntil: PerNation<number>;
  terminalActive: PerNation<number>;
  /** Until when each nation's jail area is exposed to everyone (after a king capture). */
  jailReveal: PerNation<number>;
  teamFocus: PerNation<TeamFocus | null>;
  natStats: PerNation<NationStats>;
  /** Each kingdom's independent commander (shared intel, beliefs, posture). */
  factions: PerNation<Faction>;
  speedBoostUntil: number;
  nextEventAt: number;
  /** Seconds until the next dash footstep sound. */
  footTimer: number;
  /** Direction the player is turning toward in place, until reached or they move. */
  playerFaceTarget: { x: number; z: number } | null;
  winner: NationId | 'draw' | null;
  over: boolean;
  meeting: MeetingState | null;
  /** Game time of the next scheduled meeting, whether it has been announced, and meetings held so far. */
  nextMeetingAt: number;
  meetingWarned: boolean;
  meetingsHeld: number;
  input: PlayerInput;
  commands: Command[];
  /** Outbox drained by the presentation layer after each frame. */
  events: GameEvent[];
}

function perNation<T>(make: () => T): PerNation<T> {
  return { sun: make(), moon: make(), star: make() };
}

export function createGameState(playerNation: NationId, playerRole: RoleId, rng: Rng = createRng(), rosterSize: RosterSize = 6): GameState {
  const entities: Entity[] = [];
  let id = 0;
  for (const n of NATION_IDS) {
    let playerPlaced = false;
    const roster = ROSTERS[rosterSize].map((r) => {
      const isPlayer = !playerPlaced && n === playerNation && r === playerRole;
      if (isPlayer) playerPlaced = true;
      return createEntity(id++, n, r, isPlayer, rng);
    });
    entities.push(...roster);
    const nonKing = roster.filter((x) => x.role !== 'king');
    nonKing[Math.floor(rng() * nonKing.length)].decoy = true;
  }
  const player = entities.find((e) => e.isPlayer)!;
  return {
    time: 0,
    rng,
    entities,
    player,
    tower: { owner: null, channel: perNation(() => 0) },
    radar: perNation(() => 0),
    radarAll: 0,
    rescueUntil: perNation(() => 0),
    terminalActive: perNation(() => 0),
    jailReveal: perNation(() => 0),
    teamFocus: perNation<TeamFocus | null>(() => null),
    natStats: perNation(() => ({ cap: 0, res: 0, tower: 0, hit: 0 })),
    factions: perNation(createFaction),
    speedBoostUntil: 0,
    nextEventAt: FIRST_EVENT_AT,
    footTimer: 0,
    playerFaceTarget: null,
    winner: null,
    over: false,
    meeting: null,
    nextMeetingAt: SCHEDULED_MEETING_EVERY,
    meetingWarned: false,
    meetingsHeld: 0,
    input: { forward: 0, turn: 0, dash: false },
    commands: [],
    events: [],
  };
}

export function emit(state: GameState, ev: GameEvent): void {
  state.events.push(ev);
}

export function drainEvents(state: GameState): GameEvent[] {
  const out = state.events;
  state.events = [];
  return out;
}

export function entityById(state: GameState, id: number): Entity | undefined {
  return state.entities.find((e) => e.id === id);
}

/** Seconds of match time elapsed (v6: GAME_TIME - timeLeft). */
export function elapsedSec(state: GameState): number {
  return Math.min(GAME_TIME, state.time / 1000);
}

export function timeLeftSec(state: GameState): number {
  return Math.max(0, GAME_TIME - state.time / 1000);
}

export function kingOf(state: GameState, nation: NationId): Entity | undefined {
  return state.entities.find((e) => e.nation === nation && e.role === 'king');
}

export function speedMul(state: GameState): number {
  return state.time < state.speedBoostUntil ? 1.3 : 1;
}

/** Queues a player action. Refused while a meeting is open or after the game ends. */
export function queueCommand(state: GameState, cmd: Command): boolean {
  if (state.over || state.meeting) return false;
  state.commands.push(cmd);
  return true;
}
