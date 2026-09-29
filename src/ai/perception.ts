import { NATIONS } from '../config/nations';
import { DASH_VISION_BONUS, VISION } from '../config/constants';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { dist3 } from '../sim/systems/collision';
import { hasLineOfSight, inRevealedJail, nearTower, scopeRange } from '../sim/systems/vision';
import { atWar } from '../sim/war';
import { kingLit } from '../sim/systems/tower';
import { nightVisionMul } from '../sim/night';
import type { Sighting } from './memory';

/**
 * What an AI can know about an enemy right now. No wall-hacks: an enemy is
 * perceived only if it is in the AI's field of view with a clear 3D line of
 * sight, close enough to be heard, or exposed by a game rule everyone shares
 * (radar, the tower, a king's reveal, a revealed jail).
 */

/** Half-angle of the view cone (cos). ±70°: sneaking up from behind works. */
export const FOV_COS = Math.cos((70 * Math.PI) / 180);
/** Footsteps within this range are heard through walls (same rough level). */
export const HEAR_RANGE = 110;
/** A dashing character is heard much further away. */
export const HEAR_DASH_RANGE = 320;
/** How long a nation keeps a shared report alive (ms). */
export const INTEL_TTL = 9000;

/** Perception refresh interval per AI (ms). */
export const PERCEIVE_MS = 200;

/** True if `target` looks like a friend to `observer` (impostor disguised as the observer's nation). */
export function looksFriendly(state: GameState, observer: Entity, target: Entity): boolean {
  // Ceasefire partners are left alone for the length of the truce.
  return target.nation === observer.nation || (target.fakeUntil > state.time && target.fakeNation === observer.nation) || !atWar(state, observer.nation, target.nation);
}

export function canPerceive(state: GameState, observer: Entity, target: Entity): boolean {
  if (!target.alive || target.jailed || looksFriendly(state, observer, target)) return false;
  const now = state.time;
  if (target.revealUntil > now || state.radarAll > now || state.radar[observer.nation] > now) return true;
  if (kingLit(state, target, observer.nation)) return true;
  if (nearTower(target) || inRevealedJail(state, target)) return true;
  if (state.terminalActive[target.nation] > now && Math.hypot(target.x - NATIONS[target.nation].base.x, target.z - NATIONS[target.nation].base.z) < 90) return true;
  const d = dist3(observer, target);
  const night = nightVisionMul(state, target.x, target.z);
  if (d > Math.max(VISION + (target.dashing ? DASH_VISION_BONUS : 0), scopeRange(observer, target)) * night) return false;
  const dy = Math.abs(target.y - observer.y);
  if (dy < 40 && (d < HEAR_RANGE || (target.dashing && d < HEAR_DASH_RANGE))) return true;
  const len = Math.hypot(target.x - observer.x, target.z - observer.z) || 1;
  const facing = ((target.x - observer.x) * observer.dirX + (target.z - observer.z) * observer.dirZ) / len;
  // Alert AIs look around more (wider cone).
  const cone = FOV_COS - observer.ai.alert * 0.6;
  if (facing < cone) return false;
  return hasLineOfSight(observer, target);
}

function record(prev: Sighting | undefined, t: Entity, now: number): Sighting {
  let vx = 0, vz = 0;
  if (prev && now - prev.t > 0 && now - prev.t < 1500) {
    const dt = (now - prev.t) / 1000;
    vx = (t.x - prev.x) / dt;
    vz = (t.z - prev.z) / dt;
    // Smooth the estimate.
    vx = prev.vx * 0.4 + vx * 0.6;
    vz = prev.vz * 0.4 + vz * 0.6;
  }
  const since = prev && now - prev.t < 1500 ? prev.since : now;
  return { id: t.id, x: t.x, y: t.y, z: t.z, t: now, vx, vz, since };
}

/** Refreshes one AI's view of the world and shares sightings with its nation. */
export function perceive(state: GameState, e: Entity): void {
  const now = state.time;
  const ai = e.ai;
  ai.visible = [];
  const intel = state.factions[e.nation].intel;
  for (const t of state.entities) {
    if (t.nation === e.nation || !canPerceive(state, e, t)) continue;
    ai.visible.push(t.id);
    const s = record(ai.seen.get(t.id), t, now);
    ai.seen.set(t.id, s);
    intel.set(t.id, s);
  }
  ai.alert = ai.visible.length ? 1 : Math.max(0, ai.alert - PERCEIVE_MS / 6000);
  for (const [id, s] of ai.seen) if (now - s.t > 20000) ai.seen.delete(id);
}

/** Where an enemy probably is now, from a sighting (clamped extrapolation). */
export function predict(s: Sighting, now: number, maxAhead = 1.5): { x: number; y: number; z: number } {
  const dt = Math.min(maxAhead, (now - s.t) / 1000);
  return { x: s.x + s.vx * dt, y: s.y, z: s.z + s.vz * dt };
}
