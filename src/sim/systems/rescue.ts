import { SPECIAL_CD } from '../../config/roles';
import type { NationId } from '../../config/nations';
import type { Entity } from '../entity';
import { isHuman } from '../entity';
import type { GameState } from '../state';
import { emit } from '../state';
import { canAct } from './capture';
import { dist3 } from './collision';
import { freeFromJail } from './jail';

export const RESCUE_START_RANGE = 50;
export const RESCUE_BREAK_RANGE = 52;
export const RESCUE_NEED_MS = 900;
export const KING_RESCUE_NEED_MS = 3600;
/** Anyone but a keyholder takes this much longer to open a lock. */
export const NON_KEYHOLDER_RESCUE_MUL = 1.5;

/** Members of a nation still free to act (alive, not in a jail). */
export function freeMembers(state: GameState, n: NationId): Entity[] {
  return state.entities.filter((o) => o.nation === n && o.alive && !o.jailed);
}

/** The only one of its nation still free (everyone else is jailed or executed). */
export function lastStanding(state: GameState, e: Entity): boolean {
  if (!e.alive || e.jailed) return false;
  return !state.entities.some((o) => o !== e && o.nation === e.nation && o.alive && !o.jailed);
}

/**
 * Who can open a jail: keyholders; the king, always; and whoever is the last of
 * their nation still free (so losing the keyholders is not the end).
 */
export function canRescue(state: GameState, e: Entity): boolean {
  return e.role === 'keyholder' || e.role === 'king' || lastStanding(state, e);
}

/** A jailed ally within reach of the lock (the king first). */
export function rescueTargetNear(state: GameState, e: Entity): Entity | null {
  let best: Entity | null = null;
  for (const t of state.entities) {
    if (t.nation !== e.nation || !t.jailed || dist3(t, e) >= RESCUE_START_RANGE) continue;
    if (!best || t.role === 'king') best = t;
  }
  return best;
}

export function tryStartRescue(state: GameState, e: Entity): void {
  if (!canAct(state, e) || e.cd.special > 0 || !canRescue(state, e)) return;
  const target = rescueTargetNear(state, e);
  if (!target) { emit(state, { type: 'RESCUE_NO_TARGET', rescuerId: e.id }); return; }
  const need = target.role === 'king' ? KING_RESCUE_NEED_MS : RESCUE_NEED_MS;
  e.channeling = { target, prog: 0, need: need * (e.role === 'keyholder' ? 1 : NON_KEYHOLDER_RESCUE_MUL) };
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
    if (isHuman(e)) e.rescuesMade++;
    if (wasKing) e.kingRescues++;
    state.natStats[e.nation].res++;
    e.cd.special = wasKing ? SPECIAL_CD.keyholderKingRescue : SPECIAL_CD.keyholderRescue;
    e.channeling = null;
    emit(state, { type: 'RESCUED', rescuerId: e.id, targetId: t.id });
    if (wasKing) emit(state, { type: 'KING_RESCUED', nation: t.nation });
  }
}
