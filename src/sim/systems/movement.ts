import { PLAYER_DASH, PLAYER_TURN_RATE, PLAYER_WALK, STAMINA_DRAIN, STAMINA_MAX, STAMINA_REGEN } from '../../config/constants';
import type { Entity } from '../entity';
import type { GameState } from '../state';
import { emit, speedMul } from '../state';
import { clampMove } from './collision';

export function moveToward(e: Entity, tx: number, tz: number, dt: number, speed: number): void {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
  if (d < 2) return;
  clampMove(e, e.x + (dx / d) * speed * dt, e.z + (dz / d) * speed * dt);
  e.dirX = dx / d;
  e.dirZ = dz / d;
}

export function fleeFrom(e: Entity, threat: Entity, dt: number, speed: number): void {
  const dx = e.x - threat.x, dz = e.z - threat.z, d = Math.hypot(dx, dz) || 1;
  moveToward(e, e.x + (dx / d) * 80, e.z + (dz / d) * 80, dt, speed);
}

/**
 * Rotates e's facing toward (tx, tz) by at most maxRad. Returns true once aligned.
 */
export function turnToward(e: Entity, tx: number, tz: number, maxRad: number): boolean {
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

const FOOTSTEP_INTERVAL = 0.22;

/** Applies `state.input` (world-space direction + dash) to the player. */
export function updatePlayerMovement(state: GameState, dt: number): void {
  const p = state.player;
  if (p.jailed || !p.alive || p.channeling || p.stunUntil > state.time) {
    p.dashing = false;
    return;
  }
  let { mx, mz } = state.input;
  const moving = mx !== 0 || mz !== 0;
  const dashing = state.input.dash && p.stamina > 0 && moving;
  p.dashing = dashing;
  if (dashing) p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
  else p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * dt);
  const maxTurn = PLAYER_TURN_RATE * dt;
  if (!moving) {
    // Standing still keeps the last facing, unless the player asked to turn in place.
    const f = state.playerFaceTarget;
    if (f && turnToward(p, f.x, f.z, maxTurn)) state.playerFaceTarget = null;
    return;
  }
  state.playerFaceTarget = null;
  const len = Math.hypot(mx, mz);
  mx /= len;
  mz /= len;
  const spd = (dashing ? PLAYER_DASH : PLAYER_WALK) * speedMul(state);
  const ox = p.x, oz = p.z;
  clampMove(p, p.x + mx * spd * dt, p.z + mz * spd * dt);
  // The body turns toward the movement direction; movement itself is immediate.
  turnToward(p, mx, mz, maxTurn);
  if (dashing) {
    p.dashDistance += Math.hypot(p.x - ox, p.z - oz);
    state.footTimer -= dt;
    if (state.footTimer <= 0) {
      emit(state, { type: 'FOOTSTEP' });
      state.footTimer = FOOTSTEP_INTERVAL;
    }
  }
}
