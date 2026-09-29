import { GAME_TIME } from '../config/constants';
import { LIGHTS } from '../config/map';
import type { GameState } from './state';
import { elapsedSec, emit } from './state';

/**
 * Nightfall (v7.21): the match starts at dusk and ends at night. From 35% of the
 * match the light fades; by the end, vision is 70% of the day's — except for anyone
 * standing in the pool of light under a street lamp, who is seen as far as ever.
 */
export const NIGHT_START = 0.35;
export const NIGHT_VISION = 0.7;
/** Radius of a lamp's pool of light (≈9 m). */
export const LAMP_R = 240;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 at dusk … 1 at full night. */
export function nightFactor(state: GameState): number {
  if (state.tutorial) return 0;
  return smooth(NIGHT_START, 1, elapsedSec(state) / GAME_TIME);
}

// Lit ground as a coarse grid (100-unit cells), built once.
const CELL = 100;
let lit: Set<number> | null = null;
const key = (cx: number, cz: number) => cx * 100003 + cz;
function litCells(): Set<number> {
  if (lit) return lit;
  lit = new Set();
  for (const l of LIGHTS) {
    const r = Math.ceil(LAMP_R / CELL);
    const cx0 = Math.floor(l.x / CELL), cz0 = Math.floor(l.z / CELL);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const x = (cx0 + dx + 0.5) * CELL, z = (cz0 + dz + 0.5) * CELL;
      if (Math.hypot(x - l.x, z - l.z) <= LAMP_R) lit!.add(key(cx0 + dx, cz0 + dz));
    }
  }
  return lit;
}

/** Whether (x, z) is in a pool of lamp light. */
export function inLight(x: number, z: number): boolean {
  return litCells().has(key(Math.floor(x / CELL), Math.floor(z / CELL)));
}

/** How far a target at (x, z) can be seen, as a fraction of the daytime range. */
export function nightVisionMul(state: GameState, x: number, z: number): number {
  const k = nightFactor(state);
  if (k <= 0 || inLight(x, z)) return 1;
  return 1 - (1 - NIGHT_VISION) * k;
}

/** Announces the dark once (half-way into the fade). */
export function nightTick(state: GameState, dt: number): void {
  const now = elapsedSec(state), at = ((NIGHT_START + 1) / 2 - 0.2) * GAME_TIME;
  // (A small tolerance: a step landing exactly on the moment must not slip past it.)
  if (now >= at - 1e-6 && now - dt < at - 1e-6) emit(state, { type: 'NIGHTFALL' });
}
