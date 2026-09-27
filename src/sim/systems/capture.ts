import { CAP_HEIGHT, CAP_RANGE } from '../../config/constants';
import { CAPTURE_CD, KING_DODGE_CD } from '../../config/roles';
import type { Entity } from '../entity';
import type { GameState } from '../state';
import { emit } from '../state';
import { dist } from './collision';
import { sendToJail } from './jail';

export type CaptureTier = 'front' | 'side' | 'back' | 'deepback';

/** Which side of `target` the attacker is on, based on the target's facing. */
export function captureTier(target: Entity, attacker: Entity): CaptureTier {
  const vx = attacker.x - target.x, vz = attacker.z - target.z, len = Math.hypot(vx, vz) || 1;
  const dot = (vx / len) * target.dirX + (vz / len) * target.dirZ;
  if (dot >= 0.15) return 'front';
  if (dot <= -0.85) return 'deepback';
  if (dot <= -0.5) return 'back';
  return 'side';
}

export function canAct(state: GameState, e: Entity): boolean {
  return e.alive && !e.jailed && !e.channeling && e.stunUntil <= state.time;
}

/** Nearest enemy in range that the attacker is not in front of: who a capture would target. */
export function captureCandidate(state: GameState, attacker: Entity): Entity | null {
  let best: Entity | null = null, bd = CAP_RANGE;
  for (const t of state.entities) {
    if (t.nation === attacker.nation || !t.alive || t.jailed) continue;
    // Same floor only: someone directly above or below cannot be grabbed.
    if (Math.abs(t.y - attacker.y) > CAP_HEIGHT) continue;
    const d = dist(t, attacker);
    if (d < bd && captureTier(t, attacker) !== 'front') { best = t; bd = d; }
  }
  return best;
}

export function attemptCapture(state: GameState, attacker: Entity): void {
  const now = state.time;
  if (!canAct(state, attacker)) return;
  if (attacker.cd.capture > 0) return;
  attacker.cd.capture = CAPTURE_CD;
  const best = captureCandidate(state, attacker);
  if (!best) return;
  const tier = captureTier(best, attacker);
  if (tier === 'side' && state.rng() < 0.5) { emit(state, { type: 'CAPTURE_FAILED', attackerId: attacker.id, reason: 'side' }); return; }
  if (tier === 'back' && state.rng() < 0.15) { emit(state, { type: 'CAPTURE_FAILED', attackerId: attacker.id, reason: 'back' }); return; }
  if (attacker.role === 'impostor' && attacker.fakeUntil > now) {
    attacker.fakeUntil = 0;
    emit(state, { type: 'IMPOSTOR_EXPOSED', nation: attacker.nation });
  }
  if (best.role === 'king') {
    state.natStats[attacker.nation].hit++;
    if (attacker.isPlayer) attacker.kingHits++;
    if (best.cd.dodge <= 0 && state.rng() < 0.2) {
      best.cd.dodge = KING_DODGE_CD;
      emit(state, { type: 'KING_DODGED', nation: best.nation });
      return;
    }
  }
  if (best.role === 'soldier' && best.hp > 1 && best.stunUntil <= now) {
    best.hp--;
    emit(state, { type: 'SOLDIER_ENDURED', nation: best.nation, hp: best.hp });
    return;
  }
  emit(state, { type: 'CAPTURE', attackerId: attacker.id, targetId: best.id });
  attacker.capturesMade++;
  state.natStats[attacker.nation].cap++;
  sendToJail(state, best, attacker.nation, attacker);
}
