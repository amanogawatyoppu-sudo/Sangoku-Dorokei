import { NATION_IDS } from '../../config/nations';
import { DISGUISE_TIME, RADAR_TIME, STUN_TIME } from '../../config/constants';
import { SPECIAL_CD } from '../../config/roles';
import type { Entity } from '../entity';
import type { GameState } from '../state';
import { emit } from '../state';
import { canAct } from './capture';
import { nearTowerBase } from './towerZone';
import { hasLineOfSight } from './vision';
import { tryStartRescue } from './rescue';

export const SNIPE_RANGE = 280;

/** The E / 特殊 action: keyholders rescue, everyone else uses their role's special. */
export function activate(state: GameState, e: Entity): void {
  if (e.role === 'keyholder') tryStartRescue(state, e);
  else useSpecial(state, e);
}

export function useSpecial(state: GameState, e: Entity): void {
  if (!canAct(state, e) || e.cd.special > 0) return;
  const now = state.time;
  if (e.role === 'king') {
    e.cd.special = SPECIAL_CD.king;
    e.cd.dodge = 0;
    emit(state, { type: 'ABILITY', entityId: e.id, result: 'king_dodge' });
  } else if (e.role === 'soldier') {
    e.cd.special = SPECIAL_CD.soldier;
    e.hp = 3;
    emit(state, { type: 'ABILITY', entityId: e.id, result: 'soldier_heal' });
  } else if (e.role === 'sniper') {
    e.cd.special = SPECIAL_CD.sniper;
    let best: Entity | null = null, bd = SNIPE_RANGE;
    for (const t of state.entities) {
      if (t.nation === e.nation || !t.alive || t.jailed) continue;
      const vx = t.x - e.x, vz = t.z - e.z, d = Math.hypot(vx, vz, t.y - e.y) || 1, dot = (vx / d) * e.dirX + (vz / d) * e.dirZ;
      if (d < bd && dot > 0.5 && hasLineOfSight(e, t)) { best = t; bd = d; }
    }
    if (best) {
      best.stunUntil = now + STUN_TIME;
      emit(state, { type: 'ABILITY', entityId: e.id, result: 'sniper_stun', targetId: best.id });
    } else emit(state, { type: 'ABILITY', entityId: e.id, result: 'sniper_miss' });
  } else if (e.role === 'communicator') {
    if (!nearTowerBase(e, 16)) {
      emit(state, { type: 'ABILITY', entityId: e.id, result: 'radar_outside_tower' });
      return;
    }
    e.cd.special = SPECIAL_CD.communicator;
    state.radar[e.nation] = now + RADAR_TIME;
    emit(state, { type: 'ABILITY', entityId: e.id, result: 'radar' });
  } else if (e.role === 'impostor') {
    e.cd.special = SPECIAL_CD.impostor;
    const other = NATION_IDS.filter((n) => n !== e.nation);
    e.fakeNation = other[Math.floor(state.rng() * other.length)];
    e.fakeUntil = now + DISGUISE_TIME;
    emit(state, { type: 'ABILITY', entityId: e.id, result: 'disguise' });
  }
}

export function tickCooldowns(state: GameState, dt: number): void {
  for (const e of state.entities) {
    e.cd.capture = Math.max(0, e.cd.capture - dt);
    e.cd.special = Math.max(0, e.cd.special - dt);
    e.cd.dodge = Math.max(0, e.cd.dodge - dt);
  }
}
