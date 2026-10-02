import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDINGS, CURB, insideLoop, GROUND_FLOOR, INTERSECTIONS, LOOP, STATIONS, STOREY, VIADUCT, prng } from '../config/map';
import type { Building } from '../config/map';
import { NIGHT_GLOW } from './nightGlow';
import { nearFade } from './city';

/**
 * v9.2 art prototype — NEON MAZE, the Shibuya showcase block (only with `?art=v2`).
 *
 * One block round the scramble crossing, dressed at player eye level: show windows and
 * shop name bands, awnings, projecting blade signs, big screens, a scramble crosswalk,
 * granite paving, street trees, planters and guard rails, signs to the footbridge
 * stairs and the back alley, and lit shops in the railway arches (the "dark wall").
 *
 * Scenery only: nothing is added to the world, so collision, navigation, stairs, sight
 * lines for the AI and objectives are untouched. Five draw calls in all (merged per
 * material, one texture atlas). Light colours avoid the faction colours (SOL orange,
 * LUNA blue, STAR yellow): magenta, violet, mint, red and white only.
 */

/** Centre of the showcase (the scramble crossing). */
export const SHOWCASE = { x: -2700, z: 1899, r: 760 };

/** Sign and screen light colours (never a faction hue; see tests/artPrototype.test.ts). */
export const SHOWCASE_LIGHTS = [0xff3fa4, 0xb46bff, 0x5dffc8, 0xff4a7a, 0xf4f0ff] as const;

const ATLAS_W = 1024, ATLAS_H = 1280;
type Cell = [number, number, number, number];
const CELLS = {
  window: (i: number): Cell => [(i % 4) * 256, Math.floor(i / 4) * 192, 256, 192],
  name: (i: number): Cell => [(i % 4) * 256, 384 + Math.floor(i / 4) * 48, 256, 48],
  blade: (i: number): Cell => [i * 64, 480, 64, 256],
  way: (i: number): Cell => [512 + (i % 2) * 256, 480 + Math.floor(i / 2) * 80, 256, 80],
  swatch: (i: number): Cell => [512 + i * 64 + 8, 648, 48, 16],
  ticker: [512, 672, 512, 64] as Cell,
  screen: (i: number): Cell => [i * 512, 736, 512, 288],
  garage: (i: number): Cell => [i * 256, 1024, 256, 256],
};
const NAMES = ['KAIRO DELI', 'NEON//MART', 'TOKI COFFEE', 'PIXEL ARCADE', 'HAZE SHOES', 'ORBIT VINYL', 'MOSS BOOKS', 'YUZU NOODLE'];
const BLADES = ['古着', '珈琲', 'ゲーム', 'らーめん', '書店', '靴', 'カラオケ', '薬局'];
const css = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

/** The showcase atlas: show windows, name bands, blade signs, wayfinding, screens, arch shops. */
function atlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const g = c.getContext('2d')!;
  const rnd = prng(9201);
  const L = SHOWCASE_LIGHTS;
  const text = (s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = '800') => {
    g.fillStyle = color;
    g.font = `${weight} ${size}px sans-serif`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  };
  // Show windows: a lit interior behind glass, a mullion frame and a door on one side.
  const interiors: ((x: number, y: number) => void)[] = [
    (x, y) => { // deli counter
      for (let k = 0; k < 5; k++) { g.fillStyle = `hsl(${20 + rnd() * 30},45%,${55 + rnd() * 15}%)`; g.fillRect(x + 20 + k * 44, y + 120, 36, 22); }
      g.fillStyle = '#e9e4da'; g.fillRect(x + 12, y + 142, 232, 40);
    },
    (x, y) => { // general store shelves
      for (let r = 0; r < 4; r++) for (let k = 0; k < 22; k++) { g.fillStyle = `hsl(${rnd() * 360},${40 + rnd() * 40}%,${50 + rnd() * 25}%)`; g.fillRect(x + 14 + k * 10.4, y + 50 + r * 30, 8, 22); }
    },
    (x, y) => { // café: hanging lamps, counter, cups
      for (let k = 0; k < 4; k++) { g.fillStyle = '#3a2c22'; g.fillRect(x + 40 + k * 56, y + 30, 2, 30); g.fillStyle = '#fff2c8'; g.beginPath(); g.arc(x + 41 + k * 56, y + 66, 9, Math.PI, 0); g.fill(); }
      g.fillStyle = '#5a3d2a'; g.fillRect(x + 12, y + 130, 232, 52);
      for (let k = 0; k < 9; k++) { g.fillStyle = '#f4efe6'; g.fillRect(x + 22 + k * 24, y + 118, 10, 12); }
    },
    (x, y) => { // arcade: dark room, glowing cabinets
      g.fillStyle = '#1c1530'; g.fillRect(x + 6, y + 6, 244, 180);
      for (let k = 0; k < 5; k++) {
        const col = L[k % 4];
        g.fillStyle = '#0d0b14'; g.fillRect(x + 16 + k * 47, y + 60, 38, 120);
        g.fillStyle = css(col); g.fillRect(x + 20 + k * 47, y + 70, 30, 34);
        g.fillStyle = css(col, 0.5); g.fillRect(x + 16 + k * 47, y + 56, 38, 6);
      }
    },
    (x, y) => { // sneakers on wall shelves
      for (let r = 0; r < 4; r++) {
        g.fillStyle = '#d9d4ca'; g.fillRect(x + 14, y + 72 + r * 30, 228, 3);
        for (let k = 0; k < 7; k++) { g.fillStyle = `hsl(${rnd() * 360},${30 + rnd() * 50}%,${35 + rnd() * 45}%)`; g.beginPath(); g.ellipse(x + 34 + k * 31, y + 64 + r * 30, 12, 6, 0, 0, Math.PI * 2); g.fill(); }
      }
    },
    (x, y) => { // records in bins, posters
      for (let k = 0; k < 4; k++) { g.fillStyle = css(L[(k + 1) % 5], 0.8); g.fillRect(x + 20 + k * 58, y + 30, 40, 52); }
      g.fillStyle = '#4a3f38'; g.fillRect(x + 12, y + 130, 232, 52);
      for (let k = 0; k < 28; k++) { g.fillStyle = `hsl(${rnd() * 360},30%,${30 + rnd() * 40}%)`; g.fillRect(x + 16 + k * 8, y + 112, 6, 22); }
    },
    (x, y) => { // book shelves
      for (let r = 0; r < 5; r++) for (let k = 0; k < 40; k++) { g.fillStyle = `hsl(${20 + rnd() * 200},${20 + rnd() * 30}%,${30 + rnd() * 45}%)`; g.fillRect(x + 12 + k * 5.8, y + 40 + r * 28, 5, 20 + rnd() * 4); }
    },
    (x, y) => { // apparel: mannequins
      for (let k = 0; k < 3; k++) {
        const mx = x + 54 + k * 74;
        g.fillStyle = '#d8d2c8'; g.beginPath(); g.arc(mx, y + 52, 11, 0, Math.PI * 2); g.fill();
        g.fillStyle = ['#2b2d33', '#7a2335', '#e8e0cc'][k]; g.fillRect(mx - 20, y + 64, 40, 64);
        g.fillStyle = '#3a3d44'; g.fillRect(mx - 14, y + 128, 11, 50); g.fillRect(mx + 3, y + 128, 11, 50);
      }
    },
  ];
  for (let i = 0; i < 8; i++) {
    const [x, y, w, h] = CELLS.window(i);
    const grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, '#fff7ea');
    grd.addColorStop(1, '#cbbfae');
    g.fillStyle = grd;
    g.fillRect(x, y, w, h);
    interiors[i](x, y);
    // Glass: a soft reflection band, then the frame and the door.
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.beginPath(); g.moveTo(x + 30, y + h); g.lineTo(x + 110, y); g.lineTo(x + 150, y); g.lineTo(x + 70, y + h); g.fill();
    g.fillStyle = '#25272c';
    g.fillRect(x, y, w, 7); g.fillRect(x, y + h - 9, w, 9); g.fillRect(x, y, 6, h); g.fillRect(x + w - 6, y, 6, h);
    const door = i % 2 ? x + w - 70 : x + 6;
    g.fillRect(door + (i % 2 ? 0 : 58), y, 6, h);
    g.fillRect(x + w / 2 - 2, y, 4, h);
  }
  // Shop name bands: invented names, light letters on a dark band with a colour edge.
  NAMES.forEach((n, i) => {
    const [x, y, w, h] = CELLS.name(i);
    const col = L[i % L.length];
    g.fillStyle = i % 3 === 2 ? '#efe9dd' : '#17181c';
    g.fillRect(x, y, w, h);
    g.fillStyle = css(col);
    g.fillRect(x, y + h - 5, w, 5);
    text(n, x + w / 2, y + h / 2 - 2, 26, i % 3 === 2 ? '#1a1b20' : css(col === 0xf4f0ff ? 0xffffff : col));
  });
  // Blade signs: vertical writing, a coloured field with a light border.
  BLADES.forEach((wd, i) => {
    const [x, y, w, h] = CELLS.blade(i);
    const col = L[i % L.length];
    g.fillStyle = i % 2 ? css(col) : '#15161a';
    g.fillRect(x, y, w, h);
    g.strokeStyle = i % 2 ? 'rgba(255,255,255,.85)' : css(col);
    g.lineWidth = 4;
    g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    const n = [...wd].length, step = Math.min(52, 220 / n);
    [...wd].forEach((ch, k) => text(ch, x + w / 2, y + h / 2 + (k - (n - 1) / 2) * step, 40, i % 2 ? '#14151a' : '#ffffff', 'center', '900'));
  });
  // Wayfinding: footbridge, back alley, crossing (white panels, dark text, a mint arrow).
  const way = [['歩道橋', 'FOOTBRIDGE', '↑'], ['路地', 'BACK ALLEY', '↓'], ['スクランブル', 'SCRAMBLE', '↔'], ['階段', 'STAIRS', '↑']];
  way.forEach(([jp, en, arrow], i) => {
    const [x, y, w, h] = CELLS.way(i);
    g.fillStyle = '#f4f2ec'; g.fillRect(x, y, w, h);
    g.fillStyle = '#1b1c21'; g.fillRect(x, y, 66, h);
    text(arrow, x + 33, y + h / 2 + 2, 52, css(0x5dffc8), 'center', '900');
    text(jp, x + 80, y + 28, 30, '#16171b', 'left', '900');
    text(en, x + 80, y + 60, 20, '#3a3c44', 'left', '700');
  });
  // Plain light swatches (strips, lanterns).
  L.forEach((col, i) => { const [x, y, w, h] = CELLS.swatch(i); g.fillStyle = css(col); g.fillRect(x - 8, y - 8, w + 16, h + 16); });
  // Ticker band.
  {
    const [x, y, w, h] = CELLS.ticker;
    g.fillStyle = '#0c0b12'; g.fillRect(x, y, w, h);
    text('NEON MAZE ・ 渋谷 ・ NIGHT RUN ・ 22:00 ・ 渋谷 ・', x + w / 2, y + h / 2, 30, css(0x5dffc8), 'center', '800');
  }
  // Big screens: abstract motion graphics (no real ads).
  for (let i = 0; i < 2; i++) {
    const [x, y, w, h] = CELLS.screen(i);
    const grd = g.createLinearGradient(x, y, x + w, y + h);
    grd.addColorStop(0, i ? '#2a0f3d' : '#160c2a');
    grd.addColorStop(1, i ? '#0d3b3a' : '#4a0f33');
    g.fillStyle = grd;
    g.fillRect(x, y, w, h);
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = css(L[(k + i) % 3], 0.35 + rnd() * 0.4);
      g.lineWidth = 3 + rnd() * 10;
      g.beginPath();
      const yy = y + 20 + rnd() * (h - 40);
      g.moveTo(x, yy);
      g.bezierCurveTo(x + w * 0.3, yy - 80 + rnd() * 160, x + w * 0.7, yy - 80 + rnd() * 160, x + w, yy + rnd() * 40 - 20);
      g.stroke();
    }
    if (i === 0) {
      text('NEON', x + 40, y + 110, 96, '#ffffff', 'left', '900');
      text('MAZE', x + 40, y + 200, 96, css(0x5dffc8), 'left', '900');
      text('渋谷 / SHIBUYA SCRAMBLE', x + 44, y + 258, 22, 'rgba(255,255,255,.8)', 'left', '700');
    } else {
      g.fillStyle = css(0xff3fa4); g.beginPath(); g.arc(x + 380, y + 144, 90, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + 380, y + 144, 56, 0, Math.PI * 2); g.fill();
      text('RUN', x + 50, y + 120, 84, '#ffffff', 'left', '900');
      text('THE CITY', x + 50, y + 196, 56, css(0xb46bff), 'left', '900');
    }
    g.fillStyle = 'rgba(0,0,0,.18)';
    for (let r = 0; r < h; r += 4) g.fillRect(x, y + r, w, 1);
  }
  // Shops in the railway arches (ガード下): bar, bicycle parking, a closed shutter, a stand.
  for (let i = 0; i < 4; i++) {
    const [x, y, w, h] = CELLS.garage(i);
    g.fillStyle = '#2b2925'; g.fillRect(x, y, w, h);
    if (i === 2) {
      g.fillStyle = '#8d8f92'; g.fillRect(x + 16, y + 70, w - 32, h - 70);
      g.fillStyle = 'rgba(0,0,0,.25)';
      for (let r = y + 74; r < y + h; r += 8) g.fillRect(x + 16, r, w - 32, 2);
      g.fillStyle = css(0xf4f0ff); g.fillRect(x + w / 2 - 20, y + 48, 40, 10);
      continue;
    }
    const grd = g.createLinearGradient(x, y + 60, x, y + h);
    grd.addColorStop(0, i === 1 ? '#d9e6e2' : '#ffe9c8');
    grd.addColorStop(1, i === 1 ? '#7d8a88' : '#8a6a4c');
    g.fillStyle = grd;
    g.fillRect(x + 16, y + 70, w - 32, h - 70);
    if (i === 0) {
      for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#1b1c22' : '#7a2335'; g.fillRect(x + 16 + k * 45, y + 70, 45, 44); }
      for (let k = 0; k < 4; k++) { g.fillStyle = css(0xff4a7a); g.beginPath(); g.ellipse(x + 50 + k * 52, y + 58, 11, 15, 0, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#4a3527'; g.fillRect(x + 24, y + 196, w - 48, 40);
    } else if (i === 1) {
      for (let k = 0; k < 7; k++) { g.strokeStyle = '#2a2d33'; g.lineWidth = 4; g.beginPath(); g.arc(x + 40 + k * 30, y + 216, 16, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = css(0x5dffc8); g.fillRect(x + 40, y + 36, w - 80, 26);
      text('BIKE', x + w / 2, y + 50, 20, '#0d1a17', 'center', '900');
    } else {
      g.fillStyle = css(0xb46bff); g.fillRect(x + 30, y + 36, w - 60, 26);
      text('STAND', x + w / 2, y + 50, 20, '#ffffff', 'center', '900');
      g.fillStyle = '#3b2c22'; g.fillRect(x + 24, y + 186, w - 48, 50);
      for (let k = 0; k < 6; k++) { g.fillStyle = '#f2ead8'; g.fillRect(x + 40 + k * 30, y + 170, 12, 16); }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

/** A flat textured quad facing (nx, 0, nz) (or up), mapped to an atlas cell. */
function quad(w: number, h: number, cell: Cell, x: number, y: number, z: number, nx: number, nz: number, up = false): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const [cx, cy, cw, ch] = cell;
  const u0 = cx / ATLAS_W, u1 = (cx + cw) / ATLAS_W, v1 = 1 - cy / ATLAS_H, v0 = 1 - (cy + ch) / ATLAS_H;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  if (up) g.rotateX(-Math.PI / 2).rotateY(Math.atan2(nx, nz) + Math.PI);
  else g.rotateY(Math.atan2(nx, nz));
  return g.translate(x, y, z);
}

/** Geometry with a baked vertex colour (for the solid, foliage and ground meshes). */
function tint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color), n = ng.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  ng.deleteAttribute('uv');
  return ng;
}

/** A box rotated to yaw `ang` round its centre. */
const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number, ang = 0) => new THREE.BoxGeometry(w, h, d).rotateY(ang).translate(x, y, z);

/** A building face on a street: its bottom edge from (x0, z0) to (x1, z1) as seen from outside, normal (nx, nz). */
interface Face { x0: number; z0: number; x1: number; z1: number; nx: number; nz: number; len: number; b: Building }

/** Faces of the block's buildings that look onto a street (no other building right in front). */
export function showcaseFaces(): Face[] {
  const out: Face[] = [];
  const near = BUILDINGS.filter((b) => !b.outside && Math.abs(b.x - SHOWCASE.x) < SHOWCASE.r && Math.abs(b.z - SHOWCASE.z) < SHOWCASE.r + 160);
  const blocked = (x: number, z: number) => BUILDINGS.some((o) => Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2);
  for (const b of near) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    const sides: Face[] = [
      { x0: x1, z0, x1: x0, z1: z0, nx: 0, nz: -1, len: b.w, b },
      { x0, z0: z1, x1, z1, nx: 0, nz: 1, len: b.w, b },
      { x0: x1, z0: z1, x1, z1: z0, nx: 1, nz: 0, len: b.d, b },
      { x0, z0, x1: x0, z1, nx: -1, nz: 0, len: b.d, b },
    ];
    for (const f of sides) if (f.len > 110 && !blocked((f.x0 + f.x1) / 2 + f.nx * 40, (f.z0 + f.z1) / 2 + f.nz * 40)) out.push(f);
  }
  return out;
}

export interface ShowcaseStats { faces: number; bays: number; drawCalls: number; triangles: number; arches: number }

/** Builds the showcase block into the scene. */
export function buildShibuyaBlock(scene: THREE.Scene): ShowcaseStats {
  const rnd = prng(92);
  const lit: THREE.BufferGeometry[] = [], screens: THREE.BufferGeometry[] = [], solid: THREE.BufferGeometry[] = [], leaf: THREE.BufferGeometry[] = [], ground: THREE.BufferGeometry[] = [], arches: THREE.BufferGeometry[] = [];
  const AWNING = [0x1f6f6a, 0x7a2335, 0x2a2d33, 0xe8e0cc, 0x5c2a6b, 0x2f4a3a];
  const FRAME = 0x24262b, RAIL = 0xd9dde0, GRANITE = [0x8a8782, 0x9d9993, 0x7b7975];
  const faces = showcaseFaces();
  let bays = 0, wi = 0, ni = 0, bi = 0;
  for (const f of faces) {
    const tx = (f.x1 - f.x0) / f.len, tz = (f.z1 - f.z0) / f.len, ang = Math.atan2(f.nx, f.nz);
    const P = (s: number, out: number): [number, number] => [f.x0 + tx * s + f.nx * out, f.z0 + tz * s + f.nz * out];
    // Ground floor: bays of ≈ 6 m, each a show window, a name band, sometimes an awning.
    const n = Math.max(1, Math.round((f.len - 20) / 150)), bw = (f.len - 20) / n;
    for (let k = 0; k < n; k++) {
      const s = 10 + bw * (k + 0.5);
      const [wx, wz] = P(s, 1.6);
      lit.push(quad(bw - 14, 84, CELLS.window(wi++ % 8), wx, 50, wz, f.nx, f.nz));
      const [bx, bz] = P(s, 1.2);
      solid.push(tint(boxAt(bw - 4, 26, 3, bx, 106, bz, ang), FRAME));
      const [lx, lz] = P(s, 2.9);
      lit.push(quad(bw - 10, 21, CELLS.name(ni++ % 8), lx, 106, lz, f.nx, f.nz));
      if (rnd() < 0.6) {
        // Awning: a thin canted panel over the window.
        const [ax, az] = P(s, 13);
        const aw = new THREE.BoxGeometry(bw - 12, 1.6, 26).rotateX(0.38).rotateY(ang).translate(ax, 92, az);
        solid.push(tint(aw, AWNING[Math.floor(rnd() * AWNING.length)]));
      }
      const [px, pz] = P(10 + bw * k, 2);
      solid.push(tint(boxAt(6, 120, 4, px, 60, pz, ang), FRAME));
      bays++;
    }
    const [ex, ez] = P(f.len - 10, 2);
    solid.push(tint(boxAt(6, 120, 4, ex, 60, ez, ang), FRAME));
    // Granite frontage band on the pavement (two tones in slabs).
    for (let s = 6; s < f.len - 6; s += 52) {
      const len = Math.min(50, f.len - 6 - s);
      const [gx, gz] = P(s + len / 2, 20);
      ground.push(tint(new THREE.PlaneGeometry(len, 36).rotateX(-Math.PI / 2).rotateY(ang).translate(gx, CURB + 0.15, gz), GRANITE[(s / 52) % 2 | 0]));
    }
    // Projecting blade signs on the taller faces, readable from both ways along the street.
    if (f.b.h > GROUND_FLOOR + 2 * STOREY) {
      for (const s of f.len > 180 ? [34, f.len - 34] : [f.len / 2]) {
        const top = Math.min(f.b.h - 30, GROUND_FLOOR + 3 * STOREY), bot = GROUND_FLOOR + 22, h = top - bot;
        const [sx, sz] = P(s, 34);
        const cell = CELLS.blade(bi++ % 8);
        lit.push(quad(42, h, cell, sx + tx * 0.6, bot + h / 2, sz + tz * 0.6, tx, tz));
        lit.push(quad(42, h, cell, sx - tx * 0.6, bot + h / 2, sz - tz * 0.6, -tx, -tz));
        const [mx, mz] = P(s, 7);
        solid.push(tint(boxAt(3, 3, 14, mx, top - 6, mz, ang), FRAME), tint(boxAt(3, 3, 14, mx, bot + 6, mz, ang), FRAME));
      }
    }
    // A light line at each storey on the corner buildings facing the crossing.
    if (Math.hypot((f.x0 + f.x1) / 2 - SHOWCASE.x, (f.z0 + f.z1) / 2 - SHOWCASE.z) < 520) {
      const sw = CELLS.swatch(Math.floor(rnd() * 3));
      for (let y = GROUND_FLOOR + STOREY; y < Math.min(f.b.h - 20, GROUND_FLOOR + 5 * STOREY); y += STOREY) {
        const [cx, cz] = P(f.len / 2, 1.4);
        lit.push(quad(f.len - 8, 2.6, sw, cx, y - 6, cz, f.nx, f.nz));
      }
    }
  }

  // Big screens on the faces toward the crossing.
  const screen = (cell: Cell, w: number, h: number, x: number, y: number, z: number, nx: number, nz: number) => {
    screens.push(quad(w, h, cell, x + nx * 4, y, z + nz * 4, nx, nz));
    solid.push(tint(boxAt(nx ? 6 : w + 10, h + 10, nx ? w + 10 : 6, x, y, z), 0x14151a));
  };
  const glass = { x: -2875, z: 2313, w: 300, d: 300 };
  screen(CELLS.screen(0), 250, 141, glass.x, 232, glass.z - glass.d / 2, 0, -1);
  screen(CELLS.ticker, 250, 31, glass.x, 132, glass.z - glass.d / 2, 0, -1);
  for (const f of faces) {
    const mx = (f.x0 + f.x1) / 2, mz = (f.z0 + f.z1) / 2;
    const d = Math.hypot(mx - SHOWCASE.x, mz - SHOWCASE.z);
    if (d > 520 || f.b.h < GROUND_FLOOR + 3 * STOREY || f.len < 150) continue;
    // Low enough to be seen from the street under the chase camera.
    const w = Math.min(200, f.len - 100), h = w * 0.5625;
    if (w < 90) continue;
    screen(CELLS.screen((Math.round(mx + mz) & 1) as 0 | 1), w, h, mx, GROUND_FLOOR + 34 + h / 2, mz, f.nx, f.nz);
  }

  // Scramble: two diagonal crosswalks over the crossing.
  const ix = INTERSECTIONS.reduce((a, b) => (Math.hypot(b.x - SHOWCASE.x, b.z - SHOWCASE.z) < Math.hypot(a.x - SHOWCASE.x, a.z - SHOWCASE.z) ? b : a));
  for (const sg of [1, -1]) {
    const ax = ix.x - ix.w / 2 + 40, bx = ix.x + ix.w / 2 - 40, az = ix.z - sg * (ix.d / 2 - 36), bz = ix.z + sg * (ix.d / 2 - 36);
    const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len, ang = Math.atan2(dx, dz);
    for (let t = 14; t < len - 10; t += 28) ground.push(tint(new THREE.PlaneGeometry(76, 14).rotateX(-Math.PI / 2).rotateY(ang).translate(ax + dx * t, 0.95, az + dz * t), 0xe9e8e2));
  }
  // Corner plazas: checker of granite slabs where the crowds wait.
  for (const [cx, cz] of [[ix.x + ix.w / 2 + 60, ix.z - ix.d / 2 - 50], [ix.x + ix.w / 2 + 60, ix.z + ix.d / 2 + 50]]) {
    for (let i = -2; i < 2; i++) for (let j = -2; j < 2; j++) {
      ground.push(tint(new THREE.PlaneGeometry(25, 25).rotateX(-Math.PI / 2).translate(cx + i * 26 + 13, CURB + 0.18, cz + j * 26 + 13), GRANITE[(i + j + 4) % 3]));
    }
  }

  // Street trees with grates, planters, guard rails (on the east sidewalks of the crossing).
  const curbX = ix.x + ix.w / 2 + 8;
  const tree = (x: number, z: number) => {
    solid.push(tint(new THREE.CylinderGeometry(2.6, 3.6, 150, 6).translate(x, CURB + 75, z), 0x4b3a2a));
    ground.push(tint(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2).translate(x, CURB + 0.22, z), 0x34363a));
    for (let k = 0; k < 3; k++) {
      const r = 26 + rnd() * 12;
      leaf.push(tint(new THREE.IcosahedronGeometry(r, 0).translate(x + (rnd() - 0.5) * 30, CURB + 150 + rnd() * 30, z + (rnd() - 0.5) * 30), new THREE.Color().setHSL(0.27 + rnd() * 0.06, 0.4, 0.22 + rnd() * 0.08).getHex()));
    }
  };
  for (const z of [2175, 2320, 2465]) tree(curbX + 20, z);
  const planter = (x: number, z: number, alongZ: boolean) => {
    solid.push(tint(boxAt(alongZ ? 22 : 60, 20, alongZ ? 60 : 22, x, CURB + 10, z), 0x9a968f));
    for (let k = -1; k <= 1; k++) leaf.push(tint(new THREE.IcosahedronGeometry(11 + rnd() * 4, 0).translate(x + (alongZ ? 0 : k * 18), CURB + 24, z + (alongZ ? k * 18 : 0)), new THREE.Color().setHSL(0.3 + rnd() * 0.05, 0.45, 0.25).getHex()));
  };
  planter(curbX + 20, 2247, true);
  planter(curbX + 20, 2392, true);
  planter(-2370, ix.z - ix.d / 2 - 24, false);
  planter(-2230, ix.z - ix.d / 2 - 24, false);
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
    for (let t = 0; t <= len + 0.1; t += 30) solid.push(tint(boxAt(2.5, 24, 2.5, x0 + (x1 - x0) * (t / len), CURB + 12, z0 + (z1 - z0) * (t / len)), RAIL));
    for (const y of [CURB + 22, CURB + 12]) solid.push(tint(boxAt(2, 2, len, (x0 + x1) / 2, y, (z0 + z1) / 2, ang), RAIL));
  };
  rail(curbX, 1585, curbX, 1655);
  rail(-2395, ix.z - ix.d / 2 - 5, -2335, ix.z - ix.d / 2 - 5);
  rail(-2395, ix.z + ix.d / 2 + 5, -2335, ix.z + ix.d / 2 + 5);
  rail(curbX, 2200, curbX, 2290);
  rail(curbX, 2345, curbX, 2435);

  // Wayfinding: the footbridge stairs (both feet) and the back alley.
  const signPost = (x: number, z: number, nx: number, nz: number, cell: Cell) => {
    solid.push(tint(boxAt(4, 190, 4, x, 95, z), 0x5a5e66));
    solid.push(tint(boxAt(nx ? 3 : 104, 38, nx ? 104 : 3, x - nx * 3, 172, z - nz * 3), 0x2a2c31));
    lit.push(quad(100, 31, cell, x + nx * 0.5, 172, z + nz * 0.5, nx, nz));
  };
  signPost(-2420, 1572, 0, 1, CELLS.way(0));
  signPost(-2985, 1572, 0, 1, CELLS.way(0));
  signPost(curbX + 6, 2560, 0, -1, CELLS.way(1));
  signPost(-2420, 1572 - 6, 0, -1, CELLS.way(2));
  // A mint light line at the foot of each footbridge stair, and up its edge.
  for (const x of [-2935, -2465]) {
    ground.push(tint(new THREE.PlaneGeometry(60, 3).rotateX(-Math.PI / 2).translate(x, 1.1, 1546), 0x5dffc8));
    lit.push(quad(60, 6, CELLS.swatch(2), x, 4, 1546.5, 0, 1));
  }
  // The back-alley gate: two posts, a lit beam and paper-style lanterns.
  {
    const gx = -2512, z0 = 2697, z1 = 2809;
    for (const z of [z0, z1]) solid.push(tint(boxAt(6, 160, 6, gx, 80, z), FRAME));
    solid.push(tint(boxAt(8, 10, z1 - z0 + 8, gx, 158, (z0 + z1) / 2), FRAME));
    lit.push(quad(z1 - z0 - 6, 6, CELLS.swatch(0), gx - 4.5, 150, (z0 + z1) / 2, -1, 0));
    for (let k = 0; k < 5; k++) {
      solid.push(tint(boxAt(1, 8, 1, gx, 150, z0 + 14 + k * 21), FRAME));
      lit.push(quad(9, 13, CELLS.swatch(k % 2 ? 4 : 3), gx - 4.6, 138, z0 + 14 + k * 21, -1, 0));
    }
  }

  // Railway arches near the station: lit shops and bicycle parking under the tracks.
  const si = STATIONS.findIndex((s) => s.name === '渋谷');
  let archCount = 0;
  for (const i of [si - 1, si]) {
    const a = LOOP[(i + LOOP.length) % LOOP.length], b = LOOP[(i + 1) % LOOP.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z), ang = Math.atan2(b.x - a.x, b.z - a.z), L2 = len + VIADUCT.w * 0.6;
    const F = new THREE.Matrix4().compose(new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(1, 1, 1));
    // The city side of the viaduct (local ±x, whichever faces into the loop).
    const nx = Math.cos(ang), nz = -Math.sin(ang), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const side = insideLoop(mx + nx * 400, mz + nz * 400, 0) ? 1 : -1;
    for (let k = 0; ; k++) {
      const zl = L2 / 2 - 260 * (k + 0.5);
      if (zl < -L2 / 2) break;
      if (Math.abs(zl) > len / 2 - 320) continue;
      const g = quad(200, 152, CELLS.garage(Math.floor(rnd() * 4)), side * (VIADUCT.w / 2 + 1.5), 76, zl, side, 0).applyMatrix4(F);
      arches.push(g);
      archCount++;
    }
  }

  // Materials: lit pieces carry their own light (dimmer by day); one atlas for all of them.
  const tex = atlas();
  const litMat = nearFade(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.8, roughness: 1 }), 30, 120);
  const archMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.85, roughness: 1 });
  // Awnings, posts and rails between the camera and the player dissolve (as trees and signs do).
  const solidMat = nearFade(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 }), 30, 120);
  const leafMat = nearFade(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  NIGHT_GLOW.push({ set: (k) => { litMat.emissiveIntensity = 0.8 + 0.25 * k; archMat.emissiveIntensity = 0.85 + 0.15 * k; } });
  let tris = 0;
  const add = (list: THREE.BufferGeometry[], mat: THREE.Material, shadow: boolean) => {
    if (!list.length) return;
    const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)));
    if (!g) return;
    tris += g.attributes.position.count / 3;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow;
    m.receiveShadow = !shadow || mat === solidMat;
    m.name = 'showcase';
    scene.add(m);
  };
  add([...lit, ...screens], litMat, false);
  add(solid, solidMat, true);
  add(leaf, leafMat, true);
  add(ground, groundMat, false);
  add(arches, archMat, false);
  return { faces: faces.length, bays, drawCalls: 5, triangles: Math.round(tris), arches: archCount };
}
