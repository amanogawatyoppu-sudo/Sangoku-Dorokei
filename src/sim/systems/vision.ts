import type { NationId } from '../../config/nations';
import { NATIONS } from '../../config/nations';
import { TOWER } from '../../config/map';
import { DASH_VISION_BONUS, VISION } from '../../config/constants';
import type { Entity } from '../entity';
import type { GameState } from '../state';
import { dist, lineClear } from './collision';

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
  if (dist(e, TOWER) < TOWER.r + 40) return true;
  if (state.terminalActive[e.nation] > now && dist(e, NATIONS[e.nation].base) < 90) return true;
  const rng = e.dashing ? VISION + DASH_VISION_BONUS : VISION;
  return dist(e, viewer) < rng && lineClear(e.x, e.z, viewer.x, viewer.z);
}

/** Records which enemies the player has laid eyes on (result screen stat). */
export function updateEnemiesSeen(state: GameState): void {
  const p = state.player;
  for (const e of state.entities) {
    if (e !== p && e.nation !== p.nation && e.alive && visibleTo(state, e, p)) p.enemiesSeen.add(e.id);
  }
}
