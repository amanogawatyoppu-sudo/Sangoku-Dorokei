import { NATION_IDS } from '../../config/nations';
import { TOWER } from '../../config/map';
import { TOWER_CHANNEL } from '../../config/constants';
import type { GameState } from '../state';
import { emit } from '../state';
import { dist } from './collision';

export function towerTick(state: GameState, dt: number): void {
  const inside = { sun: false, moon: false, star: false };
  for (const e of state.entities) if (e.alive && !e.jailed && dist(e, TOWER) < TOWER.r) inside[e.nation] = true;
  const contest = Object.values(inside).filter(Boolean).length;
  for (const n of NATION_IDS) {
    if (inside[n] && contest === 1) {
      const hasComm = state.entities.some((e) => e.nation === n && e.role === 'communicator' && dist(e, TOWER) < TOWER.r && e.alive && !e.jailed);
      const rate = hasComm ? 1.6 : 1;
      state.tower.channel[n] += dt * 1000 * rate;
      state.natStats[n].tower += dt;
      // v6: the player's tower stat counts whenever their nation holds the tower.
      if (state.player.nation === n) state.player.towerTime += dt;
      if (state.tower.channel[n] >= TOWER_CHANNEL && state.tower.owner !== n) {
        state.tower.owner = n;
        emit(state, { type: 'TOWER_CAPTURED', nation: n });
      }
    } else if (!inside[n]) state.tower.channel[n] = Math.max(0, state.tower.channel[n] - dt * 500);
  }
}
