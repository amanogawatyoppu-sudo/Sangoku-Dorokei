import { NATION_IDS, NATIONS, nationCss } from '../config/nations';
import type { BoxPrim } from '../config/map';
import { BLOCKS, BOUNDS, KANDA, LOOP, PARKS, RIVER_WIDTH, STATIONS, STREET_SEGS, TOWER, WORLD, insideLoop } from '../config/map';
import type { GameState } from '../sim/state';
import type { NationId } from '../config/nations';
import { SECTORS, sectorAt, sectorOf, sectorPoint } from '../sim/war';
import { effNation, visibleTo } from '../sim/systems/vision';
import { kingLit } from '../sim/systems/tower';
import { PING_ICON } from '../sim/ping';
import { PING_COLOR } from '../render/pingView';
import { $ } from './dom';

/** Canvas pixels (2x the CSS size). The Yamanote loop is tall, so the map is portrait. */
const PAD = 60;
const W = 352;
const SX = W / (BOUNDS.maxX - BOUNDS.minX + 2 * PAD);
const SZ = SX;
const H = Math.round((BOUNDS.maxZ - BOUNDS.minZ + 2 * PAD) * SZ);
const mx = (x: number) => (x - BOUNDS.minX + PAD) * SX;
const my = (z: number) => (z - BOUNDS.minZ + PAD) * SZ;
export const MINIMAP_SIZE = { w: W, h: H };
/** Above this height a character counts as "up high" (floors, hills, platforms). */
const HIGH = 30;

export function levelLabel(y: number): string {
  if (y < 6) return '地上';
  if (y < HIGH) return '段上';
  return y >= 80 ? '高所（2階・歩道橋・高架）' : '高台';
}

export class Minimap {
  private ctx: CanvasRenderingContext2D;

  constructor() {
    const c = $('mini') as HTMLCanvasElement;
    c.width = W;
    c.height = H;
    this.ctx = c.getContext('2d')!;
  }
  private base: HTMLCanvasElement | null = null;

  /** Static layer. Height reads as brightness; stairs and slopes are amber, water blue. */
  private staticLayer(): HTMLCanvasElement {
    if (this.base) return this.base;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0b0d14';
    g.fillRect(0, 0, W, H);
    // Inside the loop.
    g.fillStyle = '#1b1f2a';
    g.beginPath();
    LOOP.forEach((p, i) => (i ? g.lineTo(mx(p.x), my(p.z)) : g.moveTo(mx(p.x), my(p.z))));
    g.closePath();
    g.fill();
    for (const pk of PARKS) {
      g.fillStyle = pk.kind === 'park' ? '#2e4a2f' : '#3a3a3a';
      g.fillRect(mx(pk.x - pk.w / 2), my(pk.z - pk.d / 2), pk.w * SX, pk.d * SZ);
    }
    // Streets (avenues darkest) and sidewalk blocks.
    for (const st of STREET_SEGS) {
      if (!insideLoop(st.x, st.z, 0)) continue;
      g.fillStyle = st.kind === 'avenue' ? '#5a4a36' : st.kind === 'street' ? '#2e323c' : '#272a33';
      g.fillRect(mx(st.x - st.w / 2), my(st.z - st.d / 2), Math.max(1, st.w * SX), Math.max(1, st.d * SZ));
    }
    g.fillStyle = '#343844';
    for (const b of BLOCKS) g.fillRect(mx(b.x0), my(b.z0), (b.x1 - b.x0) * SX, (b.z1 - b.z0) * SZ);
    g.strokeStyle = '#3f8fd0';
    g.lineWidth = Math.max(2, RIVER_WIDTH * SX);
    g.beginPath();
    KANDA.forEach((p, i) => (i ? g.lineTo(mx(p.x), my(p.z)) : g.moveTo(mx(p.x), my(p.z))));
    g.stroke();
    const rect = (p: { x: number; z: number; w: number; d: number }) => g.fillRect(mx(p.x - p.w / 2), my(p.z - p.d / 2), Math.max(1, p.w * SX), Math.max(1, p.d * SZ));
    // Draw low things first so floors and platforms sit on top.
    const sorted = [...WORLD].sort((a, b) => (a.kind === 'box' ? a.y1 : a.hHigh) - (b.kind === 'box' ? b.y1 : b.hHigh));
    for (const p of sorted) {
      if (p.mat === 'water') { if (p.group === 'river') continue; g.fillStyle = '#3f8fd0'; }
      else if (p.mat === 'tree' || p.mat === 'sidewalk' || p.mat === 'car' || p.mat === 'vending' || p.mat === 'pole') continue;
      else if (p.mat === 'bldg') g.fillStyle = (p as BoxPrim).y1 > 700 ? '#6c7284' : '#4c5160';
      else if (p.kind === 'ramp') g.fillStyle = '#d6a64e';
      else if (p.mat === 'earth') g.fillStyle = '#3f5a33';
      else if ((p as BoxPrim).y0 > 20) g.fillStyle = '#9a8f72'; // upper floors, footbridges, decks
      else if (p.mat === 'hedge') g.fillStyle = '#2f4a2c';
      else if (p.kind === 'box' && p.y1 > 700) g.fillStyle = '#7a8094'; // towers
      else g.fillStyle = '#454a58';
      rect(p);
    }
    // The Yamanote line and its stations.
    g.strokeStyle = '#9acd32';
    g.lineWidth = 3;
    g.beginPath();
    LOOP.forEach((p, i) => (i ? g.lineTo(mx(p.x), my(p.z)) : g.moveTo(mx(p.x), my(p.z))));
    g.closePath();
    g.stroke();
    g.font = '600 11px sans-serif';
    g.textBaseline = 'middle';
    for (const st of STATIONS) {
      g.fillStyle = '#f4f1e8';
      g.beginPath();
      g.arc(mx(st.x), my(st.z), 2.5, 0, Math.PI * 2);
      g.fill();
      if (['東京', '品川', '渋谷', '新宿', '池袋', '上野', '秋葉原'].includes(st.name)) {
        const left = st.x < (BOUNDS.minX + BOUNDS.maxX) / 2;
        g.textAlign = left ? 'right' : 'left';
        g.fillStyle = 'rgba(244,241,232,.85)';
        g.fillText(st.name, mx(st.x) + (left ? -5 : 5), my(st.z));
      }
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

  /** `ghost`: spectating after elimination: everyone is shown, and where the ghost is. */
  private warLayer: HTMLCanvasElement | null = null;
  private warKey = '';
  private sectorIds: Int8Array | null = null;

  /** Territory: each sector faintly tinted in its holder's colour; fronts drawn as bright borders. */
  private territory(state: GameState): HTMLCanvasElement {
    const key = state.war.sectors.map((s) => s.owner ?? '-').join();
    if (this.warLayer && key === this.warKey) return this.warLayer;
    this.warKey = key;
    if (!this.sectorIds) {
      this.sectorIds = new Int8Array(W * H).fill(-1);
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const x = px / SX + BOUNDS.minX - PAD, z = py / SZ + BOUNDS.minZ - PAD;
          if (insideLoop(x, z, 0)) this.sectorIds[py * W + px] = sectorAt(x, z);
        }
      }
    }
    const c = this.warLayer ?? document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const img = g.createImageData(W, H);
    const ids = this.sectorIds;
    const rgb = (n: NationId | null): [number, number, number] => {
      const v = n ? NATIONS[n].color : 0x9a9488;
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    };
    for (let i = 0; i < W * H; i++) {
      const id = ids[i];
      if (id < 0) continue;
      const owner = state.war.sectors[id].owner;
      const right = i % W < W - 1 ? ids[i + 1] : id, down = i + W < W * H ? ids[i + W] : id;
      const other = right !== id && right >= 0 ? right : down !== id && down >= 0 ? down : -1;
      const o = i * 4;
      if (other >= 0) {
        const ob = state.war.sectors[other].owner;
        const front = owner && ob && owner !== ob;
        // Fronts: bright; other borders: a faint line.
        img.data[o] = 255; img.data[o + 1] = front ? 90 : 240; img.data[o + 2] = front ? 70 : 220; img.data[o + 3] = front ? 230 : 70;
        continue;
      }
      const [r, gg, b] = rgb(owner);
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = owner ? 62 : 16;
    }
    g.putImageData(img, 0, 0);
    // Fronts burn: blur a copy of the border pixels into a glow underneath.
    const glow = document.createElement('canvas');
    glow.width = W; glow.height = H;
    const gg2 = glow.getContext('2d')!;
    gg2.filter = 'blur(3px)';
    gg2.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.7;
    g.drawImage(glow, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.warLayer = c;
    return c;
  }

  /** Strategic points: holder's colour and emblem; the gauge of whoever is taking it; a pulse when contested. */
  private drawPoints(state: GameState): void {
    const g = this.ctx, me = state.player.nation;
    const intel = state.tower.owner === me && state.entities.some((e) => e.nation === me && e.role === 'communicator' && e.alive && !e.jailed);
    SECTORS.forEach((def, i) => {
      const s = state.war.sectors[i], p = sectorPoint(i), x = mx(p.x), y = my(p.z);
      g.fillStyle = s.owner ? nationCss(s.owner) : '#9a9488';
      g.strokeStyle = '#111';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (s.capturer && s.progress > 0) {
        g.strokeStyle = nationCss(s.capturer);
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, 10, -Math.PI / 2, -Math.PI / 2 + s.progress * Math.PI * 2);
        g.stroke();
      }
      if (s.contested) {
        g.strokeStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(state.time / 140)})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 13, 0, Math.PI * 2);
        g.stroke();
      }
      g.font = '700 11px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#111';
      g.fillText(s.owner ? NATIONS[s.owner].emblem : '・', x, y + 1);
      g.font = '600 11px sans-serif';
      g.textBaseline = 'top';
      g.fillStyle = 'rgba(12,12,16,.6)';
      const label = def.name + (s.contested ? ' 交戦' : '');
      const tw = g.measureText(label).width;
      g.fillRect(x - tw / 2 - 3, y + 11, tw + 6, 14);
      g.fillStyle = s.contested ? '#ffd9a0' : '#f2ead8';
      g.fillText(label, x, y + 12);
      // Tower + communicator: headcounts at contested points.
      if (intel && s.contested) {
        const txt = NATION_IDS.filter((n) => n !== me && s.count[n] > 0).map((n) => NATIONS[n].name + s.count[n]).join(' ');
        g.fillStyle = '#9fe0ff';
        g.fillText(txt, x, y + 26);
      }
    });
  }

  draw(state: GameState, ghost: { x: number; z: number; yaw: number } | null = null): void {
    const g = this.ctx, p = state.player;
    g.drawImage(this.staticLayer(), 0, 0);
    g.drawImage(this.territory(state), 0, 0);
    this.drawPoints(state);
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
      if (!e.alive || e === p || (!ghost && !visibleTo(state, e, p))) continue;
      g.fillStyle = nationCss(effNation(state, e, p.nation));
      g.strokeStyle = '#111';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(mx(e.x), my(e.z), 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (e.ai.leaderId === p.id) {
        // Your squad: green ring.
        g.strokeStyle = '#7dcf9a';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(mx(e.x), my(e.z), 7, 0, Math.PI * 2);
        g.stroke();
      }
      if (kingLit(state, e, p.nation)) {
        // Lit from the tower: a pulsing gold crown ring.
        g.strokeStyle = '#ffd24a';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(mx(e.x), my(e.z), 9 + 2 * Math.sin(state.time / 120), 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#ffd24a';
        g.font = '700 11px sans-serif';
        g.textAlign = 'center';
        g.fillText('◆', mx(e.x), my(e.z) - 11);
      }
      if (e.y > HIGH) {
        // Up high: white ring, so stacked floors don't read as the same spot.
        g.strokeStyle = '#fff4d6';
        g.beginPath();
        g.arc(mx(e.x), my(e.z), 7.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // Your nation's pings: a pulsing ring and the icon.
    for (const q of state.pings) {
      if (q.nation !== p.nation) continue;
      const col = '#' + PING_COLOR[q.kind].toString(16).padStart(6, '0');
      const r = 8 + 4 * (((state.time - q.t) / 700) % 1);
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(mx(q.x), my(q.z), r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = col;
      g.font = '700 11px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(PING_ICON[q.kind], mx(q.x), my(q.z));
      g.textBaseline = 'alphabetic';
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
      const here = sectorOf(state, p);
      const label = `${SECTORS[here.id].name}戦区 ${here.owner ? NATIONS[here.owner].emblem : '中立'} · ${levelLabel(p.y)}`;
      g.fillRect(4, 4, g.measureText(label).width + 10, 19);
      g.fillStyle = '#fff4d6';
      g.fillText(label, 9, 7);
    } else if (ghost) {
      // The ghost: a pale arrow where the view is.
      g.save();
      g.translate(mx(ghost.x), my(ghost.z));
      g.rotate(Math.atan2(Math.cos(ghost.yaw) * SZ, Math.sin(ghost.yaw) * SX));
      g.beginPath();
      g.moveTo(9, 0);
      g.lineTo(-5.5, 6);
      g.lineTo(-2.5, 0);
      g.lineTo(-5.5, -6);
      g.closePath();
      g.fillStyle = 'rgba(220,235,255,.8)';
      g.fill();
      g.restore();
    }
  }
}
