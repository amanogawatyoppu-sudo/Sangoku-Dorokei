import type { Point } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import { SNIPE, TOWER } from '../config/map';
import { AI_SPEED } from '../config/constants';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { kingOf, speedMul } from '../sim/state';
import { useSpecial } from '../sim/systems/abilities';
import { attemptCapture } from '../sim/systems/capture';
import { dist } from '../sim/systems/collision';
import { fleeFrom, moveToward } from '../sim/systems/movement';
import { tryStartRescue } from '../sim/systems/rescue';

// v6 AI, ported as-is. Note: AI reads true positions (no vision checks) — kept for v7.0.

export function nearestEnemy(state: GameState, e: Entity, range: number): Entity | null {
  let best: Entity | null = null, bd = range;
  for (const t of state.entities) {
    if (t.nation === e.nation || !t.alive || t.jailed) continue;
    let d = dist(e, t);
    if (t.dashing) d -= 180;
    if (state.entities.some((x) => x.nation === t.nation && x.jailed)) d -= 15;
    if (d < bd) { best = t; bd = d; }
  }
  return best;
}

export function jailedAlly(state: GameState, e: Entity): Entity | null {
  for (const t of state.entities) if (t.nation === e.nation && t.jailed) return t;
  return null;
}

function otherBases(e: Entity): Point[] {
  return NATION_IDS.filter((n) => n !== e.nation).map((n) => NATIONS[n].base);
}

function wanderFallback(state: GameState, e: Entity, dt: number, speed: number, targets: readonly Point[]): void {
  const focus = state.teamFocus[e.nation];
  if (focus && state.rng() < 0.7) { moveToward(e, focus.x, focus.z, dt, speed); return; }
  if (!e.wanderTarget || dist(e, e.wanderTarget) < 20) e.wanderTarget = targets[Math.floor(state.rng() * targets.length)];
  moveToward(e, e.wanderTarget.x, e.wanderTarget.z, dt, speed);
}

function chaseTarget(state: GameState, e: Entity, t: Entity, dt: number, speed: number): void {
  let tx = t.x, tz = t.z;
  if (e.intercept) { tx = t.x + t.dirX * 90; tz = t.z + t.dirZ * 90; }
  const others = state.entities.filter((o) => o !== e && o.nation === e.nation && (o.role === 'soldier' || o.role === 'impostor') && o.alive && !o.jailed && dist(o, t) < 300);
  const flank = others.length > 0 && others[0].id < e.id;
  const ang = flank ? Math.PI / 2 : 0;
  const bx0 = -t.dirX * 45, bz0 = -t.dirZ * 45;
  const bx = tx + bx0 * Math.cos(ang) - bz0 * Math.sin(ang), bz = tz + bx0 * Math.sin(ang) + bz0 * Math.cos(ang);
  moveToward(e, bx, bz, dt, speed);
  if (dist(e, t) < 40) attemptCapture(state, e);
}

function kingMove(state: GameState, e: Entity, dt: number, speed: number): void {
  const enemy = nearestEnemy(state, e, e.kingPersona === 'aggressive' ? 90 : 180);
  if (e.kingPersona === 'lurker') {
    const crowd = state.entities.filter((o) => o !== e && o.alive && !o.jailed && dist(o, e) < 180).length;
    if (enemy && crowd < 1) fleeFrom(e, enemy, dt, speed * 1.1);
    else wanderFallback(state, e, dt, speed * 0.6, [NATIONS.sun.base, NATIONS.moon.base, NATIONS.star.base, { x: 0, z: 0 }]);
    return;
  }
  if (e.kingPersona === 'aggressive') {
    if (enemy && state.rng() < 0.015) attemptCapture(state, e);
    if (enemy) moveToward(e, enemy.x - enemy.dirX * 40, enemy.z - enemy.dirZ * 40, dt, speed * 0.9);
    else wanderFallback(state, e, dt, speed * 0.7, otherBases(e));
    return;
  }
  if (enemy) fleeFrom(e, enemy, dt, speed * 1.1);
  else {
    const anchor = e.kingPersona === 'commander' && state.tower.owner === e.nation ? TOWER : NATIONS[e.nation].base;
    if (!e.wanderTarget || dist(e, e.wanderTarget) < 15) {
      e.wanderTarget = { x: anchor.x + (state.rng() * 90 - 45), z: anchor.z + (state.rng() * 90 - 45) };
    }
    moveToward(e, e.wanderTarget.x, e.wanderTarget.z, dt, speed * 0.5);
  }
}

function faceToward(e: Entity, t: Entity): void {
  const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz) || 1;
  e.dirX = dx / d;
  e.dirZ = dz / d;
}

/** Enemy search radius that widens as the match goes on. */
export function aggroRange(elapsedSec: number): number {
  return Math.min(880, 480 + elapsedSec * 1.3);
}

export function aiTick(state: GameState, e: Entity, dt: number, aggro: number): void {
  const now = state.time;
  if (!e.alive || e.jailed || e.channeling || e.stunUntil > now) return;
  const speed = AI_SPEED * speedMul(state);
  if (e.guardUntil > now && e.role === 'soldier') {
    const j = NATIONS[e.nation].jail;
    const intruder = state.entities.find((t) => t.nation !== e.nation && t.alive && !t.jailed && dist(t, j) < 130);
    if (intruder) chaseTarget(state, e, intruder, dt, speed);
    else moveToward(e, j.x, j.z, dt, speed * 0.6);
    return;
  }
  const myKing = kingOf(state, e.nation);
  const rescuing = state.rescueUntil[e.nation] > now && myKing && myKing.jailed;
  if (rescuing && myKing.capturedBy && (e.role === 'soldier' || e.role === 'impostor' || e.role === 'sniper')) {
    const j = NATIONS[myKing.capturedBy].jail;
    const off = e.role === 'sniper' ? 80 : 0;
    moveToward(e, j.x + off, j.z + off, dt, speed);
    const near = nearestEnemy(state, e, 160);
    if (near) {
      if (e.role === 'sniper') { faceToward(e, near); useSpecial(state, e); }
      else if (dist(e, near) < 40) attemptCapture(state, e);
    }
    return;
  }
  if (e.role === 'king') { kingMove(state, e, dt, speed); return; }
  if (e.role === 'soldier') {
    const ally = jailedAlly(state, e);
    const enemy = nearestEnemy(state, e, aggro);
    if (enemy) { e.memPos = { x: enemy.x, z: enemy.z }; e.memTime = now; chaseTarget(state, e, enemy, dt, speed); }
    else if (ally) moveToward(e, ally.x, ally.z, dt, speed);
    else if (e.memPos && now - e.memTime < 4500) moveToward(e, e.memPos.x, e.memPos.z, dt, speed * 0.85);
    else wanderFallback(state, e, dt, speed * 0.8, [...otherBases(e), ...SNIPE]);
  } else if (e.role === 'sniper') {
    const threat = nearestEnemy(state, e, 120);
    if (threat) fleeFrom(e, threat, dt, speed * 0.9);
    const enemy = nearestEnemy(state, e, 300);
    if (enemy) { faceToward(e, enemy); useSpecial(state, e); }
    else if (!threat) wanderFallback(state, e, dt, speed * 0.55, SNIPE);
  } else if (e.role === 'communicator') {
    const threat = nearestEnemy(state, e, 100);
    if (threat && dist(e, TOWER) > TOWER.r) fleeFrom(e, threat, dt, speed);
    else if (dist(e, TOWER) > TOWER.r - 10) moveToward(e, TOWER.x, TOWER.z, dt, speed);
    else useSpecial(state, e);
  } else if (e.role === 'keyholder') {
    const ally = jailedAlly(state, e);
    if (ally && ally.capturedBy) {
      const j = NATIONS[ally.capturedBy].jail;
      moveToward(e, j.x, j.z, dt, speed);
      if (dist(e, ally) < 45) tryStartRescue(state, e);
    } else {
      const b = NATIONS[e.nation].base;
      wanderFallback(state, e, dt, speed * 0.6, [{ x: b.x + (state.rng() * 70 - 35), z: b.z + (state.rng() * 70 - 35) }]);
    }
  } else if (e.role === 'impostor') {
    const enemy = nearestEnemy(state, e, 280);
    if (enemy) {
      if (e.fakeUntil <= now && dist(e, enemy) < 180 && state.rng() < 0.01) useSpecial(state, e);
      chaseTarget(state, e, enemy, dt, speed * 0.95);
    } else wanderFallback(state, e, dt, speed * 0.7, otherBases(e));
  }
}
