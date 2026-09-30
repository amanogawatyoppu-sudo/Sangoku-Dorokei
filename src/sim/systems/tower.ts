import { NATION_IDS } from '../../config/nations';
import { GAME_TIME, KING_BEACON_CD, KING_BEACON_TIME, TOWER_CHANNEL } from '../../config/constants';
import type { NationId } from '../../config/nations';
import type { GameState } from '../state';
import { emit, timeLeftSec } from '../state';
import { nearTowerBase } from './towerZone';

export function towerTick(state: GameState, dt: number): void {
  const inside = { sun: false, moon: false, star: false };
  for (const e of state.entities) if (e.alive && !e.jailed && nearTowerBase(e)) inside[e.nation] = true;
  const contest = Object.values(inside).filter(Boolean).length;
  for (const n of NATION_IDS) {
    if (inside[n] && contest === 1) {
      const hasComm = state.entities.some((e) => e.nation === n && e.role === 'communicator' && nearTowerBase(e) && e.alive && !e.jailed);
      const rate = hasComm ? 1.6 : 1;
      state.tower.channel[n] += dt * 1000 * rate;
      state.natStats[n].tower += dt;
      // v6: the player's tower stat counts whenever their nation holds the tower.
      for (const id of state.humans) if (state.entities[id].nation === n) state.entities[id].towerTime += dt;
      if (state.tower.channel[n] >= TOWER_CHANNEL && state.tower.owner !== n) {
        state.tower.owner = n;
        emit(state, { type: 'TOWER_CAPTURED', nation: n });
      }
    } else if (!inside[n]) state.tower.channel[n] = Math.max(0, state.tower.channel[n] - dt * 500);
  }
  const left = timeLeftSec(state);
  if (left <= GAME_TIME / 3 + 1e-6 && left + dt > GAME_TIME / 3 + 1e-6) emit(state, { type: 'BEACON_PHASE' });
  // Commanders of a nation without people in it light the kings when their hunters are ready (ai/faction.ts).
}

/** The last third of the match: the tower can light up the kings. */
export function beaconPhase(state: GameState): boolean {
  return timeLeftSec(state) <= GAME_TIME / 3;
}

/** Whether nation n may light the enemy kings now (holds the tower, last third, not recharging, not already lit). */
export function canLightKings(state: GameState, n: NationId): boolean {
  return state.tower.owner === n && beaconPhase(state) && state.time >= state.beaconReadyAt[n] && state.kingBeacon[n] <= state.time && !state.over
    && state.entities.some((e) => e.nation === n && e.alive && !e.jailed);
}

/**
 * The tower's holder lights up every enemy king for a while: they are visible to
 * that nation wherever they are (a pillar of light over them), and its commanders
 * know exactly who and where the kings are.
 */
export function lightKings(state: GameState, n: NationId): boolean {
  if (!canLightKings(state, n)) return false;
  const now = state.time;
  state.kingBeacon[n] = now + KING_BEACON_TIME;
  state.beaconReadyAt[n] = now + KING_BEACON_CD;
  const f = state.factions[n];
  for (const k of state.entities) {
    if (!kingLit(state, k, n)) continue;
    f.intel.set(k.id, { id: k.id, x: k.x, y: k.y, z: k.z, vx: 0, vz: 0, t: now, since: now });
    f.belief.set(k.id, 5);
  }
  emit(state, { type: 'KING_BEACON', nation: n, untilMs: KING_BEACON_TIME });
  return true;
}

/** Whether nation `viewer` sees king `k` lit up right now. */
export function kingLit(state: GameState, k: { id: number; role: string; nation: NationId; alive: boolean; jailed: boolean }, viewer: NationId): boolean {
  if (k.nation === viewer || !k.alive || k.jailed || state.kingBeacon[viewer] <= state.time) return false;
  // While a double (影武者) stands in, the light falls on the double instead.
  const d = state.decoy[k.nation];
  if (d && d.until > state.time && state.entities[d.id].alive && !state.entities[d.id].jailed) return k.id === d.id;
  return k.role === 'king';
}
