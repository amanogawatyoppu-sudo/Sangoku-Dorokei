import type { NationId } from '../src/config/nations';
import { NATIONS } from '../src/config/nations';
import type { RoleId } from '../src/config/roles';
import { FixedStepClock, STEP_MS } from '../src/core/clock';
import { createRng } from '../src/core/rng';
import type { Entity } from '../src/sim/entity';
import { teleport } from '../src/sim/entity';
import { advanceFrame } from '../src/sim/game';
import type { GameState } from '../src/sim/state';
import { createGameState } from '../src/sim/state';

/** Open, flat ground (south-west field) with no world geometry within ~100 units. */
export const SPOT = { x: -700, z: 420 };

export function newGame(nation: NationId = 'sun', role: RoleId = 'soldier', seed = 1): GameState {
  return createGameState(nation, role, createRng(seed));
}

export function find(state: GameState, nation: NationId, role: RoleId): Entity {
  return state.entities.find((e) => e.nation === nation && e.role === role)!;
}

/** Runs the real frame driver for `ms` of wall-clock time at ~60fps. */
export function runFrames(state: GameState, ms: number, clock = new FixedStepClock()): void {
  const frames = Math.round(ms / STEP_MS);
  for (let i = 0; i < frames; i++) advanceFrame(state, clock, STEP_MS);
}

export function placeAtBase(e: Entity): void {
  const b = NATIONS[e.nation].base;
  teleport(e, b.x, b.z);
}

/**
 * Freezes everyone except the listed entities in place so a test can control
 * interactions without AI interference (stunned entities skip AI and actions).
 */
export function freezeOthers(state: GameState, keep: Entity[]): void {
  for (const e of state.entities) if (!keep.includes(e)) e.stunUntil = Infinity;
}
