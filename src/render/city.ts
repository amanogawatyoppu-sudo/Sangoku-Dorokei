import * as THREE from 'three';
import type { BoxPrim, Building } from '../config/map';
import { groundAt, rampHeight } from '../sim/systems/world';
import {
  BLOCKS, BUILDINGS, CROSSWALKS, CURB, GROUND_FLOOR, INTERSECTIONS, LIGHTS, PARKINGS, POLES, SIGNALS, STOREY,
  STREET_SEGS, WIRES, WORLD, prng,
} from '../config/map';
import {
  SHOP_CELLS, ROAD_TILE_V, asphaltTexture, facadeTexture, paverTexture, roadTexture, roofTexture, roofTileTexture, shopAtlas,
  radialGlowTexture, signAtlas, tactileTexture, vendingTexture, windowGlowTexture,
} from './textures';
import type { FacadeKind } from './textures';
import { buildStreetProps } from './streetProps';
import { NIGHT_GLOW, glowAtNight } from './nightGlow';
import { LAMP_R } from '../sim/night';

/**
 * The city at street level: buildings with storey-accurate façades, shopfronts
 * and projecting signs, roofs and rooftop plant; roads with their markings,
 * sidewalks with kerbs and tactile paving; poles and wires, street lights,
 * signals, vending machines, parked cars and street trees.
 *
 * Everything static is merged per material (a handful of draw calls); repeated
 * small objects are instanced.
 */

type V3 = [number, number, number];
type UV = [number, number];
type RGB = [number, number, number];

/** Façade tile: 2 bays (≈7.7 m) wide, 4 storeys tall. */
const TILE_U = 200, TILE_V = 4 * STOREY;

class Geo {
  private p: number[] = [];
  private n: number[] = [];
  private uv: number[] = [];
  private c: number[] = [];
  private i: number[] = [];
  private v = 0;

  /** A quad a→b→c→d, counter-clockwise as seen from outside; its normal points along `hint`. */
  quad(a: V3, b: V3, c: V3, d: V3, uvs: [UV, UV, UV, UV], col: RGB = [1, 1, 1], hint?: V3): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    let pts = [a, b, c, d], tex = uvs;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      pts = [a, d, c, b];
      tex = [uvs[0], uvs[3], uvs[2], uvs[1]];
      nx = -nx; ny = -ny; nz = -nz;
    }
    for (let k = 0; k < 4; k++) {
      this.p.push(...pts[k]);
      this.n.push(nx, ny, nz);
      this.uv.push(...tex[k]);
      this.c.push(...col);
    }
    const v = this.v;
    this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.v += 4;
  }

  /** Horizontal rectangle facing up. `uv` maps a world point to texture coordinates. */
  top(x0: number, x1: number, z0: number, z1: number, y: number, uv: (x: number, z: number) => UV, col?: RGB): void {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [uv(x0, z1), uv(x1, z1), uv(x1, z0), uv(x0, z0)], col, [0, 1, 0]);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.v) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

type Side = 'n' | 's' | 'e' | 'w';
const SIDES: Side[] = ['n', 's', 'e', 'w'];
const OUT: Record<Side, V3> = { n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0] };

/** Bottom-left and bottom-right corners of a box side as seen from outside. */
function face(x: number, z: number, w: number, d: number, side: Side): { l: [number, number]; r: [number, number]; len: number } {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  switch (side) {
    case 's': return { l: [x0, z1], r: [x1, z1], len: w };
    case 'n': return { l: [x1, z0], r: [x0, z0], len: w };
    case 'e': return { l: [x1, z1], r: [x1, z0], len: d };
    default: return { l: [x0, z0], r: [x0, z1], len: d };
  }
}

/** Part of a side (fractions t0..t1 along it) between y0 and y1. */
function wall(g: Geo, f: ReturnType<typeof face>, side: Side, y0: number, y1: number, t0: number, t1: number, uv: [UV, UV, UV, UV], col?: RGB): void {
  const at = (t: number): [number, number] => [f.l[0] + (f.r[0] - f.l[0]) * t, f.l[1] + (f.r[1] - f.l[1]) * t];
  const a = at(t0), b = at(t1);
  g.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], uv, col, OUT[side]);
}

const pick = <T>(arr: readonly T[], r: number): T => arr[Math.floor(r * arr.length) % arr.length];

const TINTS: Record<FacadeKind, RGB[]> = {
  glass: [[1, 1, 1], [0.9, 0.95, 1], [0.86, 0.93, 0.92], [0.96, 0.94, 0.9], [0.8, 0.86, 0.95]],
  concrete: [[1, 1, 1], [0.96, 0.93, 0.87], [0.88, 0.88, 0.9], [0.98, 0.95, 0.9], [0.84, 0.82, 0.8]],
  tileA: [[1, 0.96, 0.88], [0.93, 0.86, 0.76], [0.86, 0.79, 0.7], [1, 1, 0.97], [0.82, 0.82, 0.84], [0.92, 0.78, 0.68]],
  tileB: [[1, 0.98, 0.95], [0.9, 0.9, 0.92], [0.8, 0.74, 0.68], [0.95, 0.88, 0.8], [0.75, 0.78, 0.8]],
  apartment: [[1, 1, 1], [1, 0.97, 0.9], [0.94, 0.9, 0.85], [0.88, 0.84, 0.78], [0.92, 0.92, 0.94]],
  house: [[1, 0.97, 0.9], [0.93, 0.9, 0.86], [0.86, 0.8, 0.72], [0.76, 0.73, 0.7], [0.98, 0.95, 0.95], [0.72, 0.62, 0.52], [0.8, 0.86, 0.84]],
};

function facadeKind(b: Building, r: number): FacadeKind {
  switch (b.type) {
    case 'office': return r < 0.6 ? 'glass' : 'concrete';
    case 'tower': return 'glass';
    case 'mixed': return r < 0.4 ? 'tileA' : r < 0.8 ? 'tileB' : 'concrete';
    case 'shop': return r < 0.5 ? 'tileA' : 'tileB';
    case 'apartment': return 'apartment';
    default: return 'house';
  }
}

const SHOPS = [SHOP_CELLS.konbini, SHOP_CELLS.ramen, SHOP_CELLS.cafe, SHOP_CELLS.drugstore, SHOP_CELLS.realty, SHOP_CELLS.shutter, SHOP_CELLS.izakaya, SHOP_CELLS.boutique];
function shopCell(b: Building, k: number, r: number): number {
  switch (b.type) {
    case 'office': case 'tower': return SHOP_CELLS.lobby;
    case 'apartment': return k === 0 ? SHOP_CELLS.mansion : r < 0.5 ? pick(SHOPS, r * 2) : SHOP_CELLS.wall;
    case 'house': return k === 0 ? SHOP_CELLS.houseFront : SHOP_CELLS.wall;
    default: return pick(SHOPS, r);
  }
}
/** UVs of a shop atlas cell (4 × 3 grid; canvas row 0 is the top). */
function cellUv(i: number): [UV, UV, UV, UV] {
  const u0 = (i % 4) / 4, u1 = u0 + 0.25, v1 = 1 - Math.floor(i / 4) / 3, v0 = v1 - 1 / 3;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

interface Props { machine: THREE.Matrix4[]; ac: THREE.Matrix4[]; tank: THREE.Matrix4[] }

/** One building: façades, ground-floor frontage, roof (flat with parapet, or pitched for houses), signs, rooftop plant. */
function addBuilding(b: Building, geos: Record<string, Geo>, props: Props): void {
  const rnd = prng(b.seed);
  const kind = facadeKind(b, rnd());
  const tint = pick(TINTS[kind], rnd());
  const G = geos[kind];
  const uOff = Math.floor(rnd() * 4) * 0.5;
  const band = GROUND_FLOOR;
  for (const side of SIDES) {
    const f = face(b.x, b.z, b.w, b.d, side);
    const uEnd = uOff + f.len / TILE_U;
    const front = side === b.front && !b.outside;
    if (front) {
      // Ground-floor frontage: one shop / entrance per ~10 m.
      const n = Math.max(1, Math.round(f.len / 260));
      for (let k = 0; k < n; k++) wall(geos.shop, f, side, 0, band, k / n, (k + 1) / n, cellUv(shopCell(b, k, rnd())));
      wall(G, f, side, band, b.h, 0, 1, [[uOff, 0], [uEnd, 0], [uEnd, (b.h - band) / TILE_V], [uOff, (b.h - band) / TILE_V]], tint);
    } else {
      // Storeys line up with the front (v = 0 at the top of the ground floor; the texture repeats below it).
      const v0 = -band / TILE_V, v1 = (b.h - band) / TILE_V;
      wall(G, f, side, 0, b.h, 0, 1, [[uOff, v0], [uEnd, v0], [uEnd, v1], [uOff, v1]], tint);
    }
  }
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  if (b.type === 'house') {
    addGable(geos.roofTile, geos.house, b, tint, rnd);
    return;
  }
  // Flat roof behind a parapet: ring on top, inner walls, and the roof slab 20 lower.
  const R = geos.roof, P = 8, dip = 20, ry = b.h - dip;
  const ruv = (x: number, z: number): UV => [x / 300, z / 300];
  const g = 0.85 + rnd() * 0.15;
  const rc: RGB = [g, g, g * 0.98];
  R.top(x0, x1, z0, z0 + P, b.h, ruv, rc);
  R.top(x0, x1, z1 - P, z1, b.h, ruv, rc);
  R.top(x0, x0 + P, z0 + P, z1 - P, b.h, ruv, rc);
  R.top(x1 - P, x1, z0 + P, z1 - P, b.h, ruv, rc);
  R.top(x0 + P, x1 - P, z0 + P, z1 - P, ry, ruv, rc);
  const inner = { x: b.x, z: b.z, w: b.w - 2 * P, d: b.d - 2 * P };
  for (const side of SIDES) {
    const f = face(inner.x, inner.z, inner.w, inner.d, side);
    // Inner parapet faces look inward.
    const a = f.l, c = f.r;
    R.quad([c[0], ry, c[1]], [a[0], ry, a[1]], [a[0], b.h, a[1]], [c[0], b.h, c[1]], [[0, 0], [f.len / 300, 0], [f.len / 300, 0.07], [0, 0.07]], rc, OUT[side].map((v) => -v) as V3);
  }
  if (b.outside) return;
  // Rooftop plant: lift machine room, air-con units, a water tank.
  if (b.floors >= 3 && b.w > 180 && b.d > 180) {
    if (rnd() < 0.7) {
      const mw = 90 + rnd() * 60, md = 80 + rnd() * 50;
      props.machine.push(new THREE.Matrix4().compose(new THREE.Vector3(b.x + (rnd() - 0.5) * (b.w - mw - 30), ry + 45, b.z + (rnd() - 0.5) * (b.d - md - 30)), new THREE.Quaternion(), new THREE.Vector3(mw, 90, md)));
    }
    const n = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) props.ac.push(new THREE.Matrix4().makeTranslation(x0 + 30 + rnd() * (b.w - 60), ry + 15, z0 + 30 + rnd() * (b.d - 60)));
    if (rnd() < 0.35) props.tank.push(new THREE.Matrix4().makeTranslation(x0 + 45 + rnd() * (b.w - 90), ry + 55, z0 + 45 + rnd() * (b.d - 90)));
  }
  // Projecting vertical signs on commercial buildings.
  if ((b.type === 'mixed' || b.type === 'shop') && b.district === 'commercial' && b.h - GROUND_FLOOR > 170) {
    const f = face(b.x, b.z, b.w, b.d, b.front);
    const n = rnd() < 0.5 ? 2 : 1;
    for (let k = 0; k < n; k++) addSign(geos.sign, f, b.front, k === 0 ? 34 : f.len - 34, GROUND_FLOOR + 14, Math.min(b.h - 30, GROUND_FLOOR + 14 + 3 * STOREY), Math.floor(rnd() * 8));
  }
}

/** A vertical sign standing out from a façade, readable from both directions along the street. */
function addSign(g: Geo, f: ReturnType<typeof face>, side: Side, s: number, y0: number, y1: number, cell: number): void {
  const tx = (f.r[0] - f.l[0]) / f.len, tz = (f.r[1] - f.l[1]) / f.len;
  const px = f.l[0] + tx * s, pz = f.l[1] + tz * s;
  const [nx, , nz] = OUT[side];
  const A: [number, number] = [px + nx * 12, pz + nz * 12], B: [number, number] = [px + nx * 72, pz + nz * 72];
  const u0 = cell / 8, u1 = (cell + 1) / 8;
  for (const dir of [1, -1]) {
    // Viewer looking along -dir·t: their right is (-dir·t) × up.
    const rx = -dir * -tz, rz = -dir * tx;
    const [bl, br] = A[0] * rx + A[1] * rz < B[0] * rx + B[1] * rz ? [A, B] : [B, A];
    const off = dir * 0.5;
    g.quad([bl[0] + tx * off, y0, bl[1] + tz * off], [br[0] + tx * off, y0, br[1] + tz * off], [br[0] + tx * off, y1, br[1] + tz * off], [bl[0] + tx * off, y1, bl[1] + tz * off],
      [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], [1, 1, 1], [dir * tx, 0, dir * tz]);
  }
}

/** Pitched roof along the longer side, with gable ends. */
function addGable(R: Geo, W: Geo, b: Building, tint: RGB, rnd: () => number): void {
  const o = 12, alongX = b.w >= b.d;
  const rh = Math.min(b.w, b.d) * 0.28;
  const shade = 0.55 + rnd() * 0.5;
  const col: RGB = pick([[shade, shade, shade], [shade * 0.9, shade * 0.75, shade * 0.62], [shade * 0.7, shade * 0.8, shade]], rnd());
  // Local frame: a along the ridge, b across it.
  const P = (a: number, y: number, c: number): V3 => (alongX ? [a, y, c] : [c, y, a]);
  const ca = alongX ? b.x : b.z, cb = alongX ? b.z : b.x, la = (alongX ? b.w : b.d) / 2 + o, lb = (alongX ? b.d : b.w) / 2;
  const top = b.h + rh;
  const slope = Math.hypot(lb + o, rh) / 100;
  for (const s of [1, -1]) {
    const eave = cb + s * (lb + o);
    const hint = P(0, 1, s);
    R.quad(P(ca - la, b.h - o * (rh / lb), eave), P(ca + la, b.h - o * (rh / lb), eave), P(ca + la, top, cb), P(ca - la, top, cb),
      [[0, 0], [(2 * la) / 100, 0], [(2 * la) / 100, slope], [0, slope]], col, hint);
    // Gable triangle (degenerate quad) at each end.
    const ga = ca + s * (la - o);
    W.quad(P(ga, b.h, cb - lb), P(ga, b.h, cb + lb), P(ga, top, cb), P(ga, top, cb), [[0, 0], [lb / 100, 0], [lb / 200, rh / TILE_V], [lb / 200, rh / TILE_V]], tint, P(s, 0, 0));
  }
}

/** Instanced mesh from matrices (and optional per-instance colours). */
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], ms: THREE.Matrix4[], colors?: THREE.Color[], shadow = true): THREE.InstancedMesh | null {
  if (!ms.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, ms.length);
  ms.forEach((x, i) => m.setMatrixAt(i, x));
  colors?.forEach((c, i) => m.setColorAt(i, c));
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
const at = (x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(sx, sy, sz));

export function buildCity(scene: THREE.Scene): void {
  const geos: Record<string, Geo> = {};
  const G = (k: string) => (geos[k] ??= new Geo());
  for (const k of ['glass', 'concrete', 'tileA', 'tileB', 'apartment', 'house', 'shop', 'roof', 'roofTile', 'sign', 'avenue', 'street', 'alley', 'asphalt', 'zebra', 'paver', 'curb', 'tactile', 'lines']) G(k);
  const props: Props = { machine: [], ac: [], tank: [] };
  for (const b of BUILDINGS) addBuilding(b, geos, props);

  // Streets: segments with markings, plain asphalt at intersections.
  for (const s of STREET_SEGS) {
    const x0 = s.x - s.w / 2, x1 = s.x + s.w / 2, z0 = s.z - s.d / 2, z1 = s.z + s.d / 2;
    const y = s.kind === 'avenue' ? 0.6 : 0.5;
    if (s.axis === 'z') geos[s.kind].quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [[0, s.d / ROAD_TILE_V], [1, s.d / ROAD_TILE_V], [1, 0], [0, 0]], undefined, [0, 1, 0]);
    else geos[s.kind].quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [[1, 0], [1, s.w / ROAD_TILE_V], [0, s.w / ROAD_TILE_V], [0, 0]], undefined, [0, 1, 0]);
  }
  // Expressway decks and ramps get a road surface.
  for (const p of WORLD) {
    if (p.group !== 'expressway' || Math.min(p.w, p.d) < 250) continue;
    const alongZ = p.d > p.w, x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2, len = alongZ ? p.d : p.w;
    const hAt = (x: number, z: number) => (p.kind === 'box' ? p.y1 : rampHeight(p, x, z)) + 0.5;
    const y = (x: number, z: number): V3 => [x, hAt(x, z), z];
    if (p.kind === 'box' && p.y0 < p.y1 - 30) continue; // pillars
    if (alongZ) geos.avenue.quad(y(x0, z1), y(x1, z1), y(x1, z0), y(x0, z0), [[0, len / ROAD_TILE_V], [1, len / ROAD_TILE_V], [1, 0], [0, 0]], undefined, [0, 1, 0]);
    else geos.avenue.quad(y(x0, z1), y(x1, z1), y(x1, z0), y(x0, z0), [[1, 0], [1, len / ROAD_TILE_V], [0, len / ROAD_TILE_V], [0, 0]], undefined, [0, 1, 0]);
  }
  const auv = (x: number, z: number): UV => [x / 260, z / 260];
  for (const ix of INTERSECTIONS) geos.asphalt.top(ix.x - ix.w / 2, ix.x + ix.w / 2, ix.z - ix.d / 2, ix.z + ix.d / 2, 0.45, auv);
  // Zebra crossings: bars 45 cm wide, parallel to the traffic.
  for (const c of CROSSWALKS) {
    const across = c.axis === 'x' ? c.w : c.d, n = Math.floor((across - 30) / 28);
    for (let k = 0; k < n; k++) {
      const o = -across / 2 + 15 + k * 28 + 7;
      if (c.axis === 'x') geos.zebra.top(c.x + o - 7, c.x + o + 7, c.z - c.d / 2, c.z + c.d / 2, 0.9, () => [0, 0]);
      else geos.zebra.top(c.x - c.w / 2, c.x + c.w / 2, c.z + o - 7, c.z + o + 7, 0.9, () => [0, 0]);
    }
  }
  // Sidewalk blocks: paving on top, kerbs round the edge, tactile paving along the streets.
  const puv = (x: number, z: number): UV => [x / 104, z / 104];
  for (const b of BLOCKS) {
    geos.paver.top(b.x0, b.x1, b.z0, b.z1, CURB + 0.02, puv);
    const w = b.x1 - b.x0, d = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    for (const side of SIDES) {
      const f = face(cx, cz, w, d, side);
      wall(geos.curb, f, side, 0, CURB, 0, 1, [[0, 0], [f.len / 60, 0], [f.len / 60, 0.1], [0, 0.1]]);
      if (b.sides[side] === 'alley') continue;
      const inset = b.sides[side] === 'avenue' ? 22 : 30, tw = 12, m = 50;
      if (side === 'n') geos.tactile.top(b.x0 + m, b.x1 - m, b.z0 + inset, b.z0 + inset + tw, CURB + 0.2, (x, z) => [x / 12, z / 12]);
      if (side === 's') geos.tactile.top(b.x0 + m, b.x1 - m, b.z1 - inset - tw, b.z1 - inset, CURB + 0.2, (x, z) => [x / 12, z / 12]);
      if (side === 'w') geos.tactile.top(b.x0 + inset, b.x0 + inset + tw, b.z0 + m, b.z1 - m, CURB + 0.2, (x, z) => [x / 12, z / 12]);
      if (side === 'e') geos.tactile.top(b.x1 - inset - tw, b.x1 - inset, b.z0 + m, b.z1 - m, CURB + 0.2, (x, z) => [x / 12, z / 12]);
    }
  }
  // Coin parking: asphalt with white stall lines.
  for (const pk of PARKINGS) {
    const onBlock = BLOCKS.some((b) => pk.x > b.x0 && pk.x < b.x1 && pk.z > b.z0 && pk.z < b.z1);
    const y = (onBlock ? CURB : 0) + 0.3;
    geos.asphalt.top(pk.x - pk.w / 2, pk.x + pk.w / 2, pk.z - pk.d / 2, pk.z + pk.d / 2, y, auv);
    const along = pk.axis === 'z' ? pk.w : pk.d;
    for (let t = 0; t <= along; t += 90) {
      if (pk.axis === 'z') geos.lines.top(pk.x - pk.w / 2 + t - 2, pk.x - pk.w / 2 + t + 2, pk.z - pk.d / 2 + 10, pk.z + pk.d / 2 - 20, y + 0.2, () => [0, 0]);
      else geos.lines.top(pk.x - pk.w / 2 + 10, pk.x + pk.w / 2 - 20, pk.z - pk.d / 2 + t - 2, pk.z - pk.d / 2 + t + 2, y + 0.2, () => [0, 0]);
    }
  }

  const tex = (t: THREE.Texture) => t;
  const lit = (k: FacadeKind) => ({ emissive: 0xffffff, emissiveMap: windowGlowTexture(k), emissiveIntensity: 0.45 });
  const shop = tex(shopAtlas()), sign = tex(signAtlas());
  const mats: Record<string, THREE.Material> = {
    // Dusk: windows light up (emissive maps of the lit panes).
    glass: std(0xffffff, { map: facadeTexture('glass'), vertexColors: true, roughness: 0.35, metalness: 0.25, ...lit('glass') }),
    concrete: std(0xffffff, { map: facadeTexture('concrete'), vertexColors: true, ...lit('concrete') }),
    tileA: std(0xffffff, { map: facadeTexture('tileA'), vertexColors: true, ...lit('tileA') }),
    tileB: std(0xffffff, { map: facadeTexture('tileB'), vertexColors: true, ...lit('tileB') }),
    apartment: std(0xffffff, { map: facadeTexture('apartment'), vertexColors: true, ...lit('apartment') }),
    house: std(0xffffff, { map: facadeTexture('house'), vertexColors: true, ...lit('house') }),
    shop: std(0xffffff, { map: shop, emissive: 0xffffff, emissiveMap: shop, emissiveIntensity: 0.42 }),
    roof: std(0xffffff, { map: roofTexture(), vertexColors: true, roughness: 0.95 }),
    roofTile: std(0xffffff, { map: roofTileTexture(), vertexColors: true, roughness: 0.8 }),
    sign: std(0xffffff, { map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.55 }),
    avenue: std(0xffffff, { map: roadTexture('avenue', 380), roughness: 0.95 }),
    street: std(0xffffff, { map: roadTexture('street', 240), roughness: 0.95 }),
    alley: std(0xffffff, { map: roadTexture('alley', 120), roughness: 0.95 }),
    asphalt: std(0xffffff, { map: asphaltTexture(), roughness: 0.95 }),
    zebra: std(0xe9e8e2, { roughness: 0.9 }),
    lines: std(0xe9e8e2, { roughness: 0.9 }),
    paver: std(0xffffff, { map: paverTexture(), roughness: 0.95 }),
    curb: std(0xb9b5ab, { roughness: 0.9 }),
    tactile: std(0xffffff, { map: tactileTexture(), roughness: 0.8 }),
  };
  for (const k of ['avenue', 'street', 'alley', 'asphalt']) {
    const m = mats[k] as THREE.MeshStandardMaterial;
    m.roughnessMap = (m.map!.userData.rough as THREE.Texture) ?? null;
    m.roughness = 1;
  }
  for (const k of ['glass', 'concrete', 'tileA', 'tileB', 'apartment', 'house', 'shop']) groundGrime(mats[k]);
  // After dark the windows, shops and signs carry the city.
  for (const k of ['glass', 'concrete', 'tileA', 'tileB', 'apartment', 'house']) glowAtNight(mats[k] as THREE.MeshStandardMaterial, 0.45, 0.75);
  glowAtNight(mats.shop as THREE.MeshStandardMaterial, 0.42, 0.7);
  glowAtNight(mats.sign as THREE.MeshStandardMaterial, 0.55, 0.95);
  for (const m of [mats.zebra, mats.lines, mats.tactile, mats.asphalt]) {
    (m as THREE.MeshStandardMaterial).polygonOffset = true;
    (m as THREE.MeshStandardMaterial).polygonOffsetFactor = -1;
    (m as THREE.MeshStandardMaterial).polygonOffsetUnits = -1;
  }
  for (const [k, g] of Object.entries(geos)) {
    const geo = g.build();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mats[k]);
    const flat = ['avenue', 'street', 'alley', 'asphalt', 'zebra', 'paver', 'tactile', 'lines'].includes(k);
    mesh.castShadow = !flat && k !== 'sign';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const add = (m: THREE.Object3D | null) => m && scene.add(m);
  // Rooftop plant.
  const plant = std(0xb3b0a8, { roughness: 0.9 });
  add(instanced(new THREE.BoxGeometry(1, 1, 1), plant, props.machine));
  add(instanced(new THREE.BoxGeometry(36, 30, 42), std(0xd8d6d0), props.ac));
  add(instanced(new THREE.CylinderGeometry(30, 30, 50, 12).translate(0, 0, 0), std(0x9fb7c4, { roughness: 0.6 }), props.tank));

  buildFurniture(scene);
  buildStreetProps(scene);
}

/**
 * Street-level grime on façades: a dark band of splash dirt and contact shadow just above
 * the pavement, fading out by ~2 m, plus faint rain streaks under the storeys. Shader only.
 */
function groundGrime(m: THREE.Material): void {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrimePos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGrimePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrimePos;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float gy = vGrimePos.y;
          float band = 1.0 - smoothstep(4.0, 55.0, gy);
          float streak = fract(sin(floor((vGrimePos.x + vGrimePos.z) * 0.09) * 91.7) * 4375.5);
          float drip = smoothstep(0.75, 1.0, streak) * (1.0 - fract(gy / 86.0)) * 0.12 * step(60.0, gy);
          diffuseColor.rgb *= 1.0 - band * 0.42 - drip;
        }`);
  };
  m.customProgramCacheKey = () => 'ground-grime';
}

/**
 * Trees close to the camera dissolve in a fine dot pattern (screen-door dither) so
 * a crown between the camera and the player never blocks the view. In the shader:
 * no extra objects, no sorting.
 */
export function nearFade<T extends THREE.Material>(m: T, near = 70, far = 210): T {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      {
        float camD = length(vViewPosition);
        float keep = clamp((camD - ${near.toFixed(1)}) / ${(far - near).toFixed(1)}, 0.0, 1.0);
        vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
        float th = (mod(cell.x * 2.0 + cell.y * 3.0, 4.0) + mod(cell.y, 2.0) * 0.5 + 0.25) / 4.5;
        if (keep < th) discard;
      }`);
  };
  m.customProgramCacheKey = () => 'near-fade';
  return m;
}

/** Poles and wires, street lights, signals, vending machines, parked cars and trees. */
function buildFurniture(scene: THREE.Scene): void {
  const add = (m: THREE.Object3D | null) => m && scene.add(m);
  const concrete = std(0xa9a69f), dark = std(0x4a4d52, { roughness: 0.6, metalness: 0.3 });

  // 電柱: concrete poles with a crossarm (across the wires) and the odd transformer.
  const poleM: THREE.Matrix4[] = [], armM: THREE.Matrix4[] = [], transM: THREE.Matrix4[] = [];
  const dirOf = POLES.map(() => 0);
  for (const [a, b] of WIRES) {
    const ang = Math.atan2(POLES[b].z - POLES[a].z, POLES[b].x - POLES[a].x);
    dirOf[a] = dirOf[b] = ang;
  }
  POLES.forEach((p, i) => {
    poleM.push(at(p.x, 130, p.z));
    armM.push(at(p.x, 236, p.z, -(dirOf[i] + Math.PI / 2)));
    if (i % 3 === 0) transM.push(at(p.x + 14, 190, p.z + 14));
  });
  add(instanced(new THREE.CylinderGeometry(4, 5.5, 260, 8), concrete, poleM));
  add(instanced(new THREE.BoxGeometry(80, 6, 6), concrete, armM));
  add(instanced(new THREE.CylinderGeometry(12, 12, 38, 10), std(0x8d918f), transM));
  // Wires: three on the crossarm plus a lower telecom cable, sagging between poles.
  const pts: number[] = [];
  for (const [a, b] of WIRES) {
    const A = POLES[a], B = POLES[b], ang = dirOf[a] + Math.PI / 2;
    for (const [off, y, sag] of [[-34, 236, 20], [0, 236, 22], [34, 236, 20], [0, 200, 14]] as const) {
      const ox = Math.cos(ang) * off, oz = Math.sin(ang) * off;
      const N = 8;
      for (let k = 0; k < N; k++) {
        for (const t of [k / N, (k + 1) / N]) pts.push(A.x + ox + (B.x - A.x) * t, y - sag * 4 * t * (1 - t), A.z + oz + (B.z - A.z) * t);
      }
    }
  }
  if (pts.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1b1b1d })));
  }

  // Street lights: pole, arm over the road, lamp head.
  const lpM: THREE.Matrix4[] = [], laM: THREE.Matrix4[] = [], lhM: THREE.Matrix4[] = [];
  for (const l of LIGHTS) {
    const dx = Math.cos(l.ang), dz = Math.sin(l.ang);
    lpM.push(at(l.x, 115, l.z));
    laM.push(at(l.x + dx * 30, 228, l.z + dz * 30, -l.ang));
    lhM.push(at(l.x + dx * 62, 223, l.z + dz * 62, -l.ang));
  }
  add(instanced(new THREE.CylinderGeometry(3, 4.5, 230, 8), dark, lpM));
  add(instanced(new THREE.BoxGeometry(62, 4, 4), dark, laM));
  add(instanced(new THREE.BoxGeometry(30, 7, 14), std(0xfff2cf, { emissive: 0xffe6b0, emissiveIntensity: 1.2 }), lhM, undefined, false));
  // Dusk: each lamp glows (a halo round the head) and throws a warm pool of light on the street.
  const glow = radialGlowTexture();
  const heads = new Float32Array(LIGHTS.length * 3);
  const pools: THREE.Matrix4[] = [];
  LIGHTS.forEach((l, i) => {
    const hx = l.x + Math.cos(l.ang) * 62, hz = l.z + Math.sin(l.ang) * 62;
    heads.set([hx, 216, hz], i * 3);
    pools.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(hx, 1.2, hz));
  });
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(heads, 3));
  const haloMat = new THREE.PointsMaterial({ map: glow, color: 0xffd9a0, size: 95, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  add(new THREE.Points(haloGeo, haloMat));
  NIGHT_GLOW.push({ set: (k) => { haloMat.size = 95 + 45 * k; haloMat.opacity = 0.8 + 0.2 * k; } });
  // The pool is the lamp's lit area in the rules (LAMP_R): at night, people in it are seen from afar.
  const poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(LAMP_R * 2, LAMP_R * 2),
    new THREE.MeshBasicMaterial({ map: glow, color: 0x8a6a3a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), pools.length);
  pools.forEach((m, i) => poolMesh.setMatrixAt(i, m));
  // Pools of lamp light read much stronger at night (they are where you can be seen).
  const poolDusk = new THREE.Color(0x8a6a3a), poolNight = new THREE.Color(0xd8a860);
  NIGHT_GLOW.push({ set: (k) => { (poolMesh.material as THREE.MeshBasicMaterial).color.copy(poolDusk).lerp(poolNight, k); } });
  poolMesh.renderOrder = 1;
  add(poolMesh);

  // Traffic signals: pole, arm, horizontal 3-lamp head (green lit).
  const face = document.createElement('canvas');
  face.width = 96; face.height = 32;
  const fg = face.getContext('2d')!;
  fg.fillStyle = '#2b2d30'; fg.fillRect(0, 0, 96, 32);
  [['#3cff9a', 16], ['#6b5a20', 48], ['#5a2020', 80]].forEach(([c, x]) => { fg.fillStyle = c as string; fg.beginPath(); fg.arc(x as number, 16, 11, 0, Math.PI * 2); fg.fill(); });
  const faceTex = new THREE.CanvasTexture(face);
  const spM: THREE.Matrix4[] = [], saM: THREE.Matrix4[] = [], shM: THREE.Matrix4[] = [];
  for (const s of SIGNALS) {
    const dx = Math.cos(s.ang), dz = Math.sin(s.ang);
    spM.push(at(s.x, 100, s.z));
    saM.push(at(s.x + dx * 60, 196, s.z + dz * 60, -s.ang));
    shM.push(at(s.x + dx * 110, 184, s.z + dz * 110, -s.ang));
  }
  add(instanced(new THREE.CylinderGeometry(4, 5, 200, 8), std(0x8a8d90), spM));
  add(instanced(new THREE.BoxGeometry(120, 4, 4), std(0x8a8d90), saM));
  add(instanced(new THREE.BoxGeometry(64, 22, 14), std(0xffffff, { map: faceTex, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.6 }), shM));

  // Vending machines, parked cars and trees come from the world primitives.
  const vend: THREE.Matrix4[][] = [[], []], cars: THREE.Matrix4[] = [], carCol: THREE.Color[] = [];
  const trunks: THREE.Matrix4[] = [], crowns: THREE.Matrix4[] = [], crownCol: THREE.Color[] = [];
  const rnd = prng(99);
  const BLDG = (WORLD as BoxPrim[]).filter((p) => p.mat === 'bldg' || (p.kind === 'box' && p.y1 > 150 && !p.noFloor && p.mat !== 'water'));
  const rot: Record<string, number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };
  const CAR_COLORS = [0xf2f2f0, 0xf2f2f0, 0x1c1d20, 0xa9adb3, 0x8f959c, 0x7a1f22, 0x243c6a, 0xe9d9b0, 0x3d5a3a];
  for (const p of WORLD) {
    const b = p as BoxPrim;
    if (p.mat === 'vending') vend[rnd() < 0.5 ? 0 : 1].push(at(b.x, 24, b.z, rot[b.group ?? 's']));
    else if (p.mat === 'car') {
      cars.push(at(b.x, 0, b.z, b.group === 'x' ? Math.PI / 2 : 0));
      carCol.push(new THREE.Color(pick(CAR_COLORS, rnd())));
    } else if (p.mat === 'tree') {
      // Rooted on whatever it stands on (street, lawn, hilltop); the crown top is y1.
      const base = groundAt(b.x, b.z, b.y1 - 40);
      const H = Math.min(b.y1 - base, 300);
      // Crowns never push into a building: shrink to the gap to the nearest wall.
      let r = H * 0.21;
      for (const w of BLDG) {
        const gap = Math.hypot(Math.max(Math.abs(b.x - w.x) - w.w / 2, 0), Math.max(Math.abs(b.z - w.z) - w.d / 2, 0));
        if (gap < r) r = Math.max(24, gap - 3);
      }
      trunks.push(at(b.x, base, b.z, 0, 1, b.y1 - r * 0.6 - base, 1));
      crowns.push(at(b.x, b.y1 - r * 1.05, b.z, rnd() * 6, r, r * 1.15, r));
      crownCol.push(new THREE.Color().setHSL(0.24 + rnd() * 0.08, 0.35 + rnd() * 0.2, 0.2 + rnd() * 0.1));
    }
  }
  const vt = vendingTexture();
  vend.forEach((ms, i) => {
    const t = vt.clone();
    t.repeat.set(0.5, 1);
    t.offset.set(i * 0.5, 0);
    t.needsUpdate = true;
    const side = std(i ? 0x2356a8 : 0xc9282d, { roughness: 0.5 });
    const front = std(0xffffff, { map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.45 });
    add(instanced(new THREE.BoxGeometry(54, 48, 20), [side, side, side, side, front, side], ms));
  });
  // Cars: body in the car's colour, a glassy cabin and dark wheels.
  const body = mergeBoxes([[46, 18, 116, 0, 15, 0], [40, 15, 60, 0, 31, -6]]);
  const glassBand = mergeBoxes([[41, 9, 50, 0, 32, -6], [38, 9, 1, 0, 32, 24.2], [38, 9, 1, 0, 32, -36.2]]);
  const lights = mergeBoxes([[10, 5, 1, -15, 19, 58.2], [10, 5, 1, 15, 19, 58.2]]);
  const tail = mergeBoxes([[10, 5, 1, -15, 19, -58.2], [10, 5, 1, 15, 19, -58.2]]);
  const wheels = mergeWheels();
  add(instanced(body, std(0xffffff, { roughness: 0.3, metalness: 0.35 }), cars, carCol));
  add(instanced(glassBand, std(0x2c3945, { roughness: 0.1, metalness: 0.5 }), cars, undefined, false));
  add(instanced(lights, std(0xf4f2e8, { emissive: 0xfff6d8, emissiveIntensity: 0.4 }), cars, undefined, false));
  add(instanced(tail, std(0xb0201c, { emissive: 0x801010, emissiveIntensity: 0.4 }), cars, undefined, false));
  add(instanced(wheels, std(0x151515), cars, undefined, false));
  add(instanced(new THREE.CylinderGeometry(5, 8, 1, 7).translate(0, 0.5, 0), nearFade(std(0x4b3a2a)), trunks));
  const crown = new THREE.IcosahedronGeometry(1, 1);
  add(instanced(crown, nearFade(std(0xffffff, { flatShading: true, roughness: 1 })), crowns, crownCol));
}

/** Several boxes [w, h, d, x, y, z] as one geometry. */
function mergeBoxes(list: [number, number, number, number, number, number][]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [];
  for (const [w, h, d, x, y, z] of list) {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
    pos.push(...(g.attributes.position.array as Float32Array));
    nrm.push(...(g.attributes.normal.array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

function mergeWheels(): THREE.BufferGeometry {
  const parts: number[] = [], norms: number[] = [];
  for (const [x, z] of [[-21, -38], [21, -38], [-21, 38], [21, 38]]) {
    const w = new THREE.CylinderGeometry(9, 9, 7, 10).rotateZ(Math.PI / 2).translate(x, 9, z).toNonIndexed();
    parts.push(...(w.attributes.position.array as Float32Array));
    norms.push(...(w.attributes.normal.array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  return g;
}
