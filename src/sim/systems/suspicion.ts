import { TOWER } from '../../config/map';
import { EVIDENCE_INTERVAL } from '../../config/constants';
import type { Entity } from '../entity';
import type { GameState } from '../state';
import { emit } from '../state';
import { dist, dist3, sameLevel } from './collision';

/** 1–5 star rating shown in the suspect list and meetings. */
export function suspStars(susp: number): number {
  return Math.min(5, Math.max(1, Math.ceil(susp / 20)));
}

export function pushEvidence(state: GameState, e: Entity, text: string): void {
  const now = state.time;
  if (now - e.lastEvidenceAt < EVIDENCE_INTERVAL) return;
  e.lastEvidenceAt = now;
  e.evidence.unshift({ t: now, text, stars: suspStars(e.susp) });
  if (e.evidence.length > 5) e.evidence.pop();
  emit(state, { type: 'EVIDENCE', entityId: e.id, text });
}

export function updateSuspicion(state: GameState, e: Entity, dt: number): void {
  let escort = 0;
  for (const o of state.entities) if (o !== e && o.nation === e.nation && o.alive && !o.jailed && dist(o, e) < 70 && sameLevel(o, e)) escort++;
  let fleeing = false;
  const foe = state.entities.find((t) => t.nation !== e.nation && t.alive && !t.jailed && dist3(t, e) < 300);
  if (foe) {
    const dx = e.x - foe.x, dz = e.z - foe.z, d = Math.hypot(dx, dz) || 1;
    if ((dx / d) * e.dirX + (dz / d) * e.dirZ > 0.4) fleeing = true;
  }
  const decoyBoost = e.decoy ? 0.6 : 1;
  if (escort >= 2) { e.susp = Math.min(100, e.susp + dt * 13 * decoyBoost); pushEvidence(state, e, '周りにVANGUARDが集まっていた'); }
  if (fleeing) { e.susp = Math.min(100, e.susp + dt * 9 * decoyBoost); pushEvidence(state, e, '戦闘が始まると一人だけ前線から離れた'); }
  if (dist(e, TOWER) < TOWER.r + 20) {
    e.towerTicks += dt;
    if (e.towerTicks > 4) { e.towerTicks = 0; pushEvidence(state, e, '管制塔のネットワークを頻繁に使っていた'); }
  }
  if (escort < 2 && !fleeing) e.susp = Math.max(0, e.susp - dt * 5);
}
