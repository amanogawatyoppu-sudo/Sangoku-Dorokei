import * as THREE from 'three';
import { BOUNDS, BUILDINGS, GROUND_FLOOR, INTERSECTIONS, insideLoop, prng } from '../config/map';
import type { Building } from '../config/map';
import { SECTORS, sectorAt } from '../sim/war';
import { NIGHT_GLOW } from './nightGlow';
import { DISTRICT_CODES } from '../config/terminology';

/**
 * District identity (v9.0, visual only): each of the nine sectors dresses its buildings
 * in its own light — neon, LED screens, crown lines, rooftop rails, aviation beacons
 * and antenna masts — so you can tell where you are from the skyline and the street.
 * Nothing here is solid: collision, navigation, stairs and objectives are untouched.
 * Everything is instanced: three draw calls for the whole city.
 */

export interface DistrictLook {
  /** Light colours, most common first. */
  palette: number[];
  /** Façade signs per building (average). */
  signs: number;
  /** Sign shape: tall neon strips, wide LED screens, or slim horizontal bands. */
  shape: 'strip' | 'screen' | 'band' | 'lantern';
  /** Light line round the roof edge (crown) on taller buildings. */
  crown: number;
  /** Chance of an antenna mast on a tall roof. */
  masts: number;
}

/** By sector id (see SECTORS in sim/war). */
export const DISTRICT_LOOKS: readonly DistrictLook[] = [
  { palette: [0xffffff, 0xff5a4a, 0x7fd8ff], signs: 1.4, shape: 'strip', crown: 0.85, masts: 0.6 }, // 新宿
  { palette: [0xff3fa4, 0x34e6ff, 0xb46bff, 0xffe14a], signs: 3.2, shape: 'strip', crown: 0.2, masts: 0.1 }, // 渋谷
  { palette: [0x7dffb0, 0xfff1c0, 0x45c8ff], signs: 1.2, shape: 'band', crown: 0.95, masts: 0.35 }, // 池袋
  { palette: [0xffc27a, 0xfff0d6], signs: 0.35, shape: 'lantern', crown: 0.05, masts: 0 }, // 文京
  { palette: [0xb9ff7a, 0xffd59a], signs: 0.45, shape: 'lantern', crown: 0.1, masts: 0 }, // 上野
  { palette: [0x39f0ff, 0xffe23a, 0x6bff6b, 0xff4fd8], signs: 3.0, shape: 'screen', crown: 0.3, masts: 0.15 }, // 秋葉原
  { palette: [0xffe2a0, 0xffffff], signs: 0.5, shape: 'band', crown: 1, masts: 0.4 }, // 中央
  { palette: [0xff3b30, 0xffa060, 0xffffff], signs: 1.0, shape: 'band', crown: 0.6, masts: 0.2 }, // 東京タワー
  { palette: [0x9ff3ff, 0xffffff, 0x5a8bff], signs: 0.9, shape: 'band', crown: 0.9, masts: 0.3 }, // 品川
];

/** The district's codename by sector id. */
export function districtCode(sector: number): string {
  return DISTRICT_CODES[sector] ?? '';
}

const OUT: Record<Building['front'], [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

interface Piece { x: number; y: number; z: number; sx: number; sy: number; sz: number; color: number }

/** Lit pieces for one building (signs on the street side, a crown on the roof edge, a beacon on top). */
function dressBuilding(b: Building, look: DistrictLook, rnd: () => number, out: Piece[], masts: Piece[]): void {
  const [nx, nz] = OUT[b.front];
  const alongX = b.front === 'n' || b.front === 's';
  const half = alongX ? b.w / 2 : b.d / 2;
  const faceOff = (alongX ? b.d / 2 : b.w / 2) + 2.5;
  const fx = b.x + nx * faceOff, fz = b.z + nz * faceOff;
  const tx = alongX ? 1 : 0, tz = alongX ? 0 : 1;
  const pick = () => look.palette[Math.floor(rnd() * look.palette.length) % look.palette.length];
  const n = Math.floor(look.signs * (b.type === 'house' ? 0.8 : 2.4) + rnd());
  const top = b.h - 20;
  for (let i = 0; i < n; i++) {
    const u = (rnd() * 2 - 1) * (half - 30);
    let w: number, h: number, y: number;
    switch (look.shape) {
      case 'strip': w = 14; h = Math.min(top - GROUND_FLOOR, 90 + rnd() * 260); y = GROUND_FLOOR + 20 + rnd() * Math.max(0, top - GROUND_FLOOR - h - 20) + h / 2; break;
      case 'screen': w = 70 + rnd() * 90; h = 50 + rnd() * 70; y = GROUND_FLOOR + 30 + rnd() * Math.max(0, Math.min(top, 600) - GROUND_FLOOR - h - 30) + h / 2; break;
      case 'band': w = Math.min(half * 1.6, 120 + rnd() * 200); h = 8; y = GROUND_FLOOR + 10 + rnd() * Math.max(0, top - GROUND_FLOOR - 20); break;
      default: w = 14; h = 20; y = GROUND_FLOOR - 30 + rnd() * 20; break;
    }
    if (y + h / 2 > b.h - 6 || h < 10) continue;
    out.push({ x: fx + tx * u, y, z: fz + tz * u, sx: alongX ? w : 3, sy: h, sz: alongX ? 3 : w, color: pick() });
  }
  // Street-level neon on the corners of the shopfront (the busy districts).
  if (look.shape === 'strip' || look.shape === 'screen') {
    for (const k of [-1, 1]) if (rnd() < look.signs * 0.3) out.push({ x: fx + tx * k * (half - 8), y: 60, z: fz + tz * k * (half - 8), sx: alongX ? 6 : 4, sy: 90, sz: alongX ? 4 : 6, color: pick() });
  }
  // Shopfront light line just above the ground floor (what you see at street level).
  if (rnd() < (b.type === 'house' ? 0.3 : 0.75) + look.signs * 0.1) {
    out.push({ x: fx, y: GROUND_FLOOR - 6, z: fz, sx: alongX ? b.w * 0.8 : 3, sy: 3.5, sz: alongX ? 3 : b.d * 0.8, color: pick() });
  }
  // Crown: a thin light line round the roof edge of the taller buildings.
  if (b.h > GROUND_FLOOR + 200 && rnd() < look.crown) {
    const c = look.palette[0], y = b.h - 4;
    out.push({ x: b.x, y, z: b.z - b.d / 2 - 1.5, sx: b.w, sy: 5, sz: 2, color: c });
    out.push({ x: b.x, y, z: b.z + b.d / 2 + 1.5, sx: b.w, sy: 5, sz: 2, color: c });
    out.push({ x: b.x - b.w / 2 - 1.5, y, z: b.z, sx: 2, sy: 5, sz: b.d, color: c });
    out.push({ x: b.x + b.w / 2 + 1.5, y, z: b.z, sx: 2, sy: 5, sz: b.d, color: c });
  }
  // Masts with a red aviation light on the tallest roofs.
  if (b.h > 500 && rnd() < look.masts) {
    const mh = 80 + rnd() * 140, mx = b.x + (rnd() - 0.5) * b.w * 0.5, mz = b.z + (rnd() - 0.5) * b.d * 0.5;
    masts.push({ x: mx, y: b.h + mh / 2, z: mz, sx: 1, sy: mh, sz: 1, color: 0 });
    out.push({ x: mx, y: b.h + mh + 4, z: mz, sx: 9, sy: 9, sz: 9, color: 0xff2a1e });
  } else if (b.h > 700) {
    out.push({ x: b.x, y: b.h + 5, z: b.z, sx: 8, sy: 8, sz: 8, color: 0xff2a1e });
  }
}

/**
 * Street-level identity at the crossings: hanging LED screens (Akihabara, Shibuya), tall
 * vertical signs (Shinjuku), paper-lantern style lights (Ueno, Bunkyo), light bollards
 * (the business districts). Placed on a corner of the crossing, out of the walking lines.
 */
function dressCrossings(out: Piece[], posts: Piece[]): void {
  for (const ix of INTERSECTIONS) {
    const sec = sectorAt(ix.x, ix.z), look = DISTRICT_LOOKS[sec];
    const rnd = prng(Math.round(ix.x * 13 + ix.z * 7));
    const pick = () => look.palette[Math.floor(rnd() * look.palette.length) % look.palette.length];
    const sx = rnd() < 0.5 ? -1 : 1, sz = rnd() < 0.5 ? -1 : 1;
    const cx = ix.x + sx * (ix.w / 2 + 34), cz = ix.z + sz * (ix.d / 2 + 34);
    if (look.shape === 'screen' || (look.shape === 'strip' && look.signs > 2)) {
      posts.push({ x: cx, y: 80, z: cz, sx: 2.5, sy: 160, sz: 2.5, color: 0 });
      const c = pick(), w = 64 + rnd() * 30, alongX = rnd() < 0.5;
      out.push({ x: cx, y: 128 + rnd() * 16, z: cz, sx: alongX ? w : 4, sy: 40 + rnd() * 12, sz: alongX ? 4 : w, color: c });
    } else if (look.shape === 'strip') {
      posts.push({ x: cx, y: 70, z: cz, sx: 2.5, sy: 140, sz: 2.5, color: 0 });
      out.push({ x: cx, y: 100, z: cz, sx: 12, sy: 80, sz: 12, color: pick() });
    } else if (look.shape === 'lantern') {
      for (let k = 0; k < 3; k++) {
        const lx = cx + (k - 1) * 22 * (rnd() < 0.5 ? 1 : 0), lz = cz + (k - 1) * 22;
        posts.push({ x: lx, y: 35, z: lz, sx: 1.2, sy: 70, sz: 1.2, color: 0 });
        out.push({ x: lx, y: 76, z: lz, sx: 13, sy: 18, sz: 13, color: pick() });
      }
    } else {
      for (let k = -1; k <= 1; k += 2) {
        out.push({ x: cx + k * 18, y: 14, z: cz, sx: 5, sy: 28, sz: 5, color: pick() });
      }
    }
  }
}

/** Subtle sector borders: a dashed line of small light studs along the ground where one district meets the next. */
function borderStuds(out: Piece[]): void {
  const STEP = 60;
  for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += STEP) {
    for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += STEP) {
      if (!insideLoop(x, z, 0)) continue;
      const s = sectorAt(x, z);
      if (sectorAt(x + STEP, z) !== s && ((z / STEP) | 0) % 2 === 0) out.push({ x: x + STEP / 2, y: 1.2, z, sx: 6, sy: 1.2, sz: 26, color: 0xdfe8ff });
      if (sectorAt(x, z + STEP) !== s && ((x / STEP) | 0) % 2 === 0) out.push({ x, y: 1.2, z: z + STEP / 2, sx: 26, sy: 1.2, sz: 6, color: 0xdfe8ff });
    }
  }
}

/**
 * Two crossed quads (4 triangles instead of a box's 12): scaled flat against a wall one of
 * them is the sign and the other a sliver of edge; free-standing it reads as a small block.
 */
function crossGeometry(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(1, 1), b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const pos = [...a.toNonIndexed().attributes.position.array, ...b.toNonIndexed().attributes.position.array];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function instanced(pieces: Piece[], geo: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, pieces.length));
  const mx = new THREE.Matrix4(), c = new THREE.Color();
  pieces.forEach((p, i) => {
    m.setMatrixAt(i, mx.makeScale(p.sx, p.sy, p.sz).setPosition(p.x, p.y, p.z));
    if (p.color) m.setColorAt(i, c.setHex(p.color));
  });
  m.count = pieces.length;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

export interface DistrictStats { signs: number; masts: number; studs: number }

/** Adds the district dressing to the scene (all lights brighten after dark). */
export function buildDistricts(scene: THREE.Scene): DistrictStats {
  const lit: Piece[] = [], masts: Piece[] = [], studs: Piece[] = [];
  // Every building, the skyline beyond the tracks included: the districts read from afar too.
  for (const b of BUILDINGS) {
    const s = sectorAt(b.x, b.z);
    dressBuilding(b, DISTRICT_LOOKS[s], prng(b.seed * 7 + 11), lit, masts);
  }
  dressCrossings(lit, masts);
  borderStuds(studs);
  const cross = crossGeometry();
  // Lit pieces are unlit colour (they are the light): dimmer by day, full at night. One mesh
  // per district, so the ones out of view are culled as a whole.
  const litMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  for (let sec = 0; sec < DISTRICT_LOOKS.length; sec++) {
    const mine = lit.filter((p) => sectorAt(p.x, p.z) === sec);
    if (mine.length) scene.add(instanced(mine, cross, litMat));
  }
  NIGHT_GLOW.push({ set: (k) => { litMat.color.setScalar(0.62 + 0.5 * k); } });
  const mastMesh = instanced(masts, new THREE.CylinderGeometry(1.2, 2.2, 1, 5), new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.6, metalness: 0.4 }));
  scene.add(mastMesh);
  const studMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  const studMesh = instanced(studs, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), studMat);
  scene.add(studMesh);
  NIGHT_GLOW.push({ set: (k) => { studMat.opacity = 0.35 + 0.4 * k; } });
  return { signs: lit.length, masts: masts.length, studs: studs.length };
}

/** Sector names for headings: "新宿 · VERTICAL CITY". */
export function districtTitle(sector: number): string {
  return `${SECTORS[sector].name} · ${districtCode(sector)}`;
}
