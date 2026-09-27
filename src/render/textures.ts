import * as THREE from 'three';
import { NATION_IDS, NATIONS } from '../config/nations';
import { GROUND, KANDA, LOOP, PARKS, RIVER_WIDTH, ROADS } from '../config/map';

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
 * Paints Tokyo from above: the loop's pavement, main roads with lane marks,
 * parks and gravel squares, each kingdom's district tint, the Kanda river bed,
 * base plazas and jail yards. Outside the tracks is darker city.
 */
export function groundTexture(): THREE.CanvasTexture {
  const PX = 0.4; // pixels per world unit
  const W = Math.round(GROUND.w * PX), H = Math.round(GROUND.d * PX);
  const [c, g] = canvas(W, H);
  const rnd = prng(7);
  const X = (x: number) => (x - GROUND.cx + GROUND.w / 2) * PX;
  const Z = (z: number) => (z - GROUND.cz + GROUND.d / 2) * PX;
  g.fillStyle = '#34353a';
  g.fillRect(0, 0, W, H);
  // Inside the loop: pale city pavement.
  g.fillStyle = '#8b877d';
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
    const grd = g.createRadialGradient(X(b.x), Z(b.z), 0, X(b.x), Z(b.z), 700 * PX);
    grd.addColorStop(0, hexCss(NATIONS[n].color, 0.22));
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
  for (const r of ROADS) line(r, 76, '#44464b');
  for (const r of ROADS) line(r, 2, 'rgba(240,230,180,.8)', [10, 10]);
  // Kanda river bed and banks (the water strip is drawn on top in 3D).
  line(KANDA.map((p) => [p.x, p.z] as const), RIVER_WIDTH + 24, '#5a5d52');
  line(KANDA.map((p) => [p.x, p.z] as const), RIVER_WIDTH, '#2c4250');
  // Base plazas and jail yards.
  for (const n of NATION_IDS) {
    const b = NATIONS[n].base, j = NATIONS[n].jail;
    g.fillStyle = '#a9a295';
    g.beginPath();
    g.arc(X(b.x), Z(b.z), 110 * PX, 0, Math.PI * 2);
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
