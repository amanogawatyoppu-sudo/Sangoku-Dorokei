import { AI_TURN_RATE, CR, PLAYER_DASH, PLAYER_QUICK_TURN_RATE, PLAYER_TURN_RATE, PLAYER_WALK, STAMINA_DRAIN, STAMINA_MAX, STAMINA_REGEN } from '../../config/constants';
import type { Entity } from '../entity';
import type { GameState } from '../state';
import { emit, speedMul } from '../state';
import { SAME_LEVEL } from './collision';
import { blocked, moveBody, settle } from './world';

/**
 * AI walking: the body turns toward (tx, tz) at AI_TURN_RATE and moves along its
 * current facing, slowing down while it still points the wrong way. So an AI
 * cannot reverse on the spot: turning takes time, as for the player.
 */
export function moveToward(e: Entity, tx: number, tz: number, dt: number, speed: number): void {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
  if (d < 2) return;
  turnToward(e, dx, dz, AI_TURN_RATE * dt);
  const align = (e.dirX * dx + e.dirZ * dz) / d;
  const step = Math.min(d, speed * dt * Math.max(0.15, align));
  moveBody(e, e.x + e.dirX * step, e.z + e.dirZ * step);
}

export function fleeFrom(e: Entity, threat: Entity, dt: number, speed: number): void {
  const dx = e.x - threat.x, dz = e.z - threat.z, d = Math.hypot(dx, dz) || 1;
  moveToward(e, e.x + (dx / d) * 80, e.z + (dz / d) * 80, dt, speed);
}

/**
 * Rotates e's facing toward (tx, tz) by at most maxRad. Returns true once aligned.
 */
export function turnToward(e: Pick<Entity, 'dirX' | 'dirZ'>, tx: number, tz: number, maxRad: number): boolean {
  if (tx === 0 && tz === 0) return true;
  const cur = Math.atan2(e.dirX, e.dirZ);
  const tgt = Math.atan2(tx, tz);
  let diff = tgt - cur;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const done = Math.abs(diff) <= maxRad;
  const a = done ? tgt : cur + Math.sign(diff) * maxRad;
  e.dirX = Math.sin(a);
  e.dirZ = Math.cos(a);
  return done;
}

/** Rotates facing by `rad` (positive = clockwise seen from above = turning right). */
export function turnBy(e: Pick<Entity, 'dirX' | 'dirZ'>, rad: number): void {
  const a = Math.atan2(e.dirX, e.dirZ) - rad;
  e.dirX = Math.sin(a);
  e.dirZ = Math.cos(a);
}

/** Backward walking is slower than forward. */
export const BACKWARD_FACTOR = 0.6;
const FOOTSTEP_INTERVAL = 0.22;

/**
 * Character-relative controls: `input.forward` moves along the facing (negative =
 * back away without turning), `input.turn` turns the body (A/D). The camera sits
 * behind the facing, so input → facing → view stay connected.
 */
export function updatePlayerMovement(state: GameState, dt: number): void {
  const p = state.player;
  if (p.jailed || !p.alive || p.channeling || p.stunUntil > state.time) {
    p.dashing = false;
    return;
  }
  const { forward, turn } = state.input;
  if (turn !== 0) {
    state.playerFaceTarget = null;
    turnBy(p, Math.max(-1, Math.min(1, turn)) * PLAYER_TURN_RATE * dt);
  } else if (state.playerFaceTarget) {
    const f = state.playerFaceTarget;
    if (turnToward(p, f.x, f.z, PLAYER_QUICK_TURN_RATE * dt)) state.playerFaceTarget = null;
  }
  const f = Math.max(-1, Math.min(1, forward));
  const moving = f !== 0;
  const dashing = state.input.dash && p.stamina > 0 && moving;
  p.dashing = dashing;
  if (dashing) p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
  else p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * dt);
  if (!moving) return;
  const spd = (dashing ? PLAYER_DASH : PLAYER_WALK) * speedMul(state) * (f < 0 ? BACKWARD_FACTOR : 1) * Math.abs(f);
  const sign = f < 0 ? -1 : 1;
  const ox = p.x, oz = p.z;
  moveBody(p, p.x + p.dirX * sign * spd * dt, p.z + p.dirZ * sign * spd * dt);
  if (dashing) {
    p.dashDistance += Math.hypot(p.x - ox, p.z - oz);
    state.footTimer -= dt;
    if (state.footTimer <= 0) {
      emit(state, { type: 'FOOTSTEP' });
      state.footTimer = FOOTSTEP_INTERVAL;
    }
  }
}

/** Everyone lands on the floor under them (stairs up, drops down). */
export function settleAll(state: GameState, dt: number): void {
  for (const e of state.entities) if (e.alive && !e.jailed) settle(e, dt);
}

/**
 * Soft separation so characters on the same level never stack on one spot.
 * Each overlapping pair is pushed apart along the line between them.
 */
export function separate(state: GameState): void {
  const es = state.entities.filter((e) => e.alive && !e.jailed);
  const minD = CR * 2;
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      const a = es[i], b = es[j];
      if (Math.abs(a.y - b.y) > SAME_LEVEL) continue;
      let dx = b.x - a.x, dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d >= minD) continue;
      if (d < 1e-3) { dx = ((a.id * 7 + b.id * 13) % 10) / 10 - 0.45; dz = 0.5; d = Math.hypot(dx, dz); }
      const push = (minD - d) / 2;
      const ux = dx / d, uz = dz / d;
      if (!blocked(a.x - ux * push, a.z - uz * push, a.y)) { a.x -= ux * push; a.z -= uz * push; }
      if (!blocked(b.x + ux * push, b.z + uz * push, b.y)) { b.x += ux * push; b.z += uz * push; }
    }
  }
}
