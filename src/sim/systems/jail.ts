import type { NationId } from '../../config/nations';
import { NATIONS } from '../../config/nations';
import { JAIL_GUARD_TIME, JAIL_TIME, KING_JAIL_EXTRA, KING_RESCUE_ALERT_TIME, KING_REVEAL_TIME } from '../../config/constants';
import type { Entity } from '../entity';
import { maxHp, teleport } from '../entity';
import type { GameState } from '../state';
import { elapsedSec, emit } from '../state';
import { dist } from './collision';
import { checkWin } from './winCondition';

export function jailDuration(e: Entity): number {
  return JAIL_TIME + (e.role === 'king' ? KING_JAIL_EXTRA : 0);
}

export function sendToJail(state: GameState, e: Entity, capNation: NationId, attacker: Entity | null): void {
  const now = state.time;
  e.jailed = true;
  e.jailedAt = now;
  e.capturedBy = capNation;
  e.hp = maxHp(e.role);
  const j = NATIONS[capNation].jail;
  teleport(e, j.x + (state.rng() * 40 - 20), j.z + (state.rng() * 10 - 5));
  emit(state, { type: 'JAILED', entityId: e.id, capNation });
  if (e.role === 'king') {
    if (attacker) attacker.kingCaptures++;
    emit(state, { type: 'KING_CAPTURED', nation: e.nation });
    e.revealUntil = now + KING_REVEAL_TIME;
    state.rescueUntil[e.nation] = now + KING_RESCUE_ALERT_TIME;
    let guard: Entity | null = null, gd = 999999;
    for (const g of state.entities) {
      if (g.nation === capNation && g.role === 'soldier' && g.alive && !g.jailed) {
        const d = dist(g, j);
        if (d < gd) { guard = g; gd = d; }
      }
    }
    if (guard) guard.guardUntil = now + JAIL_GUARD_TIME;
  }
}

export function freeFromJail(e: Entity): void {
  const b = NATIONS[e.nation].base;
  e.jailed = false;
  e.capturedBy = null;
  teleport(e, b.x, b.z);
}

export function eliminate(state: GameState, e: Entity): void {
  e.alive = false;
  e.jailed = false;
  e.eliminatedAt = elapsedSec(state);
  emit(state, { type: 'ELIMINATED', entityId: e.id });
  if (e.role === 'king') checkWin(state);
}

/** Executes anyone who has been in jail longer than their sentence. */
export function updateJailTimers(state: GameState): void {
  for (const e of state.entities) {
    if (e.jailed && state.time - e.jailedAt > jailDuration(e)) eliminate(state, e);
  }
}
