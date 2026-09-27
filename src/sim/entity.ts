import type { NationId, Point } from '../config/nations';
import { NATIONS } from '../config/nations';
import type { KingPersona, Persona, RoleId } from '../config/roles';
import { KING_PERSONAS, PERSONAS } from '../config/roles';
import { MEETINGS_PER_GAME, STAMINA_MAX } from '../config/constants';
import type { Rng } from '../core/rng';

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
  isPlayer: boolean;
  x: number;
  z: number;
  /** Position at the start of the current step, for render interpolation. */
  prevX: number;
  prevZ: number;
  dirX: number;
  dirZ: number;
  alive: boolean;
  jailed: boolean;
  jailedAt: number;
  capturedBy: NationId | null;
  hp: number;
  stunUntil: number;
  fakeNation: NationId | null;
  fakeUntil: number;
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
  const persona: Persona = role === 'impostor' ? 'trickster' : PERSONAS[Math.floor(rng() * 3)];
  return {
    id, nation, role, isPlayer,
    x, z, prevX: x, prevZ: z, dirX: 0, dirZ: 1,
    alive: true, jailed: false, jailedAt: 0, capturedBy: null,
    hp: maxHp(role), stunUntil: 0, fakeNation: null, fakeUntil: 0,
    stamina: STAMINA_MAX, dashing: false, cd: { capture: 0, special: 0, dodge: 0 },
    wanderTarget: null, memPos: null, memTime: 0, guardUntil: 0, revealUntil: 0, channeling: null,
    // v6 compared against performance.now(), which was always well past 7s by the
    // time a match started, so evidence could be recorded immediately.
    susp: 0, evidence: [], lastEvidenceAt: -Infinity, towerTicks: 0, intercept,
    kingPersona, decoy: false, persona,
    capturesMade: 0, rescuesMade: 0, kingHits: 0, kingCaptures: 0, kingRescues: 0,
    towerTime: 0, dashDistance: 0, eliminatedAt: null,
    meetingsLeft: MEETINGS_PER_GAME, enemiesSeen: new Set(),
  };
}

/** Moves an entity without render interpolation (teleport). */
export function teleport(e: Entity, x: number, z: number): void {
  e.x = e.prevX = x;
  e.z = e.prevZ = z;
}
