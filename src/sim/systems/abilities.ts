import { RADAR_TIME, SPRINT_TIME, STUN_TIME } from '../../config/constants';
import { SPECIAL_CD } from '../../config/roles';
import type { Entity } from '../entity';
import type { GameState } from '../state';
import { emit } from '../state';
import { canAct } from './capture';
import { nearTowerBase } from './towerZone';
import { effNation, hasLineOfSight } from './vision';
import { atWar } from '../war';
import { canRescue, rescueTargetNear, tryStartRescue } from './rescue';

/** Sniper range (≈20 m), ×1.25 when shooting down from 60+ above the target (rooftops, footbridges, hills). */
export const SNIPE_RANGE = 520;
export const SNIPE_HIGH_BONUS = 1.25;
/** Targets within ±30° of the facing can be shot (aim assist: the shooter turns to face them). */
export const SNIPE_AIM_COS = Math.cos((30 * Math.PI) / 180);

/**
 * Who a sniper's shot would hit right now: the enemy in range, inside the aim cone
 * and in the clear line of sight that is closest to the centre of the aim (and nearer).
 * Shared by the shot itself, the player's red laser / reticle and the AI.
 */
export function sniperTarget(state: GameState, e: Entity): Entity | null {
  let best: Entity | null = null, bs = Infinity;
  for (const t of state.entities) {
    if (t.nation === e.nation || !atWar(state, e.nation, t.nation) || !t.alive || t.jailed || effNation(state, t, e.nation) === e.nation) continue;
    const vx = t.x - e.x, vz = t.z - e.z, flat = Math.hypot(vx, vz) || 1;
    const range = SNIPE_RANGE * (e.y - t.y > 60 ? SNIPE_HIGH_BONUS : 1);
    const d = Math.hypot(vx, vz, t.y - e.y);
    const dot = (vx / flat) * e.dirX + (vz / flat) * e.dirZ;
    if (d > range || dot < SNIPE_AIM_COS) continue;
    const score = Math.acos(Math.min(1, dot)) + (d / range) * 0.35;
    if (score < bs && hasLineOfSight(e, t)) { best = t; bs = score; }
  }
  return best;
}

/**
 * The Z / 特殊 action: keyholders rescue. The king (always) and the last of a nation
 * still free rescue too when a jailed ally is within reach; otherwise their special.
 */
export function activate(state: GameState, e: Entity): void {
  if (e.role === 'keyholder') tryStartRescue(state, e);
  else if (canRescue(state, e) && rescueTargetNear(state, e)) tryStartRescue(state, e);
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
    const best = sniperTarget(state, e);
    if (!best) {
      // Nothing in the sights: no shot, no reload (just a moment before trying again).
      e.cd.special = 0.4;
      emit(state, { type: 'ABILITY', entityId: e.id, result: 'sniper_miss' });
      return;
    }
    e.cd.special = SPECIAL_CD.sniper;
    // Aim assist: swing to face the target as the shot goes off.
    const l = Math.hypot(best.x - e.x, best.z - e.z) || 1;
    e.dirX = (best.x - e.x) / l;
    e.dirZ = (best.z - e.z) / l;
    best.stunUntil = now + STUN_TIME;
    emit(state, { type: 'ABILITY', entityId: e.id, result: 'sniper_stun', targetId: best.id });
  } else if (e.role === 'communicator') {
    if (!nearTowerBase(e, 16)) {
      emit(state, { type: 'ABILITY', entityId: e.id, result: 'radar_outside_tower' });
      return;
    }
    e.cd.special = SPECIAL_CD.communicator;
    state.radar[e.nation] = now + RADAR_TIME;
    emit(state, { type: 'ABILITY', entityId: e.id, result: 'radar' });
  } else if (e.role === 'ranger') {
    e.cd.special = SPECIAL_CD.ranger;
    e.sprintUntil = now + SPRINT_TIME;
    emit(state, { type: 'ABILITY', entityId: e.id, result: 'sprint' });
  }
}

export function tickCooldowns(state: GameState, dt: number): void {
  for (const e of state.entities) {
    e.cd.capture = Math.max(0, e.cd.capture - dt);
    e.cd.special = Math.max(0, e.cd.special - dt);
    e.cd.dodge = Math.max(0, e.cd.dodge - dt);
  }
}
