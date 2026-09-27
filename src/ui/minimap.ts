import { NATION_IDS, NATIONS, nationCss } from '../config/nations';
import type { BoxPrim } from '../config/map';
import { BOUNDS, ROADS, TOWER, WORLD } from '../config/map';
import type { GameState } from '../sim/state';
import { effNation, visibleTo } from '../sim/systems/vision';
import { $ } from './dom';

/** Canvas pixels (2x the CSS size for sharp lines). Keeps the map's 8:5 aspect. */
const W = 352, H = 220;
const SX = W / (BOUNDS.maxX - BOUNDS.minX), SZ = H / (BOUNDS.maxZ - BOUNDS.minZ);
const mx = (x: number) => (x - BOUNDS.minX) * SX;
const my = (z: number) => (z - BOUNDS.minZ) * SZ;
/** Above this height a character counts as "up high" (floors, hills, platforms). */
const HIGH = 30;

export function levelLabel(y: number): string {
  if (y < 6) return '地上';
  if (y < HIGH) return '段上';
  return y >= 60 ? '高所（2階・見張り台）' : '高台';
}

export class Minimap {
  private ctx = ($('mini') as HTMLCanvasElement).getContext('2d')!;
  private base: HTMLCanvasElement | null = null;

  /** Static layer. Height reads as brightness; stairs and slopes are amber, water blue. */
  private staticLayer(): HTMLCanvasElement {
    if (this.base) return this.base;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2d3a22';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#6e5b3e';
    g.lineWidth = 2.5;
    g.lineCap = g.lineJoin = 'round';
    for (const r of ROADS) {
      g.beginPath();
      r.forEach(([x, z], i) => (i ? g.lineTo(mx(x), my(z)) : g.moveTo(mx(x), my(z))));
      g.stroke();
    }
    const rect = (p: { x: number; z: number; w: number; d: number }) => g.fillRect(mx(p.x - p.w / 2), my(p.z - p.d / 2), Math.max(1, p.w * SX), Math.max(1, p.d * SZ));
    // Draw low things first so floors and platforms sit on top.
    const sorted = [...WORLD].sort((a, b) => (a.kind === 'box' ? a.y1 : a.hHigh) - (b.kind === 'box' ? b.y1 : b.hHigh));
    for (const p of sorted) {
      if (p.mat === 'water') g.fillStyle = '#3f7590';
      else if (p.kind === 'ramp') g.fillStyle = '#d6a64e';
      else if (p.mat === 'earth') g.fillStyle = '#6f8a45';
      else if ((p as BoxPrim).y0 > 20) g.fillStyle = '#d8cda8'; // upper floors, skyways, platforms
      else if (p.mat === 'hedge') g.fillStyle = '#48633a';
      else g.fillStyle = '#9a917e';
      rect(p);
    }
    for (const n of NATION_IDS) {
      const { jail: j, base: b } = NATIONS[n];
      g.strokeStyle = nationCss(n);
      g.lineWidth = 2;
      g.setLineDash([4, 3]);
      g.strokeRect(mx(j.x - j.w / 2), my(j.z - j.d / 2), j.w * SX, j.d * SZ);
      g.setLineDash([]);
      g.fillStyle = nationCss(n);
      g.globalAlpha = 0.3;
      g.beginPath();
      g.arc(mx(b.x), my(b.z), 10, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.font = 'bold 13px serif';
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
    for (const n of NATION_IDS) {
      if (state.jailReveal[n] > state.time) {
        const j = NATIONS[n].jail;
        g.strokeStyle = '#ff6a5a';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(mx(j.x), my(j.z), 14 + 3 * Math.sin(state.time / 150), 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.fillStyle = state.tower.owner ? nationCss(state.tower.owner) : '#8a8274';
    g.strokeStyle = '#111';
    g.lineWidth = 2;
    g.fillRect(mx(TOWER.x) - 5, my(TOWER.z) - 5, 10, 10);
    g.strokeRect(mx(TOWER.x) - 5, my(TOWER.z) - 5, 10, 10);
    for (const e of state.entities) {
      if (!e.alive || e === p || !visibleTo(state, e, p)) continue;
      g.fillStyle = nationCss(effNation(state, e, p.nation));
      g.strokeStyle = '#111';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(mx(e.x), my(e.z), 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (e.y > HIGH) {
        // Up high: white ring, so stacked floors don't read as the same spot.
        g.strokeStyle = '#fff4d6';
        g.beginPath();
        g.arc(mx(e.x), my(e.z), 7.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (p.alive) {
      const a = Math.atan2(p.dirZ * SZ, p.dirX * SX);
      g.save();
      g.translate(mx(p.x), my(p.z));
      g.rotate(a);
      g.beginPath();
      g.moveTo(9, 0);
      g.lineTo(-5.5, 6);
      g.lineTo(-2.5, 0);
      g.lineTo(-5.5, -6);
      g.closePath();
      g.fillStyle = '#fff4d6';
      g.fill();
      g.strokeStyle = nationCss(p.nation);
      g.lineWidth = 2;
      g.stroke();
      g.restore();
      g.font = '600 13px sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillStyle = 'rgba(12,12,16,.75)';
      const label = '現在: ' + levelLabel(p.y);
      g.fillRect(4, 4, g.measureText(label).width + 10, 19);
      g.fillStyle = '#fff4d6';
      g.fillText(label, 9, 7);
    }
  }
}
