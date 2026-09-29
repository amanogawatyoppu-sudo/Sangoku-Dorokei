import type { ContribState } from './contrib';
import { createContrib } from './contrib';
import type { CpuLevel } from '../ai/difficulty';
import type { Ping, PingKind } from './ping';
import type { NationId, Point } from '../config/nations';
import { NATION_IDS } from '../config/nations';
import type { RoleId } from '../config/roles';
import type { RosterSize } from '../config/roles';
import { ROSTERS } from '../config/roles';
import { FIRST_EVENT_AT, GAME_TIME, SCHEDULED_MEETING_AT } from '../config/constants';
import type { Rng } from '../core/rng';
import { createRng } from '../core/rng';
import type { MeetingState } from '../meeting/meetingSystem';
import type { Faction } from '../ai/faction';
import { createFaction } from '../ai/faction';
import type { Entity } from './entity';
import { createEntity } from './entity';
import type { GameEvent } from './events';
import type { WarState } from './war';
import { createWar } from './war';

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

/** Orders the player gives their squad: follow in formation, spread out and search here, hold this spot. */
export type SquadOrder = 'follow' | 'spread' | 'hold';

export type Command = (
  | { type: 'squad'; order: SquadOrder }
  | { type: 'capture' }
  | { type: 'special' }
  /** Light up the enemy kings from the tower (its holder, last third of the match). */
  | { type: 'beacon' }
  /** The king names a double (影武者). */
  | { type: 'decoy' }
  /** A ping (合図) to your own nation. */
  | { type: 'ping'; kind: PingKind }
  /** Turn the player in place toward a world-space direction (振り向き). */
  | { type: 'face'; x: number; z: number }
) & {
  /** Who gives it (online: a friend's character). Omitted = the player. */
  by?: number;
};

/** A squad order and where it was given (spread / hold happen around that point). */
export interface SquadCommand {
  order: SquadOrder;
  anchor: { x: number; y: number; z: number } | null;
}

/** Where a friend's device says their character is (online matches; applied by the host each step). */
export interface RemotePose {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  dash: boolean;
  /** The teleport count (mod 16) the device has caught up with (older poses are ignored). */
  tp: number;
}

/** A person in the match: where they asked to play. */
export interface HumanSeat {
  nation: NationId;
  role: RoleId;
}

export interface GameState {
  /** Game time in ms. Only advances inside `stepSimulation`. */
  time: number;
  rng: Rng;
  entities: Entity[];
  player: Entity;
  tower: { owner: NationId | null; channel: PerNation<number> };
  radar: PerNation<number>;
  radarAll: number;
  /** Until when each nation sees the enemy kings lit up (tower, last third of the match). */
  kingBeacon: PerNation<number>;
  /** 練習モード / チュートリアル: the player cannot be captured. */
  practice: boolean;
  /** 貢献度: what each person did, for the result screen (same rules for CPUs and people). */
  contrib: ContribState;
  /** CPUレベル: how the AI decides (never its speed, reach or toughness). */
  cpuLevel: CpuLevel;
  /** The king's double (影武者), per nation, and whether it has been used this match. */
  decoy: PerNation<{ id: number; until: number } | null>;
  decoyUsed: PerNation<boolean>;
  /** Pings (合図) up right now, all nations (each nation sees only its own). */
  pings: Ping[];
  /** When the AI last looked for something to ping, per nation. */
  lastAiPingCheck: PerNation<number>;
  /** When each nation may light the kings again. */
  beaconReadyAt: PerNation<number>;
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
  /** The player's squad order and where it was given (spread / hold happen around that point). */
  squadOrder: SquadOrder;
  squadAnchor: { x: number; y: number; z: number } | null;
  meetingWarned: boolean;
  meetingsHeld: number;
  input: PlayerInput;
  commands: Command[];
  /** Entity ids of every person in the match (just the player offline). */
  humans: number[];
  /** Squad orders of friends' characters (the player's own are `squadOrder` / `squadAnchor`). */
  humanOrders: Record<number, SquadCommand>;
  /** Online: everyone's nickname by character id (meeting lines). */
  humanNames: Record<number, string>;
  /** The war for Tokyo: sectors, fronts, ceasefires. */
  war: WarState;
  /** Latest reported positions of friends' characters. */
  remotePose: Record<number, RemotePose>;
  /** Outbox drained by the presentation layer after each frame. */
  events: GameEvent[];
}

function perNation<T>(make: () => T): PerNation<T> {
  return { sun: make(), moon: make(), star: make() };
}

/**
 * Gives each person a character: the first free one of the nation and role they
 * asked for, else another free non-king in that nation, else anywhere. Returns
 * entity ids in seat order. Deterministic, so every device agrees.
 */
export function seatHumans(roles: { nation: NationId; role: RoleId }[], seats: HumanSeat[]): number[] {
  const taken = new Set<number>();
  const pick = (ok: (r: { nation: NationId; role: RoleId }) => boolean) => {
    const i = roles.findIndex((r, j) => !taken.has(j) && ok(r));
    if (i >= 0) taken.add(i);
    return i;
  };
  return seats.map((h) => {
    let i = pick((r) => r.nation === h.nation && r.role === h.role);
    if (i < 0) i = pick((r) => r.nation === h.nation && r.role !== 'king');
    if (i < 0) i = pick((r) => r.role !== 'king');
    if (i < 0) i = pick(() => true);
    return i;
  });
}

/**
 * A new match. Offline, the player takes the first `playerNation` / `playerRole`
 * character. Online, `online.seats` lists everyone in the room (same order on
 * every device) and `online.me` is this device's seat; the others are remote.
 */
export function createGameState(
  playerNation: NationId, playerRole: RoleId, rng: Rng = createRng(), rosterSize: RosterSize = 6,
  online?: { seats: HumanSeat[]; me: number },
): GameState {
  const entities: Entity[] = [];
  const slots = NATION_IDS.flatMap((n) => ROSTERS[rosterSize].map((role) => ({ nation: n, role })));
  const seats = online?.seats ?? [{ nation: playerNation, role: playerRole }];
  const humans = seatHumans(slots, seats);
  const me = humans[online?.me ?? 0];
  let id = 0;
  for (const n of NATION_IDS) {
    const roster = ROSTERS[rosterSize].map((r) => {
      const e = createEntity(id, n, r, id === me, rng);
      e.remote = id !== me && humans.includes(id);
      id++;
      return e;
    });
    entities.push(...roster);
    const nonKing = roster.filter((x) => x.role !== 'king');
    nonKing[Math.floor(rng() * nonKing.length)].decoy = true;
  }
  const player = entities[me];
  return {
    time: 0,
    rng,
    entities,
    player,
    tower: { owner: null, channel: perNation(() => 0) },
    radar: perNation(() => 0),
    radarAll: 0,
    kingBeacon: perNation(() => 0),
    pings: [],
    practice: false,
    cpuLevel: 'normal',
    contrib: createContrib(entities.length),
    decoy: perNation<{ id: number; until: number } | null>(() => null),
    decoyUsed: perNation(() => false),
    lastAiPingCheck: perNation(() => 0),
    beaconReadyAt: perNation(() => 0),
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
    nextMeetingAt: SCHEDULED_MEETING_AT,
    squadOrder: 'follow',
    squadAnchor: null,
    meetingWarned: false,
    meetingsHeld: 0,
    input: { forward: 0, turn: 0, dash: false },
    commands: [],
    humans,
    humanOrders: {},
    humanNames: {},
    war: createWar(),
    remotePose: {},
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

/** A person's squad order (the player's lives on the state itself). */
export function squadCommandOf(state: GameState, leader: Entity): SquadCommand {
  if (leader.isPlayer) return { order: state.squadOrder, anchor: state.squadAnchor };
  return state.humanOrders[leader.id] ?? { order: 'follow', anchor: null };
}

/** Online match (more than one person). Emergency meetings are off there: the whole match would stop. */
export function isOnline(state: GameState): boolean {
  return state.humans.length > 1;
}

/** Queues a player action. Refused while a meeting is open or after the game ends. */
export function queueCommand(state: GameState, cmd: Command): boolean {
  if (state.over || state.meeting) return false;
  state.commands.push(cmd);
  return true;
}
