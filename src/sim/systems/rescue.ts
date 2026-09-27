import { SPECIAL_CD } from '../../config/roles';
import type { Entity } from '../entity';
import type { GameState } from '../state';
import { emit } from '../state';
import { canAct } from './capture';
import { dist3 } from './collision';
import { freeFromJail } from './jail';

export const RESCUE_START_RANGE = 50;
export const RESCUE_BREAK_RANGE = 52;
export const RESCUE_NEED_MS = 900;
export const KING_RESCUE_NEED_MS = 3600;

export function tryStartRescue(state: GameState, e: Entity): void {
  if (!canAct(state, e) || e.cd.special > 0) return;
  let target: Entity | null = null;
  for (const t of state.entities) {
    if (t.nation === e.nation && t.jailed && dist3(t, e) < RESCUE_START_RANGE) { target = t; break; }
  }
  if (!target) { emit(state, { type: 'RESCUE_NO_TARGET', rescuerId: e.id }); return; }
  e.channeling = { target, prog: 0, need: target.role === 'king' ? KING_RESCUE_NEED_MS : RESCUE_NEED_MS };
  emit(state, { type: 'RESCUE_STARTED', rescuerId: e.id, targetId: target.id });
}

export function updateRescue(state: GameState, e: Entity, dt: number): void {
  if (!e.channeling) return;
  const t = e.channeling.target;
  if (!t.jailed || !e.alive || e.jailed || e.stunUntil > state.time || dist3(e, t) > RESCUE_BREAK_RANGE) {
    if (t.role === 'king' && e.channeling.prog > 300) emit(state, { type: 'RESCUE_FAILED', rescuerId: e.id, targetId: t.id });
    e.channeling = null;
    return;
  }
  e.channeling.prog += dt * 1000;
  if (e.channeling.prog >= e.channeling.need) {
    const wasKing = t.role === 'king';
    freeFromJail(t);
    if (e.isPlayer) e.rescuesMade++;
    if (wasKing) e.kingRescues++;
    state.natStats[e.nation].res++;
    e.cd.special = wasKing ? SPECIAL_CD.keyholderKingRescue : SPECIAL_CD.keyholderRescue;
    e.channeling = null;
    emit(state, { type: 'RESCUED', rescuerId: e.id, targetId: t.id });
    if (wasKing) emit(state, { type: 'KING_RESCUED', nation: t.nation });
  }
}
