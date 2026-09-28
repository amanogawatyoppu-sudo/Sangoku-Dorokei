import * as THREE from 'three';
import { NATION_IDS, NATIONS } from '../config/nations';
import { GROUND, KANDA, LOOP, PARKS, RIVER_WIDTH } from '../config/map';

/** Small deterministic PRNG so the generated art is identical every load. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function hexCss(c: number, a = 1): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

/** Ground extent (world units) covered by the painted ground texture. */
export const GROUND_EXTENT = GROUND;

/**
 * Paints Tokyo from above: plain paving for plazas and open ground, parks and
 * gravel squares, each kingdom's district tint, the Kanda river bed, base
 * plazas and jail yards. Streets and sidewalks are drawn on top as meshes.
 */
export function groundTexture(): THREE.CanvasTexture {
  const PX = 0.2; // pixels per world unit (streets and sidewalks are separate meshes)
  const W = Math.round(GROUND.w * PX), H = Math.round(GROUND.d * PX);
  const [c, g] = canvas(W, H);
  const rnd = prng(7);
  const X = (x: number) => (x - GROUND.cx + GROUND.w / 2) * PX;
  const Z = (z: number) => (z - GROUND.cz + GROUND.d / 2) * PX;
  g.fillStyle = '#6d6a64';
  g.fillRect(0, 0, W, H);
  // Inside the loop: pale paving.
  g.fillStyle = '#9a958b';
  g.beginPath();
  LOOP.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
  g.closePath();
  g.fill();
  for (let i = 0; i < 30000; i++) {
    g.fillStyle = `rgba(${40 + rnd() * 60},${40 + rnd() * 60},${40 + rnd() * 60},${0.08 + rnd() * 0.1})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (const n of NATION_IDS) {
    const b = NATIONS[n].base;
    const grd = g.createRadialGradient(X(b.x), Z(b.z), 0, X(b.x), Z(b.z), 500 * PX);
    grd.addColorStop(0, hexCss(NATIONS[n].color, 0.25));
    grd.addColorStop(1, hexCss(NATIONS[n].color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  for (const pk of PARKS) {
    g.fillStyle = pk.kind === 'park' ? '#4f6d38' : '#b3a88f';
    g.fillRect(X(pk.x - pk.w / 2), Z(pk.z - pk.d / 2), pk.w * PX, pk.d * PX);
    if (pk.kind === 'park') for (let i = 0; i < 400; i++) {
      g.fillStyle = `hsla(${90 + rnd() * 30},35%,${22 + rnd() * 14}%,.5)`;
      g.fillRect(X(pk.x - pk.w / 2 + rnd() * pk.w), Z(pk.z - pk.d / 2 + rnd() * pk.d), 2, 2);
    }
  }
  // Roads: asphalt with a dashed centre line.
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const line = (pts: readonly (readonly [number, number])[], width: number, color: string, dash: number[] = []) => {
    g.strokeStyle = color;
    g.lineWidth = width * PX;
    g.setLineDash(dash);
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.stroke();
    g.setLineDash([]);
  };
  // Kanda river bed and banks (the water strip is drawn on top in 3D).
  line(KANDA.map((p) => [p.x, p.z] as const), RIVER_WIDTH + 70, '#8c877c');
  line(KANDA.map((p) => [p.x, p.z] as const), RIVER_WIDTH + 24, '#5a5d52');
  line(KANDA.map((p) => [p.x, p.z] as const), RIVER_WIDTH, '#2c4250');
  // Base plazas and jail yards.
  for (const n of NATION_IDS) {
    const b = NATIONS[n].base, j = NATIONS[n].jail;
    g.fillStyle = '#a9a295';
    g.beginPath();
    g.arc(X(b.x), Z(b.z), 220 * PX, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#6d5a42';
    g.fillRect(X(j.x - j.w / 2 - 14), Z(j.z - j.d / 2 - 14), (j.w + 28) * PX, (j.d + 28) * PX);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

/** Office facade: rows of windows (1 tile = one 32-unit storey band, tiled by world UVs). */
export function windowTexture(base: string, glass: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const rnd = prng(base.length * 97 + glass.length);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const lit = rnd() < 0.25;
      g.fillStyle = lit ? '#f3dca0' : glass;
      g.fillRect(col * 32 + 5, row * 32 + 8, 22, 17);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Tiling fine noise used as a bump map for grass / earth detail up close. */
export function detailNoise(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = prng(11);
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + rnd() * 110;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Tiling ashlar stone for walls (1 tile = 64 world units via box-projected UVs). */
export function stoneTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rnd = prng(3);
  g.fillStyle = '#6f685c';
  g.fillRect(0, 0, S, S);
  const rows = 6, rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -rh * 0.8 : 0;
    while (x < S) {
      const w = rh * (1.2 + rnd() * 1.1);
      const l = 34 + rnd() * 16;
      g.fillStyle = `hsl(${30 + rnd() * 14},${8 + rnd() * 8}%,${l}%)`;
      g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      // Chipped highlight on the top edge.
      g.fillStyle = 'rgba(255,245,225,.10)';
      g.fillRect(x + 2, r * rh + 2, w - 4, 3);
      x += w;
    }
  }
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Banner cloth with the kingdom's emblem, for flags. */
export function emblemTexture(glyph: string, color: number): THREE.CanvasTexture {
  const [c, g] = canvas(128, 192);
  g.fillStyle = hexCss(color);
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = 'rgba(0,0,0,.18)';
  g.fillRect(0, 0, 128, 14);
  g.fillRect(0, 178, 128, 14);
  g.fillStyle = '#fff8e6';
  g.font = 'bold 84px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, 64, 100);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- city textures (v7.5)
//
// Façades are drawn as 2 bays × 4 storeys per tile (a bay ≈ 3.8 m, a storey 3.3 m),
// light and neutral so each building can be tinted with vertex colours.

function repeatTex(c: HTMLCanvasElement, aniso = 8): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  return tex;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, rnd: () => number, a = 0.08): void {
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${rnd() * a})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

/** A window pane: dark glass with a sky reflection, sometimes lit or with blinds / curtains. */
/** A soft round glow (white centre fading out), for halos, light pools and beacons. */
let glowTex: THREE.CanvasTexture | null = null;
export function radialGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.55)');
  grd.addColorStop(0.6, 'rgba(255,255,255,.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** While set, `pane` also paints which windows are lit at dusk (the emissive map of a façade). */
let glowG: CanvasRenderingContext2D | null = null;

function pane(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rnd: () => number, litChance = 0.12): void {
  const r = rnd();
  if (glowG && r < litChance + 0.22) {
    // Lit at dusk: mostly warm, some cool office white; blinds and curtains let less out.
    const warm = (x * 7 + y * 13) % 5 !== 0;
    glowG.fillStyle = r > 0.3 ? (warm ? '#b8894a' : '#8aa4bf') : warm ? '#ffd28a' : '#d6ecff';
    glowG.fillRect(x + 1, y + 1, w - 2, h - 2);
  }
  if (r < litChance) {
    const grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, '#f6dfa4');
    grd.addColorStop(1, '#d9b36a');
    g.fillStyle = grd;
  } else {
    const grd = g.createLinearGradient(x, y, x + w * 0.6, y + h);
    grd.addColorStop(0, '#6f8193');
    grd.addColorStop(0.45, '#394a5a');
    grd.addColorStop(1, '#2a3440');
    g.fillStyle = grd;
  }
  g.fillRect(x, y, w, h);
  if (r > 0.8) {
    // Blinds.
    g.fillStyle = 'rgba(225,222,210,.85)';
    g.fillRect(x, y, w, h * (0.3 + rnd() * 0.5));
    g.fillStyle = 'rgba(0,0,0,.12)';
    for (let yy = y + 3; yy < y + h * 0.8; yy += 4) g.fillRect(x, yy, w, 1);
  } else if (r > 0.65) {
    // Curtains.
    g.fillStyle = ['rgba(236,226,206,.8)', 'rgba(200,214,226,.8)', 'rgba(230,205,190,.8)'][Math.floor(rnd() * 3)];
    g.fillRect(x, y, w * 0.3, h);
    g.fillRect(x + w * 0.72, y, w * 0.28, h);
  }
}

export type FacadeKind = 'glass' | 'concrete' | 'tileA' | 'tileB' | 'apartment' | 'house';
/** Façade tile: 2 bays wide, 4 storeys tall (256 × 512 px). */
/** Which windows of a façade glow at dusk (same layout as `facadeTexture(kind)`), for its emissive map. */
export function windowGlowTexture(kind: FacadeKind): THREE.CanvasTexture {
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 512);
  glowG = g;
  try { facadeTexture(kind).dispose(); } finally { glowG = null; }
  return repeatTex(c);
}

export function facadeTexture(kind: FacadeKind): THREE.CanvasTexture {
  const W = 256, H = 512, BAY = 128, ST = 128;
  const [c, g] = canvas(W, H);
  const rnd = prng({ glass: 21, concrete: 22, tileA: 23, tileB: 24, apartment: 25, house: 26 }[kind]);
  if (kind === 'glass') {
    g.fillStyle = '#c9d1d8';
    g.fillRect(0, 0, W, H);
    for (let s = 0; s < 4; s++) {
      const y = s * ST;
      g.fillStyle = '#8e9aa5'; // spandrel
      g.fillRect(0, y + ST - 22, W, 22);
      for (let m = 0; m < 8; m++) pane(g, m * 32 + 2, y + 3, 28, ST - 28, rnd, 0.1);
      g.fillStyle = '#b8c2cb';
      for (let m = 0; m <= 8; m++) g.fillRect(m * 32 - 1, y, 3, ST - 22);
    }
  } else if (kind === 'concrete') {
    g.fillStyle = '#e0dbd1';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 2500, rnd, 0.06);
    for (let s = 0; s < 4; s++) {
      const y = s * ST;
      g.fillStyle = 'rgba(0,0,0,.10)';
      g.fillRect(0, y + ST - 3, W, 3);
      for (let b = 0; b < 2; b++) {
        for (let k = 0; k < 2; k++) {
          const x = b * BAY + 14 + k * 56;
          g.fillStyle = '#9a968e';
          g.fillRect(x - 3, y + 26, 50, 78);
          pane(g, x, y + 29, 44, 72, rnd);
          g.fillStyle = 'rgba(160,160,160,.9)';
          g.fillRect(x + 21, y + 29, 2, 72);
        }
      }
    }
  } else if (kind === 'tileA' || kind === 'tileB') {
    // 雑居ビル: tiled walls, one wide aluminium window per bay, stickers in some windows.
    g.fillStyle = kind === 'tileA' ? '#ece6da' : '#e6e2de';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.07)';
    const tile = kind === 'tileA' ? 8 : 6;
    for (let y = 0; y < H; y += tile) g.fillRect(0, y, W, 1);
    for (let x = 0; x < W; x += tile * 2) g.fillRect(x, 0, 1, H);
    const words = ['英会話', '歯科', 'テナント募集', '整体', 'ネイル', '税理士', '学習塾', 'ヨガ', 'BAR', '麻雀'];
    for (let s = 0; s < 4; s++) {
      const y = s * ST;
      for (let b = 0; b < 2; b++) {
        const x = b * BAY + 10;
        g.fillStyle = '#b9bcbf';
        g.fillRect(x - 4, y + 22, BAY - 12, 84);
        pane(g, x, y + 26, BAY - 20, 76, rnd, 0.22);
        g.fillStyle = 'rgba(200,200,200,.9)';
        g.fillRect(x + (BAY - 20) / 2 - 1, y + 26, 3, 76);
        if (rnd() < 0.35) {
          // Window lettering (cutting-sheet signs are everywhere in Tokyo).
          const word = words[Math.floor(rnd() * words.length)];
          g.fillStyle = ['#d8322a', '#1f5fb8', '#f2f2f2', '#e8b820'][Math.floor(rnd() * 4)];
          g.font = `bold ${word.length > 4 ? 15 : 22}px sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(word, x + (BAY - 20) / 2, y + 64);
        }
      }
    }
  } else if (kind === 'apartment') {
    // マンション: balconies with railings, sliding doors, the odd air-con unit and laundry.
    g.fillStyle = '#efece6';
    g.fillRect(0, 0, W, H);
    for (let s = 0; s < 4; s++) {
      const y = s * ST;
      for (let b = 0; b < 2; b++) {
        const x = b * BAY;
        pane(g, x + 12, y + 12, BAY - 24, 84, rnd, 0.15);
        g.fillStyle = 'rgba(190,190,190,.9)';
        g.fillRect(x + BAY / 2 - 1, y + 12, 3, 84);
        if (rnd() < 0.3) {
          for (let k = 0; k < 4; k++) {
            g.fillStyle = `hsl(${rnd() * 360},${40 + rnd() * 40}%,${55 + rnd() * 25}%)`;
            g.fillRect(x + 20 + k * 22, y + 44, 16, 26);
          }
        }
        if (rnd() < 0.5) {
          g.fillStyle = '#dedcd6';
          g.fillRect(x + BAY - 42, y + 76, 30, 22);
          g.fillStyle = '#8f8f8f';
          g.beginPath();
          g.arc(x + BAY - 27, y + 87, 7, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(200,210,215,.78)'; // frosted railing panel
        g.fillRect(x + 4, y + 70, BAY - 8, 42);
        g.fillStyle = '#c9c4ba';
        g.fillRect(x + 4, y + 68, BAY - 8, 4);
        g.fillStyle = '#d9d5ce'; // partition wall
        g.fillRect(x, y, 6, ST);
      }
      g.fillStyle = '#f6f4f0'; // balcony slab edge
      g.fillRect(0, y + ST - 16, W, 16);
      g.fillStyle = 'rgba(0,0,0,.12)';
      g.fillRect(0, y + ST - 2, W, 2);
    }
  } else {
    // 住宅: siding, smaller windows, some with shutters (雨戸).
    g.fillStyle = '#ebe5d9';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.06)';
    for (let y = 0; y < H; y += 7) g.fillRect(0, y, W, 1);
    for (let s = 0; s < 4; s++) {
      const y = s * ST;
      for (let b = 0; b < 2; b++) {
        const x = b * BAY + 30 + (rnd() - 0.5) * 20;
        g.fillStyle = '#f7f5f0';
        g.fillRect(x - 4, y + 30, 64, 70);
        if (rnd() < 0.25) {
          g.fillStyle = '#a8a39a';
          g.fillRect(x, y + 34, 56, 62);
          g.fillStyle = 'rgba(0,0,0,.2)';
          for (let yy = y + 38; yy < y + 96; yy += 5) g.fillRect(x, yy, 56, 1);
        } else pane(g, x, y + 34, 56, 62, rnd, 0.15);
      }
    }
  }
  return repeatTex(c);
}

/** Flat roof: concrete with stains, drains and tar joints (1 tile ≈ 8 m). */
export function roofTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = prng(31);
  g.fillStyle = '#9d9a93';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 4000, rnd, 0.12);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(40,40,40,${0.04 + rnd() * 0.08})`;
    g.beginPath();
    g.ellipse(rnd() * 256, rnd() * 256, 10 + rnd() * 40, 6 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(50,50,50,.35)';
  for (let k = 0; k <= 256; k += 64) { g.fillRect(k, 0, 2, 256); g.fillRect(0, k, 256, 2); }
  return repeatTex(c);
}

/** Pitched roof tiles for houses (slate / 瓦 rows). */
export function roofTileTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const rnd = prng(32);
  g.fillStyle = '#6a6a6a';
  g.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 16; r++) {
    for (let k = 0; k < 8; k++) {
      const l = 36 + rnd() * 14;
      g.fillStyle = `hsl(210,5%,${l}%)`;
      g.fillRect(k * 16 + (r % 2) * 8, r * 8, 15, 7);
    }
  }
  return repeatTex(c);
}

/** Wet patches drawn into the colour map; the same shapes go into the roughness map. */
interface Puddle { x: number; y: number; rx: number; ry: number; a: number }

/** Asphalt with fine aggregate, patching, cracks (some tar-sealed), oil stains and shallow puddles. */
function asphalt(g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, wear = false): Puddle[] {
  g.fillStyle = '#44464a';
  g.fillRect(0, 0, w, h);
  // Large, soft tone variation so the tiling does not read.
  for (let i = 0; i < 10; i++) {
    const x = rnd() * w, y = rnd() * h, r = 40 + rnd() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const v = rnd() < 0.5 ? '18,18,20' : '120,118,112';
    gr.addColorStop(0, `rgba(${v},${0.05 + rnd() * 0.06})`);
    gr.addColorStop(1, `rgba(${v},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  speckle(g, w, h, (w * h) / 12, rnd, 0.16);
  // Patches: rectangular re-surfacing, slightly darker with a lighter seam.
  for (let i = 0; i < Math.max(2, (w * h) / 30000); i++) {
    const x = rnd() * w, y = rnd() * h, pw = 20 + rnd() * 70, ph = 20 + rnd() * 60;
    g.fillStyle = `rgba(22,22,24,${0.12 + rnd() * 0.1})`;
    g.fillRect(x, y, pw, ph);
    g.strokeStyle = 'rgba(150,146,138,.12)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, pw, ph);
  }
  // Tyre wear: two slightly polished bands per lane, along v.
  if (wear) {
    for (const u of [0.14, 0.36, 0.64, 0.86]) {
      const gr = g.createLinearGradient((u - 0.05) * w, 0, (u + 0.05) * w, 0);
      gr.addColorStop(0, 'rgba(24,24,26,0)');
      gr.addColorStop(0.5, 'rgba(24,24,26,.16)');
      gr.addColorStop(1, 'rgba(24,24,26,0)');
      g.fillStyle = gr;
      g.fillRect((u - 0.05) * w, 0, 0.1 * w, h);
    }
  }
  // Cracks: branching polylines; about half are sealed with shiny black tar.
  const crack = (x: number, y: number, ang: number, len: number, depth: number) => {
    const sealed = rnd() < 0.5;
    g.strokeStyle = sealed ? 'rgba(12,12,14,.55)' : 'rgba(16,16,18,.7)';
    g.lineWidth = sealed ? 2.2 : 0.9;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < len; k += 6) {
      ang += (rnd() - 0.5) * 0.9;
      x += Math.cos(ang) * 6; y += Math.sin(ang) * 6;
      g.lineTo(x, y);
      if (depth < 2 && rnd() < 0.08) crack(x, y, ang + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd()), len * 0.4, depth + 1);
    }
    g.stroke();
  };
  for (let i = 0; i < Math.max(2, (w * h) / 20000); i++) crack(rnd() * w, rnd() * h, rnd() * Math.PI * 2, 30 + rnd() * 90, 0);
  // Oil stains.
  for (let i = 0; i < Math.max(1, (w * h) / 40000); i++) {
    const x = rnd() * w, y = rnd() * h, r = 6 + rnd() * 14;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(8,8,10,.35)');
    gr.addColorStop(1, 'rgba(8,8,10,0)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(x, y, r * 1.4, r, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  // Puddles: darker, glossy (low roughness), catching the dusk light.
  const puddles: Puddle[] = [];
  for (let i = 0; i < Math.max(1, (w * h) / 60000); i++) {
    const p = { x: 20 + rnd() * (w - 40), y: 20 + rnd() * (h - 40), rx: 10 + rnd() * 26, ry: 6 + rnd() * 14, a: rnd() * Math.PI };
    puddles.push(p);
    g.fillStyle = 'rgba(14,16,22,.45)';
    blob(g, p, 1);
    g.fillStyle = 'rgba(70,64,70,.25)';
    blob(g, p, 0.55);
  }
  return puddles;
}

function blob(g: CanvasRenderingContext2D, p: Puddle, k: number): void {
  g.beginPath();
  g.ellipse(p.x, p.y, p.rx * k, p.ry * k, p.a, 0, Math.PI * 2);
  g.ellipse(p.x + p.rx * 0.5 * k, p.y + p.ry * 0.4 * k, p.rx * 0.6 * k, p.ry * 0.7 * k, p.a + 0.6, 0, Math.PI * 2);
  g.fill();
}

/** Roughness map: rough everywhere (≈0.95), glassy in the puddles. Read from the green channel. */
function roughnessFrom(w: number, h: number, puddles: Puddle[]): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = 'rgb(242,242,242)';
  g.fillRect(0, 0, w, h);
  g.filter = 'blur(2px)';
  g.fillStyle = 'rgb(40,40,40)';
  for (const p of puddles) blob(g, p, 0.9);
  const t = repeatTex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** A 60 cm cast-iron manhole cover (マンホール) with its pattern. */
function manhole(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = '#2d2c2b';
  g.beginPath(); g.arc(x, y, r + 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#56524c';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(30,28,26,.8)';
  g.lineWidth = 1;
  for (let k = 1; k < 4; k++) { g.beginPath(); g.arc(x, y, (r * k) / 4, 0, Math.PI * 2); g.stroke(); }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke();
  }
}

export function asphaltTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const puddles = asphalt(g, 256, 256, prng(41));
  const tex = repeatTex(c);
  tex.userData.rough = roughnessFrom(256, 256, puddles);
  return tex;
}

/** Road texture length along v: 4 × 260 units (four dash cycles), so manholes and cracks repeat only every ~40 m. */
export const ROAD_TILE_V = 1040;

/**
 * Road surface with its markings. u runs across the whole road (0..1), v along it
 * (1 tile = ROAD_TILE_V units; each 260 units is a 5 m dash and a 5 m gap).
 * - avenue: white edge lines, dashed lane lines, yellow double centre line
 * - street: white edge lines and a dashed centre line
 * - alley:  white 路側帯 lines only
 * Worn markings, cracks, a manhole cover and a puddle; `userData.rough` holds the matching roughness map.
 */
export function roadTexture(kind: 'avenue' | 'street' | 'alley', widthUnits: number): THREE.CanvasTexture {
  const W = kind === 'alley' ? 128 : 512, H = 1024;
  const [c, g] = canvas(W, H);
  const rnd = prng(kind.length * 7);
  const puddles = asphalt(g, W, H, rnd, kind !== 'alley');
  const px = W / widthUnits;
  const line = (u: number, width: number, color: string, dashed = false) => {
    const x = u * W - (width * px) / 2;
    for (let t = 0; t < 4; t++) {
      g.fillStyle = color;
      if (dashed) g.fillRect(x, t * 256, width * px, 128);
      else g.fillRect(x, t * 256, width * px, 256);
    }
  };
  const white = 'rgba(236,236,230,.88)', yellow = 'rgba(232,180,40,.9)';
  if (kind === 'avenue') {
    line(14 / widthUnits, 5, white);
    line(1 - 14 / widthUnits, 5, white);
    line(0.25, 4, white, true);
    line(0.75, 4, white, true);
    line(0.5 - 5 / widthUnits, 4, yellow);
    line(0.5 + 5 / widthUnits, 4, yellow);
  } else if (kind === 'street') {
    line(22 / widthUnits, 4, white);
    line(1 - 22 / widthUnits, 4, white);
    line(0.5, 4, white, true);
  } else {
    line(14 / widthUnits, 4, white);
    line(1 - 14 / widthUnits, 4, white);
  }
  // Worn paint: asphalt showing through the markings.
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(68,70,74,${0.25 + rnd() * 0.5})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 5);
  }
  g.globalCompositeOperation = 'source-over';
  // A manhole in a lane (not on the lines).
  // (u and v have different pixel densities: squash so the cover stays round.)
  const hole = (u: number, v: number) => {
    g.save();
    g.translate(W * u, H * v);
    g.scale(1, H / ROAD_TILE_V / px);
    manhole(g, 0, 0, 15.6 * px);
    g.restore();
  };
  hole(kind === 'alley' ? 0.5 : 0.38, 0.62);
  if (kind === 'avenue') hole(0.62, 0.18);
  const tex = repeatTex(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  const rough = roughnessFrom(W, H, puddles);
  rough.wrapS = THREE.ClampToEdgeWrapping;
  tex.userData.rough = rough;
  return tex;
}

/** Interlocking sidewalk pavers (1 tile ≈ 4 m). */
export function paverTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = prng(51);
  g.fillStyle = '#8f8b84';
  g.fillRect(0, 0, 256, 256);
  const bw = 32, bh = 16;
  for (let r = 0; r < 256 / bh; r++) {
    for (let k = -1; k < 256 / bw; k++) {
      const l = 58 + rnd() * 12;
      g.fillStyle = `hsl(${30 + rnd() * 10},${6 + rnd() * 6}%,${l}%)`;
      g.fillRect(k * bw + (r % 2) * (bw / 2) + 1, r * bh + 1, bw - 2, bh - 2);
    }
  }
  speckle(g, 256, 256, 3000, rnd, 0.1);
  // Weathering: soft damp blotches and the odd dark spot (chewing gum, drips).
  for (let i = 0; i < 7; i++) {
    const x = rnd() * 256, y = rnd() * 256, r = 18 + rnd() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(40,36,30,${0.08 + rnd() * 0.08})`);
    gr.addColorStop(1, 'rgba(40,36,30,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(30,28,26,${0.2 + rnd() * 0.3})`;
    g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 0.8 + rnd() * 1.6, 0, Math.PI * 2); g.fill();
  }
  return repeatTex(c);
}

/** Yellow tactile paving (点字ブロック) with raised dots. */
export function tactileTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#e2b53a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.fillRect(0, 0, 64, 1);
  g.fillRect(0, 0, 1, 64);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    g.fillStyle = '#f0c850';
    g.beginPath();
    g.arc(7 + x * 12.5, 7 + y * 12.5, 3.5, 0, Math.PI * 2);
    g.fill();
  }
  return repeatTex(c, 4);
}

/** Shopfront atlas: 4 × 3 cells of 512 × 256 (one ground-floor frontage each). */
export const SHOP_CELLS = {
  konbini: 0, ramen: 1, cafe: 2, drugstore: 3, realty: 4, shutter: 5, izakaya: 6, boutique: 7,
  lobby: 8, mansion: 9, houseFront: 10, wall: 11,
} as const;
export function shopAtlas(): THREE.CanvasTexture {
  const CW = 512, CH = 256;
  const [c, g] = canvas(CW * 4, CH * 3);
  const rnd = prng(61);
  const text = (s: string, x: number, y: number, size: number, color: string, font = 'sans-serif', weight = 'bold') => {
    g.fillStyle = color;
    g.font = `${weight} ${size}px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  };
  const glassFront = (x: number, y: number, w: number, h: number, warm: string) => {
    const grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, warm);
    grd.addColorStop(1, '#6d6152');
    g.fillStyle = grd;
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.fillRect(x, y, w * 0.4, h);
    g.fillStyle = '#8b8e91';
    for (let k = 0; k <= 4; k++) g.fillRect(x + (w / 4) * k - 3, y, 6, h);
    g.fillRect(x, y, w, 6);
  };
  const shelves = (x: number, y: number, w: number, h: number) => {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < w / 10; k++) {
        g.fillStyle = `hsl(${rnd() * 360},${50 + rnd() * 40}%,${45 + rnd() * 30}%)`;
        g.fillRect(x + k * 10 + 1, y + r * (h / 4) + 4, 8, h / 4 - 8);
      }
    }
  };
  const cells: ((x: number, y: number) => void)[] = [
    (x, y) => { // コンビニ
      g.fillStyle = '#f4f4f0'; g.fillRect(x, y, CW, CH);
      g.fillStyle = '#1d8f4c'; g.fillRect(x, y + 20, CW, 18);
      g.fillStyle = '#2c6fc0'; g.fillRect(x, y + 38, CW, 18);
      g.fillStyle = '#f08a1c'; g.fillRect(x, y + 56, CW, 10);
      text('STORE 24', x + CW / 2, y + 36, 26, '#ffffff');
      glassFront(x + 10, y + 78, CW - 20, CH - 88, '#fff6de');
      shelves(x + 40, y + 110, CW - 200, 110);
      g.fillStyle = 'rgba(30,30,30,.5)'; g.fillRect(x + CW - 150, y + 100, 110, CH - 100);
    },
    (x, y) => { // ラーメン
      g.fillStyle = '#2a2320'; g.fillRect(x, y, CW, CH);
      g.fillStyle = '#131313'; g.fillRect(x + 20, y + 10, CW - 40, 64);
      text('中華そば', x + CW / 2, y + 43, 44, '#f2e3c0', 'serif');
      glassFront(x + 20, y + 90, CW - 40, CH - 90, '#f3d79c');
      g.fillStyle = '#b8231c'; g.fillRect(x + 150, y + 84, 212, 70);
      for (let k = 1; k < 4; k++) { g.fillStyle = '#2a2320'; g.fillRect(x + 150 + k * 53 - 2, y + 110, 4, 44); }
      text('らーめん', x + CW / 2, y + 104, 28, '#ffffff', 'serif');
      g.fillStyle = '#d8322a'; g.beginPath(); g.ellipse(x + 70, y + 130, 22, 34, 0, 0, Math.PI * 2); g.fill();
    },
    (x, y) => { // カフェ
      g.fillStyle = '#5b3d28'; g.fillRect(x, y, CW, CH);
      g.fillStyle = '#2f2f2f'; g.fillRect(x, y + 14, CW, 56);
      text('CAFE', x + CW / 2, y + 43, 40, '#f4ede0', 'serif', 'normal');
      glassFront(x + 16, y + 84, CW - 32, CH - 84, '#f8d9a0');
      g.fillStyle = '#2d5d3a'; g.fillRect(x, y + 70, CW, 14);
    },
    (x, y) => { // 薬局
      g.fillStyle = '#eef2f6'; g.fillRect(x, y, CW, CH);
      g.fillStyle = '#1f4fb0'; g.fillRect(x, y + 10, CW, 64);
      text('くすり', x + CW / 2, y + 43, 46, '#ffe34a');
      glassFront(x + 10, y + 86, CW - 20, CH - 86, '#fffbe8');
      shelves(x + 30, y + 110, CW - 60, 120);
    },
    (x, y) => { // 不動産
      g.fillStyle = '#e9e7e2'; g.fillRect(x, y, CW, CH);
      g.fillStyle = '#257a3e'; g.fillRect(x, y + 14, CW, 56);
      text('不動産', x + CW / 2, y + 43, 40, '#ffffff');
      glassFront(x + 14, y + 84, CW - 28, CH - 84, '#f1efe6');
      for (let r = 0; r < 3; r++) for (let k = 0; k < 7; k++) { g.fillStyle = '#fbfbf7'; g.fillRect(x + 40 + k * 62, y + 98 + r * 50, 48, 42); g.fillStyle = '#c0392b'; g.fillRect(x + 40 + k * 62, y + 98 + r * 50, 48, 8); }
    },
    (x, y) => { // シャッター
      g.fillStyle = '#b5b3ad'; g.fillRect(x, y, CW, CH);
      g.fillStyle = '#9a9892'; g.fillRect(x, y, CW, 60);
      text('貸店舗', x + CW / 2, y + 32, 30, '#555555');
      for (let yy = y + 70; yy < y + CH; yy += 8) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + 20, yy, CW - 40, 2); }
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 16, y + 64, 6, CH - 64); g.fillRect(x + CW - 22, y + 64, 6, CH - 64);
    },
    (x, y) => { // 居酒屋
      g.fillStyle = '#3a2618'; g.fillRect(x, y, CW, CH);
      g.fillStyle = '#121212'; g.fillRect(x + 60, y + 10, CW - 120, 60);
      text('居酒屋', x + CW / 2, y + 41, 42, '#ffffff', 'serif');
      glassFront(x + 24, y + 90, CW - 48, CH - 90, '#f0b870');
      g.fillStyle = '#1e2a48'; g.fillRect(x + 140, y + 86, 232, 64);
      text('酒 処', x + CW / 2, y + 116, 26, '#ffffff', 'serif');
      for (const lx of [36, CW - 36]) { g.fillStyle = '#e03a20'; g.beginPath(); g.ellipse(x + lx, y + 120, 20, 30, 0, 0, Math.PI * 2); g.fill(); }
    },
    (x, y) => { // 洋服店
      g.fillStyle = '#f2efe9'; g.fillRect(x, y, CW, CH);
      text('BOUTIQUE', x + CW / 2, y + 40, 34, '#333333', 'serif', 'normal');
      glassFront(x + 12, y + 76, CW - 24, CH - 76, '#fffaf0');
      for (let k = 0; k < 4; k++) { g.fillStyle = ['#c2554a', '#39506e', '#e0c070', '#6d8f6a'][k]; g.fillRect(x + 70 + k * 100, y + 120, 44, 90); g.fillStyle = '#e7d0b8'; g.beginPath(); g.arc(x + 92 + k * 100, y + 108, 12, 0, Math.PI * 2); g.fill(); }
    },
    (x, y) => { // office lobby
      g.fillStyle = '#6f7479'; g.fillRect(x, y, CW, CH);
      glassFront(x + 10, y + 16, CW - 20, CH - 16, '#f4f0e4');
      g.fillStyle = '#c8b27a'; g.fillRect(x + CW / 2 - 90, y + 30, 180, 20);
      g.fillStyle = 'rgba(40,40,40,.4)'; g.fillRect(x + CW / 2 - 60, y + 90, 120, CH - 90);
    },
    (x, y) => { // マンション entrance
      g.fillStyle = '#d6cfc3'; g.fillRect(x, y, CW, CH);
      g.fillStyle = 'rgba(0,0,0,.08)'; for (let yy = y; yy < y + CH; yy += 16) g.fillRect(x, yy, CW, 2);
      glassFront(x + 180, y + 60, 150, CH - 60, '#f6ecd4');
      g.fillStyle = '#8c8a86'; g.fillRect(x + 40, y + 110, 110, 90);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { g.fillStyle = '#b8b5ae'; g.fillRect(x + 44 + k * 27, y + 114 + r * 21, 23, 17); }
      g.fillStyle = '#3f6b3a'; g.fillRect(x + 360, y + 180, 120, 40);
      text('MAISON', x + 255, y + 36, 26, '#5a534a', 'serif', 'normal');
    },
    (x, y) => { // 住宅 front: door, window, gate
      g.fillStyle = '#ebe5d9'; g.fillRect(x, y, CW, CH);
      g.fillStyle = 'rgba(0,0,0,.06)'; for (let yy = y; yy < y + CH; yy += 7) g.fillRect(x, yy, CW, 1);
      g.fillStyle = '#6b4a32'; g.fillRect(x + 60, y + 70, 80, CH - 70);
      g.fillStyle = '#c9a15a'; g.fillRect(x + 124, y + 160, 8, 8);
      g.fillStyle = '#f7f5f0'; g.fillRect(x + 250, y + 70, 160, 100);
      pane(g, x + 256, y + 76, 148, 88, rnd, 0);
      g.fillStyle = '#3f4a3a'; g.fillRect(x, y + CH - 60, CW, 60);
      g.fillStyle = '#6a6a66'; for (let k = 0; k < 16; k++) g.fillRect(x + k * 32, y + CH - 60, 4, 60);
      g.fillStyle = '#2f5a2c'; g.fillRect(x + 190, y + CH - 90, 40, 90);
    },
    (x, y) => { // plain wall (sides)
      g.fillStyle = '#e3ddd2'; g.fillRect(x, y, CW, CH);
      g.fillStyle = 'rgba(0,0,0,.06)'; for (let yy = y; yy < y + CH; yy += 12) g.fillRect(x, yy, CW, 1);
      g.fillStyle = '#9a9690'; g.fillRect(x + 80, y + 60, 40, 30);
      g.fillStyle = '#8d8a86'; g.fillRect(x + 400, y, 12, CH);
    },
  ];
  cells.forEach((draw, i) => draw((i % 4) * CW, Math.floor(i / 4) * CH));
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

/** Vertical projecting signs (袖看板): 8 cells of 128 × 512. */
export function signAtlas(): THREE.CanvasTexture {
  const words = ['カラオケ', '居酒屋', '焼肉', '漫画喫茶', '麻雀', '歯科', 'ラーメン', '英会話'];
  const cols = [['#d8322a', '#ffffff'], ['#1a1a1a', '#ffd84a'], ['#7a1d12', '#ffe9c4'], ['#1f5fb8', '#ffffff'], ['#1b6a3a', '#ffffff'], ['#ffffff', '#1f5fb8'], ['#f0b000', '#1a1a1a'], ['#6a2c91', '#ffffff']];
  const [c, g] = canvas(1024, 512);
  words.forEach((w, i) => {
    const x = i * 128;
    g.fillStyle = cols[i][0];
    g.fillRect(x, 0, 128, 512);
    g.strokeStyle = 'rgba(255,255,255,.7)';
    g.lineWidth = 6;
    g.strokeRect(x + 6, 6, 116, 500);
    g.fillStyle = cols[i][1];
    g.font = 'bold 76px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const n = w.length, step = Math.min(96, 470 / n);
    [...w].forEach((ch, k) => g.fillText(ch, x + 64, 256 + (k - (n - 1) / 2) * step));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

/** Vending machine front (2 cells: red, blue). */
export function vendingTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = prng(71);
  for (const [i, body] of ['#c9282d', '#2356a8'].entries()) {
    const x = i * 128;
    g.fillStyle = body;
    g.fillRect(x, 0, 128, 256);
    g.fillStyle = '#f7f7f2';
    g.fillRect(x + 8, 12, 112, 150);
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 7; k++) {
        g.fillStyle = `hsl(${rnd() * 360},${60 + rnd() * 30}%,${40 + rnd() * 30}%)`;
        g.fillRect(x + 14 + k * 15, 20 + r * 36, 10, 24);
        g.fillStyle = '#e8f0ff';
        g.fillRect(x + 14 + k * 15, 46 + r * 36, 10, 3);
      }
    }
    g.fillStyle = '#222';
    g.fillRect(x + 20, 200, 88, 34);
    g.fillStyle = '#ddd';
    g.fillRect(x + 96, 170, 16, 20);
  }
  return new THREE.CanvasTexture(c);
}

/** Red-brick façade with white stone bands and arched windows (Tokyo Station). */
export function brickFacadeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = prng(81);
  g.fillStyle = '#9c4a33';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 6) {
    for (let x = (y / 6) % 2 ? -6 : 0; x < 256; x += 12) {
      g.fillStyle = `hsl(${10 + rnd() * 8},${45 + rnd() * 10}%,${34 + rnd() * 8}%)`;
      g.fillRect(x + 1, y + 1, 10, 4);
    }
  }
  g.fillStyle = '#e8e2d4';
  g.fillRect(0, 118, 256, 12);
  g.fillRect(0, 246, 256, 10);
  for (const x of [40, 168]) {
    for (const y of [20, 148]) {
      g.fillStyle = '#e8e2d4';
      g.fillRect(x - 5, y - 5, 58, 94);
      pane(g, x, y + 10, 48, 74, rnd, 0.2);
      g.beginPath();
      g.fillStyle = '#e8e2d4';
      g.arc(x + 24, y + 10, 26, Math.PI, 0);
      g.fill();
      g.fillStyle = '#394a5a';
      g.beginPath();
      g.arc(x + 24, y + 12, 22, Math.PI, 0);
      g.fill();
    }
  }
  return repeatTex(c);
}

/** Railway viaduct side: concrete with arches (ガード下). */
export function viaductTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  const rnd = prng(91);
  g.fillStyle = '#9d988e';
  g.fillRect(0, 0, 256, 128);
  speckle(g, 256, 128, 2500, rnd, 0.12);
  g.fillStyle = '#3b3934';
  g.beginPath();
  g.moveTo(24, 128);
  g.lineTo(24, 64);
  g.arc(128, 64, 104, Math.PI, 0);
  g.lineTo(232, 128);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.fillRect(0, 0, 256, 10);
  return repeatTex(c);
}

/** Lattice for Tokyo Tower and the radio mast: white bracing on transparent (use alphaTest). */
export function latticeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 7;
  g.strokeRect(3, 3, 122, 122);
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(128, 128);
  g.moveTo(128, 0); g.lineTo(0, 128);
  g.stroke();
  return repeatTex(c, 4);
}

/** Granite façade with pilasters and tall windows (国会議事堂, 迎賓館, museums): 1 tile ≈ 2 bays × 2 storeys. */
export function stoneFacadeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = prng(83);
  g.fillStyle = '#cfc8b8';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = 'rgba(0,0,0,.08)';
    g.fillRect(0, y, 256, 1);
    for (let x = (y / 16) % 2 ? 0 : 24; x < 256; x += 48) g.fillRect(x, y, 1, 16);
  }
  speckle(g, 256, 256, 3000, rnd, 0.08);
  for (const x of [0, 128]) {
    g.fillStyle = '#e0dacb'; // pilaster
    g.fillRect(x, 0, 18, 256);
    g.fillStyle = 'rgba(0,0,0,.12)';
    g.fillRect(x + 18, 0, 3, 256);
    for (const y of [22, 150]) {
      g.fillStyle = '#b9b2a2';
      g.fillRect(x + 42, y - 6, 60, 98);
      pane(g, x + 48, y, 48, 86, rnd, 0.15);
      g.fillStyle = 'rgba(200,200,200,.8)';
      g.fillRect(x + 71, y, 2, 86);
      g.fillStyle = '#ddd6c6';
      g.fillRect(x + 38, y + 88, 68, 8);
    }
  }
  g.fillStyle = '#d8d2c2';
  g.fillRect(0, 120, 256, 10);
  return repeatTex(c);
}
