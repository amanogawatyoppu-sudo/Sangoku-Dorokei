import { NATION_IDS, NATIONS, nationCss } from '../config/nations';
import { BOUNDS, OBST, ROADS, SNIPE, TOWER } from '../config/map';
import type { GameState } from '../sim/state';
import { effNation, visibleTo } from '../sim/systems/vision';
import { $ } from './dom';

/** Canvas is 2x its CSS size for sharp lines on high-DPI screens. */
const SIZE = 352;
const SX = SIZE / 2200, SY = SIZE / 1400, OX = 1100, OY = 700;
const mx = (x: number) => (x + OX) * SX;
const my = (z: number) => (z + OY) * SY;

export class Minimap {
  private ctx = ($('mini') as HTMLCanvasElement).getContext('2d')!;
  private base: HTMLCanvasElement | null = null;

  /** Static layer: ground, roads, hills, walls, jails and bases. */
  private staticLayer(): HTMLCanvasElement {
    if (this.base) return this.base;
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1c2417';
    g.fillRect(0, 0, SIZE, SIZE);
    g.fillStyle = '#2d3a22';
    g.fillRect(mx(BOUNDS.minX), my(BOUNDS.minZ), (BOUNDS.maxX - BOUNDS.minX) * SX, (BOUNDS.maxZ - BOUNDS.minZ) * SY);
    g.strokeStyle = '#6e5b3e';
    g.lineWidth = 3;
    g.lineCap = g.lineJoin = 'round';
    for (const r of ROADS) {
      g.beginPath();
      r.forEach(([x, z], i) => (i ? g.lineTo(mx(x), my(z)) : g.moveTo(mx(x), my(z))));
      g.stroke();
    }
    for (const h of SNIPE) {
      g.fillStyle = '#4b5f33';
      g.beginPath();
      g.ellipse(mx(h.x), my(h.z), h.r * SX, h.r * SY, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#a79d88';
    for (const o of OBST) g.fillRect(mx(o.x - o.w / 2), my(o.z - o.d / 2), o.w * SX, o.d * SY);
    for (const n of NATION_IDS) {
      const { jail: j, base: b } = NATIONS[n];
      g.strokeStyle = nationCss(n);
      g.lineWidth = 2;
      g.setLineDash([4, 3]);
      g.strokeRect(mx(j.x - j.w / 2), my(j.z - j.d / 2), j.w * SX, j.d * SY);
      g.setLineDash([]);
      g.fillStyle = nationCss(n);
      g.globalAlpha = 0.3;
      g.beginPath();
      g.arc(mx(b.x), my(b.z), 12, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.font = 'bold 15px serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(NATIONS[n].emblem, mx(b.x), my(b.z) + 1);
    }
    this.base = c;
    return c;
  }

  draw(state: GameState): void {
    const g = this.ctx, p = state.player;
    g.drawImage(this.staticLayer(), 0, 0);
    // Tower, coloured by owner.
    g.fillStyle = state.tower.owner ? nationCss(state.tower.owner) : '#8a8274';
    g.strokeStyle = '#111';
    g.lineWidth = 2;
    g.beginPath();
    g.rect(mx(TOWER.x) - 6, my(TOWER.z) - 6, 12, 12);
    g.fill();
    g.stroke();
    for (const e of state.entities) {
      if (!e.alive || e === p) continue;
      if (!visibleTo(state, e, p)) continue;
      g.fillStyle = nationCss(effNation(state, e, p.nation));
      g.beginPath();
      g.arc(mx(e.x), my(e.z), 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (p.alive) {
      // Player: arrow pointing where they face.
      const a = Math.atan2(p.dirZ * SY, p.dirX * SX);
      g.save();
      g.translate(mx(p.x), my(p.z));
      g.rotate(a);
      g.beginPath();
      g.moveTo(10, 0);
      g.lineTo(-6, 6.5);
      g.lineTo(-3, 0);
      g.lineTo(-6, -6.5);
      g.closePath();
      g.fillStyle = '#fff4d6';
      g.fill();
      g.strokeStyle = nationCss(p.nation);
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
  }
}
