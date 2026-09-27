import { NATION_IDS, NATIONS, nationCss } from '../config/nations';
import { OBST, TOWER } from '../config/map';
import type { GameState } from '../sim/state';
import { effNation, visibleTo } from '../sim/systems/vision';
import { $ } from './dom';

const SIZE = 150;
const SX = SIZE / 2200, SY = SIZE / 1400, OX = 1100, OY = 700;

export class Minimap {
  private ctx = ($('mini') as HTMLCanvasElement).getContext('2d')!;

  draw(state: GameState): void {
    const MX = this.ctx, p = state.player;
    MX.clearRect(0, 0, SIZE, SIZE);
    MX.fillStyle = '#0a0f18';
    MX.fillRect(0, 0, SIZE, SIZE);
    for (const o of OBST) {
      MX.fillStyle = '#2a3648';
      MX.fillRect((o.x + OX - o.w / 2) * SX, (o.z + OY - o.d / 2) * SY, o.w * SX, o.d * SY);
    }
    for (const n of NATION_IDS) {
      const j = NATIONS[n].jail;
      MX.strokeStyle = nationCss(n);
      MX.strokeRect((j.x + OX - j.w / 2) * SX, (j.z + OY - j.d / 2) * SY, j.w * SX, j.d * SY);
    }
    MX.beginPath();
    MX.arc((TOWER.x + OX) * SX, (TOWER.z + OY) * SY, 4, 0, 7);
    MX.fillStyle = state.tower.owner ? nationCss(state.tower.owner) : '#666';
    MX.fill();
    for (const e of state.entities) {
      if (!e.alive) continue;
      if (e !== p && !visibleTo(state, e, p)) continue;
      MX.beginPath();
      MX.arc((e.x + OX) * SX, (e.z + OY) * SY, 3, 0, 7);
      MX.fillStyle = nationCss(effNation(state, e, p.nation));
      MX.fill();
    }
  }
}
