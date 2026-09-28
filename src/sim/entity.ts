import type { NationId, Point } from '../config/nations';
import { NATIONS } from '../config/nations';
import type { KingPersona, Persona, RoleId } from '../config/roles';
import { KING_PERSONAS, PERSONAS } from '../config/roles';
import { MEETINGS_PER_GAME, STAMINA_MAX } from '../config/constants';
import type { Rng } from '../core/rng';
import type { AiMemory } from '../ai/memory';
import { createAiMemory } from '../ai/memory';
import { groundAt } from './systems/world';

export interface Evidence {
  t: number;
  text: string;
  stars: number;
}

export interface Channeling {
  target: Entity;
  prog: number;
  need: number;
}

/**
 * One character. Plain data only: no meshes or DOM handles.
 * All `*Until` / `*At` / `*Time` fields are game-time milliseconds.
 */
export interface Entity {
  id: number;
  nation: NationId;
  role: RoleId;
  /** The person at this screen (single player, or this device in an online match). */
  isPlayer: boolean;
  /** Another person's character in an online match: moved by their device, never by the AI. */
  remote: boolean;
  /** Teleport count (jail, release): lets a remote device know its position was reset. */
  tp: number;
  x: number;
  /** Height of the feet above the ground plane (stairs, floors, hills, bridges). */
  y: number;
  z: number;
  /** Position at the start of the current step, for render interpolation. */
  prevX: number;
  prevY: number;
  prevZ: number;
  dirX: number;
  dirZ: number;
  /** Current ground speed along the facing (units/s; negative = backing up). People speed up and slow down, not jump. */
  speed: number;
  /** Personal pace (0.94–1.06): nobody walks in lock-step. */
  gait: number;
  /** Set when the AI moved this step (otherwise it brakes). */
  movedThisStep?: boolean;
  alive: boolean;
  jailed: boolean;
  jailedAt: number;
  capturedBy: NationId | null;
  hp: number;
  stunUntil: number;
  fakeNation: NationId | null;
  fakeUntil: number;
  /** Ranger's 疾走 (sprint) lasts until this game time. */
  sprintUntil: number;
  stamina: number;
  dashing: boolean;
  /** Cooldowns in seconds. */
  cd: { capture: number; special: number; dodge: number };
  wanderTarget: Point | null;
  memPos: Point | null;
  memTime: number;
  guardUntil: number;
  revealUntil: number;
  channeling: Channeling | null;
  susp: number;
  evidence: Evidence[];
  lastEvidenceAt: number;
  towerTicks: number;
  intercept: boolean;
  kingPersona: KingPersona | null;
  decoy: boolean;
  persona: Persona;
  capturesMade: number;
  rescuesMade: number;
  kingHits: number;
  kingCaptures: number;
  kingRescues: number;
  towerTime: number;
  dashDistance: number;
  eliminatedAt: number | null;
  meetingsLeft: number;
  enemiesSeen: Set<number>;
  /** AI perception, memory and plans (unused for the player). */
  ai: AiMemory;
}

export function maxHp(role: RoleId): number {
  return role === 'soldier' ? 3 : 1;
}

export function createEntity(id: number, nation: NationId, role: RoleId, isPlayer: boolean, rng: Rng): Entity {
  const b = NATIONS[nation].base;
  const x = b.x + (rng() * 60 - 30);
  const z = b.z + (rng() * 60 - 30);
  const intercept = rng() < 0.5;
  const kingPersona = role === 'king' ? KING_PERSONAS[Math.floor(rng() * 4)] : null;
  const persona: Persona = PERSONAS[Math.floor(rng() * 3)];
  // Face the middle of the map (the camera sits behind the facing).
  const fl = Math.hypot(x, z) || 1;
  return {
    id, nation, role, isPlayer, remote: false, tp: 0,
    x, y: 0, z, prevX: x, prevY: 0, prevZ: z, dirX: -x / fl, dirZ: -z / fl,
    speed: 0, gait: 0.94 + ((id * 37) % 13) / 100,
    alive: true, jailed: false, jailedAt: 0, capturedBy: null,
    hp: maxHp(role), stunUntil: 0, fakeNation: null, fakeUntil: 0, sprintUntil: 0,
    stamina: STAMINA_MAX, dashing: false, cd: { capture: 0, special: 0, dodge: 0 },
    wanderTarget: null, memPos: null, memTime: 0, guardUntil: 0, revealUntil: 0, channeling: null,
    // v6 compared against performance.now(), which was always well past 7s by the
    // time a match started, so evidence could be recorded immediately.
    susp: 0, evidence: [], lastEvidenceAt: -Infinity, towerTicks: 0, intercept,
    kingPersona, decoy: false, persona,
    capturesMade: 0, rescuesMade: 0, kingHits: 0, kingCaptures: 0, kingRescues: 0,
    towerTime: 0, dashDistance: 0, eliminatedAt: null,
    meetingsLeft: MEETINGS_PER_GAME, enemiesSeen: new Set(),
    ai: createAiMemory(),
  };
}

/** Moves an entity without render interpolation (teleport). */
export function teleport(e: Entity, x: number, z: number, y?: number): void {
  e.x = e.prevX = x;
  e.z = e.prevZ = z;
  e.y = e.prevY = y ?? groundAt(x, z);
  e.ai.path = null;
  e.tp++;
}

/** Controlled by a person (this screen or a friend's), not by the AI. */
export function isHuman(e: Entity): boolean {
  return e.isPlayer || e.remote;
}
