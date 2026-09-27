import * as THREE from 'three';
import { NATION_IDS, NATIONS } from '../config/nations';
import { BOUNDS, GROUND, PLAZA, RIVER, ROADS, TOWER } from '../config/map';

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
 * Paints the battlefield: grass, forest floor outside the play area,
 * each kingdom's territory tint, dirt roads from each base to the tower,
 * and stone plazas at the tower and bases.
 */
export function groundTexture(): THREE.CanvasTexture {
  const PX = 0.7; // pixels per world unit
  const W = Math.round(GROUND_EXTENT.w * PX), H = Math.round(GROUND_EXTENT.d * PX);
  const [c, g] = canvas(W, H);
  const rnd = prng(7);
  const X = (x: number) => (x + GROUND_EXTENT.w / 2) * PX;
  const Z = (z: number) => (z + GROUND_EXTENT.d / 2) * PX;

  g.fillStyle = '#2f3f24';
  g.fillRect(0, 0, W, H);
  // Play area: lighter meadow.
  g.fillStyle = '#4d6a36';
  g.fillRect(X(BOUNDS.minX - 20), Z(BOUNDS.minZ - 20), (BOUNDS.maxX - BOUNDS.minX + 40) * PX, (BOUNDS.maxZ - BOUNDS.minZ + 40) * PX);
  // Grass mottling.
  for (let i = 0; i < 26000; i++) {
    const s = 1 + rnd() * 3;
    g.fillStyle = `hsla(${88 + rnd() * 30},${30 + rnd() * 20}%,${22 + rnd() * 16}%,${0.25 + rnd() * 0.35})`;
    g.fillRect(rnd() * W, rnd() * H, s, s);
  }
  // Kingdom territories.
  for (const n of NATION_IDS) {
    const b = NATIONS[n].base;
    const grd = g.createRadialGradient(X(b.x), Z(b.z), 0, X(b.x), Z(b.z), 620 * PX);
    grd.addColorStop(0, hexCss(NATIONS[n].color, 0.22));
    grd.addColorStop(1, hexCss(NATIONS[n].color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  // Roads: each base to the tower, and a ring around the tower plaza.
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const road = (pts: [number, number][], width: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = width * PX;
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.stroke();
  };
  const routes = ROADS.map((r) => r.map(([x, z]) => [x, z] as [number, number]));
  for (const r of routes) road(r, 54, 'rgba(92,74,48,.55)');
  for (const r of routes) road(r, 40, '#9a8058');
  for (let i = 0; i < 9000; i++) {
    // Gravel speckle, only visible where it lands on a road colour.
    g.fillStyle = `rgba(${60 + rnd() * 60},${50 + rnd() * 40},${30 + rnd() * 30},.35)`;
    g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
  }
  // Stone plazas.
  const plaza = (x: number, z: number, r: number) => {
    g.fillStyle = '#8a857a';
    g.beginPath();
    g.arc(X(x), Z(z), r * PX, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(40,36,30,.35)';
    g.lineWidth = 1;
    for (let k = 1; k <= 4; k++) {
      g.beginPath();
      g.arc(X(x), Z(z), (r * PX * k) / 4, 0, Math.PI * 2);
      g.stroke();
    }
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      g.beginPath();
      g.moveTo(X(x), Z(z));
      g.lineTo(X(x) + Math.cos(ang) * r * PX, Z(z) + Math.sin(ang) * r * PX);
      g.stroke();
    }
  };
  // Town paving and the river bed (the water plane sits above it).
  g.fillStyle = '#857d6c';
  g.fillRect(X(-640), Z(-790), 1280 * PX, 400 * PX);
  g.strokeStyle = 'rgba(40,36,30,.25)';
  g.lineWidth = 1;
  for (let x = -640; x <= 640; x += 32) { g.beginPath(); g.moveTo(X(x), Z(-790)); g.lineTo(X(x), Z(-390)); g.stroke(); }
  for (let z = -790; z <= -390; z += 32) { g.beginPath(); g.moveTo(X(-640), Z(z)); g.lineTo(X(640), Z(z)); g.stroke(); }
  g.fillStyle = '#4a5a3a';
  g.fillRect(X(RIVER.minX - 30), Z(RIVER.z - RIVER.d / 2 - 14), (RIVER.maxX - RIVER.minX + 60) * PX, (RIVER.d + 28) * PX);
  g.fillStyle = '#2c4250';
  g.fillRect(X(RIVER.minX), Z(RIVER.z - RIVER.d / 2), (RIVER.maxX - RIVER.minX) * PX, RIVER.d * PX);
  plaza(PLAZA.x, PLAZA.z, PLAZA.r);
  plaza(TOWER.x, TOWER.z, 130);
  for (const n of NATION_IDS) plaza(NATIONS[n].base.x, NATIONS[n].base.z, 100);
  // Packed earth yards under each jail.
  for (const n of NATION_IDS) {
    const j = NATIONS[n].jail;
    g.fillStyle = '#6d5a42';
    g.fillRect(X(j.x - j.w / 2 - 14), Z(j.z - j.d / 2 - 14), (j.w + 28) * PX, (j.d + 28) * PX);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
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
