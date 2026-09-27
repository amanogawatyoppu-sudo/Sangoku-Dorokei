import type { NationId } from '../../config/nations';
import { NATION_IDS, NATIONS } from '../../config/nations';
import { TOWER } from '../../config/map';
import { DASH_VISION_BONUS, SCOPE_COS, SCOPE_RANGE, VISION } from '../../config/constants';
import type { Entity } from '../entity';
import type { GameState } from '../state';
import { dist, dist3 } from './collision';
import { CHEST_H, EYE_H, lineOfSight } from './world';

/** Nation `e` appears to belong to when seen by `viewerNation` (impostor disguise). */
export function effNation(state: GameState, e: Entity, viewerNation: NationId): NationId {
  return e.fakeUntil > state.time && e.fakeNation && e.nation !== viewerNation ? e.fakeNation : e.nation;
}

export function visibleTo(state: GameState, e: Entity, viewer: Entity): boolean {
  const now = state.time;
  if (e.nation === viewer.nation) return true;
  if (e.revealUntil > now) return true;
  if (state.radarAll > now) return true;
  if (state.radar[viewer.nation] > now) return true;
  if (nearTower(e)) return true;
  if (inRevealedJail(state, e)) return true;
  if (state.terminalActive[e.nation] > now && dist(e, NATIONS[e.nation].base) < 90) return true;
  const rng = Math.max(e.dashing ? VISION + DASH_VISION_BONUS : VISION, scopeRange(viewer, e));
  return dist3(e, viewer) < rng && hasLineOfSight(viewer, e);
}

/** A sniper's scope reaches SCOPE_RANGE inside a narrow cone ahead (0 otherwise). */
export function scopeRange(viewer: Entity, target: Entity): number {
  if (viewer.role !== 'sniper') return 0;
  const vx = target.x - viewer.x, vz = target.z - viewer.z, d = Math.hypot(vx, vz) || 1;
  return (vx * viewer.dirX + vz * viewer.dirZ) / d >= SCOPE_COS ? SCOPE_RANGE : 0;
}

/** Standing at the foot of the watchtower exposes you to everyone (v6 rule). */
export function nearTower(e: Entity): boolean {
  return dist(e, TOWER) < TOWER.r + 40 && e.y < 30;
}

/** Radius around a jail that a king capture exposes to all nations. */
export const JAIL_REVEAL_RADIUS = 260;

/** After a king is captured, everyone near that jail is visible to all nations for a while. */
export function inRevealedJail(state: GameState, e: Entity): boolean {
  for (const n of NATION_IDS) {
    if (state.jailReveal[n] > state.time && dist(e, NATIONS[n].jail) < JAIL_REVEAL_RADIUS) return true;
  }
  return false;
}

/** Eye-to-chest 3D sight line (walls, floors, hills and buildings block; water does not). */
export function hasLineOfSight(viewer: Entity, target: Entity): boolean {
  return lineOfSight(viewer.x, viewer.y + EYE_H, viewer.z, target.x, target.y + CHEST_H, target.z);
}

/** Records which enemies the player has laid eyes on (result screen stat). */
export function updateEnemiesSeen(state: GameState): void {
  const p = state.player;
  for (const e of state.entities) {
    if (e !== p && e.nation !== p.nation && e.alive && visibleTo(state, e, p)) p.enemiesSeen.add(e.id);
  }
}
