import type { Point } from './nations';

/**
 * v7.5 battlefield: Tokyo inside the JR Yamanote loop, at human scale.
 *
 * Two scales are used on purpose:
 * - Street level is life-size relative to the characters (a character is
 *   ~45 units ≈ 1.7 m, so 1 m ≈ 26 units): storeys, road widths, sidewalks,
 *   poles, vending machines and cars all have their real proportions.
 * - Geography is compressed: stations and landmarks come from real latitude /
 *   longitude at 0.8 units per metre, so the loop keeps its true shape and
 *   everything sits in the right place, but there are fewer blocks between
 *   districts (the real loop would take an hour to cross on foot).
 * Very tall towers are compressed above 100 m (see `realHeight`).
 *
 * The world is built from two kinds of solid primitive:
 * - box:  an axis-aligned block from y0 to y1. Its top is a floor you can stand on.
 * - ramp: a block whose top rises linearly along one axis (stairs and slopes).
 * Everything that walks, sees or aims asks these primitives (sim/systems/world.ts).
 */

export interface Circle extends Point {
  r: number;
}

export type Material =
  | 'stone' | 'plaster' | 'wood' | 'roof' | 'earth' | 'water' | 'hedge'
  | 'concrete' | 'glass' | 'brick' | 'steel' | 'metal' | 'tree'
  | 'bldg' | 'sidewalk' | 'car' | 'vending' | 'pole';

interface PrimBase {
  x: number;
  z: number;
  w: number;
  d: number;
  y0: number;
  mat: Material;
  /** Line of sight passes through (water). Default: blocks. */
  seeThrough?: boolean;
  /** The top is not a floor (water, rooftops nobody can reach, cars). Default: walkable. */
  noFloor?: boolean;
  /** Group id for rendering related parts together (e.g. one landmark). */
  group?: string;
}

export interface BoxPrim extends PrimBase {
  kind: 'box';
  y1: number;
}

export interface RampPrim extends PrimBase {
  kind: 'ramp';
  hLow: number;
  hHigh: number;
  axis: 'x' | 'z';
  dir: 1 | -1;
  style: 'stairs' | 'slope';
}

export type Prim = BoxPrim | RampPrim;

// ---------------------------------------------------------------- scales

/** Units per metre at street level (people, storeys, streets, street furniture). */
export const M = 26;
/** Ground-floor height (4.2 m: shops and lobbies) and upper storeys (3.3 m). */
export const GROUND_FLOOR = Math.round(4.2 * M);
export const STOREY = Math.round(3.3 * M);
export const floorsToHeight = (n: number) => GROUND_FLOOR + (n - 1) * STOREY;
/** A real height in metres → game units; towers are compressed above 100 m. */
export function realHeight(m: number): number {
  return Math.round((m <= 100 ? m : 100 + (m - 100) * 0.4) * M);
}
/** Floor of second storeys, roof terraces and footbridge-like decks you can reach (≈3.5 m). */
export const UPPER = 90;
const SLAB = 12;
/** Kerb height of the sidewalks. */
export const CURB = 4;

// ---------------------------------------------------------------- geography

const LAT0 = 35.68, LON0 = 139.74;
/** Geographic units per metre (distances between places are compressed). */
export const MAP_SCALE = 1.0;
const KX = 90_200 * MAP_SCALE; // units per degree of longitude at 35.7°N
const KZ = 111_000 * MAP_SCALE; // units per degree of latitude
/** v7.4 layout coordinates (0.45 units/m) → this map. */
const sc = (v: number) => Math.round((v * MAP_SCALE) / 0.45);
/** Positions laid out at 0.8 units/m → this map. */
const k8 = (v: number) => Math.round((v * MAP_SCALE) / 0.8);

/** Real-world coordinate → game position (x east, z south). */
export function geo(lat: number, lon: number): Point {
  return { x: Math.round((lon - LON0) * KX), z: Math.round(-(lat - LAT0) * KZ) };
}

/** Yamanote line stations, clockwise from Tokyo. */
export const STATIONS: readonly (Point & { name: string })[] = ([
  ['東京', 35.6812, 139.7671], ['有楽町', 35.6750, 139.7630], ['新橋', 35.6663, 139.7583], ['浜松町', 35.6555, 139.7571],
  ['田町', 35.6457, 139.7476], ['高輪ゲートウェイ', 35.6355, 139.7407], ['品川', 35.6285, 139.7388], ['大崎', 35.6197, 139.7286],
  ['五反田', 35.6262, 139.7236], ['目黒', 35.6340, 139.7157], ['恵比寿', 35.6467, 139.7101], ['渋谷', 35.6580, 139.7016],
  ['原宿', 35.6702, 139.7027], ['代々木', 35.6830, 139.7020], ['新宿', 35.6896, 139.7006], ['新大久保', 35.7013, 139.7000],
  ['高田馬場', 35.7126, 139.7038], ['目白', 35.7212, 139.7066], ['池袋', 35.7295, 139.7109], ['大塚', 35.7317, 139.7286],
  ['巣鴨', 35.7334, 139.7393], ['駒込', 35.7365, 139.7470], ['田端', 35.7381, 139.7608], ['西日暮里', 35.7320, 139.7667],
  ['日暮里', 35.7281, 139.7707], ['鶯谷', 35.7210, 139.7780], ['上野', 35.7138, 139.7773], ['御徒町', 35.7075, 139.7746],
  ['秋葉原', 35.6984, 139.7731], ['神田', 35.6918, 139.7709],
] as const).map(([name, lat, lon]) => ({ name, ...geo(lat, lon) }));

/** The track itself (polygon through the stations). Movement stays inside it. */
export const LOOP: readonly Point[] = STATIONS.map(({ x, z }) => ({ x, z }));
/** Width of the railway corridor inside the polygon (half the viaduct + fence). */
export const TRACK_MARGIN = 170;
/** The fence along the tracks: characters cannot get closer to the track line than this. */
export const WALK_EDGE = 150;
/** Viaduct deck height and width (≈7.5 m high, double track). */
export const VIADUCT = { h: 200, w: 260 };

function segDist(px: number, pz: number, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

function insidePolygon(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = LOOP.length - 1; i < LOOP.length; j = i++) {
    const a = LOOP[i], b = LOOP[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance to the tracks, positive inside the loop and negative outside. */
export function loopSignedDist(x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < LOOP.length; i++) d = Math.min(d, segDist(x, z, LOOP[i], LOOP[(i + 1) % LOOP.length]));
  return insidePolygon(x, z) ? d : -d;
}

/**
 * Signed distance to the tracks sampled on a coarse grid (inside > 0), so the
 * common case (far from the edge) needs no polygon test. Cell centres are at
 * most LOOP_SLACK from any point in the cell.
 */
const LOOP_CELL = 20, LOOP_SLACK = 15;
const LX0 = Math.min(...LOOP.map((p) => p.x)) - LOOP_CELL, LZ0 = Math.min(...LOOP.map((p) => p.z)) - LOOP_CELL;
const LCOLS = Math.ceil((Math.max(...LOOP.map((p) => p.x)) - LX0) / LOOP_CELL) + 2;
const LROWS = Math.ceil((Math.max(...LOOP.map((p) => p.z)) - LZ0) / LOOP_CELL) + 2;
const loopDist = new Float32Array(LCOLS * LROWS);
for (let r = 0; r < LROWS; r++) {
  for (let c = 0; c < LCOLS; c++) loopDist[r * LCOLS + c] = loopSignedDist(LX0 + (c + 0.5) * LOOP_CELL, LZ0 + (r + 0.5) * LOOP_CELL);
}

/** Inside the Yamanote loop and at least `margin` from the tracks. */
export function insideLoop(x: number, z: number, margin = TRACK_MARGIN): boolean {
  const c = Math.floor((x - LX0) / LOOP_CELL), r = Math.floor((z - LZ0) / LOOP_CELL);
  if (c < 0 || r < 0 || c >= LCOLS || r >= LROWS) return false;
  const d = loopDist[r * LCOLS + c];
  if (d - LOOP_SLACK >= margin) return true;
  if (d + LOOP_SLACK < margin) return false;
  return loopSignedDist(x, z) >= margin;
}

const xs = LOOP.map((p) => p.x), zs = LOOP.map((p) => p.z);
/** Bounding box of the loop (the nav grid and minimap cover this). */
export const BOUNDS = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
/** Ground and city: the loop plus the city beyond the tracks (visual only). */
export const GROUND = { w: BOUNDS.maxX - BOUNDS.minX + 4000, d: BOUNDS.maxZ - BOUNDS.minZ + 4000, cx: (BOUNDS.minX + BOUNDS.maxX) / 2, cz: (BOUNDS.minZ + BOUNDS.maxZ) / 2 };

// ---------------------------------------------------------------- key places

/** 管制塔: a radio mast in 日比谷公園, the point about equally far from all three bases. */
export const TOWER: Circle = { ...geo(35.6736, 139.7564), r: 80 };
/** 日比谷公園 around the mast. */
export const PLAZA: Circle = { ...TOWER, r: 300 };
/** 皇居 (Imperial Palace) island inside its moat; the stone walls are 4 m high. */
export const PALACE = { x: sc(480), z: sc(-300), w: 600, d: 760, moat: 100, top: 110 };
/** 皇居前広場: the big open gravel plaza between the moat and Tokyo Station. */
export const PALACE_PLAZA = { x: PALACE.x + PALACE.w / 2 + PALACE.moat + 230, z: PALACE.z + 60, w: 380, d: 700 };

const prims: Prim[] = [];
const box = (x: number, z: number, w: number, d: number, y1: number, mat: Material, extra: Partial<BoxPrim> = {}) =>
  prims.push({ kind: 'box', x, z, w, d, y0: 0, y1, mat, ...extra });
const ramp = (
  x: number, z: number, w: number, d: number, axis: 'x' | 'z', dir: 1 | -1, hLow: number, hHigh: number,
  style: 'stairs' | 'slope', mat: Material = style === 'stairs' ? 'wood' : 'earth', group?: string,
) => prims.push({ kind: 'ramp', x, z, w, d, y0: 0, axis, dir, hLow, hHigh, style, mat, group });
const slab = (x: number, z: number, w: number, d: number, top: number, mat: Material, group?: string) =>
  box(x, z, w, d, top, mat, { y0: top - SLAB, group });
const water = (x: number, z: number, w: number, d: number, group: string) =>
  prims.push({ kind: 'box', x, z, w, d, y0: -20, y1: 16, mat: 'water', seeThrough: true, noFloor: true, group });
/** A tree: trunk as the solid, the crown is drawn by the renderer (height = crown top). */
const tree = (x: number, z: number, h = 240) => box(x, z, 12, 12, h, 'tree', { noFloor: true });

/** Areas the city filler must leave open (landmarks, parks, water, bases, bridges). */
interface Rect { x0: number; z0: number; x1: number; z1: number }
const keepOut: Rect[] = [];
const reserve = (x: number, z: number, w: number, d: number, pad = 40) =>
  keepOut.push({ x0: x - w / 2 - pad, z0: z - d / 2 - pad, x1: x + w / 2 + pad, z1: z + d / 2 + pad });
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const reserved = (r: Rect) => keepOut.some((k) => overlaps(k, r));

type Side = 'n' | 's' | 'e' | 'w';

/**
 * A walled building. Ground-floor walls stop under the upper slab; doors are
 * full-height gaps. `upper` adds a walkable second floor / roof terrace with
 * parapets. `hole` leaves a stairwell open. `floorY` is the upper floor height.
 */
function building(
  id: string, cx: number, cz: number, w: number, d: number,
  doors: { side: Side; at: number; width: number }[],
  upper: { hole?: { x0: number; x1: number; z0: number; z1: number } } | null,
  mat: Material = 'plaster', floorY = UPPER,
): void {
  const T = 14, H = floorY - SLAB;
  const wallSide = (side: Side, y0: number, y1: number, gaps: { at: number; width: number }[]) => {
    const horizontal = side === 'n' || side === 's';
    const len = horizontal ? w : d;
    const fixed = side === 'n' ? cz - d / 2 + T / 2 : side === 's' ? cz + d / 2 - T / 2 : side === 'w' ? cx - w / 2 + T / 2 : cx + w / 2 - T / 2;
    const start = horizontal ? cx - w / 2 : cz - d / 2;
    const cuts = gaps.map((g) => [g.at - g.width / 2, g.at + g.width / 2]).sort((a, b) => a[0] - b[0]);
    let a = start;
    for (const [g0, g1] of [...cuts.map(([p, q]) => [start + len / 2 + p, start + len / 2 + q]), [start + len, start + len]]) {
      if (g0 - a > 1) {
        const mid = (a + g0) / 2, span = g0 - a;
        if (horizontal) box(mid, fixed, span, T, y1, mat, { y0, group: id });
        else box(fixed, mid, T, span, y1, mat, { y0, group: id });
      }
      a = Math.max(a, g1);
    }
  };
  for (const side of ['n', 's', 'e', 'w'] as Side[]) wallSide(side, 0, H, doors.filter((dr) => dr.side === side));
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const h = upper?.hole;
  if (!h) slab(cx, cz, w, d, floorY, 'concrete', id);
  else {
    const rect = (ax: number, bx: number, az: number, bz: number) => {
      if (bx - ax > 1 && bz - az > 1) slab((ax + bx) / 2, (az + bz) / 2, bx - ax, bz - az, floorY, 'concrete', id);
    };
    rect(x0, x1, z0, h.z0);
    rect(x0, x1, h.z1, z1);
    rect(x0, h.x0, h.z0, h.z1);
    rect(h.x1, x1, h.z0, h.z1);
  }
  if (upper) for (const side of ['n', 's', 'e', 'w'] as Side[]) wallSide(side, floorY, floorY + 30, []);
  reserve(cx, cz, w, d, 60);
}

/**
 * Two-storey 雑居ビル with an interior staircase climbing west → east to a
 * roof terrace. Returns the stair foot, the terrace and a ground-floor spot.
 */
function walkUp(id: string, cx: number, cz: number, mat: Material = 'concrete') {
  const w = 360, d = 260;
  building(id, cx, cz, w, d,
    [{ side: 's', at: 60, width: 110 }, { side: 'e', at: 40, width: 110 }, { side: 'w', at: 30, width: 100 }],
    { hole: { x0: cx - 180, x1: cx + 120, z0: cz - 130, z1: cz - 30 } }, mat);
  // A landing at the foot (west) and the terrace at the top (east).
  ramp(cx, cz - 80, 240, 100, 'x', 1, 0, UPPER, 'stairs', 'wood', id);
  return { stairsFoot: { x: cx - 112, z: cz - 80 }, terrace: { x: cx + 145, z: cz - 80 }, underFloor: { x: cx + 60, z: cz + 70 } };
}

// ---------------------------------------------------------------- 皇居 (Imperial Palace)
{
  const P = PALACE, m = P.moat;
  // Stone-walled island with gardens; its top is a walkable plateau.
  box(P.x, P.z, P.w, P.d, P.top, 'earth', { group: 'palace' });
  const ox0 = P.x - P.w / 2 - m, ox1 = P.x + P.w / 2 + m, oz0 = P.z - P.d / 2 - m, oz1 = P.z + P.d / 2 + m;
  water(P.x, oz0 + m / 2, P.w + 2 * m, m, 'moat');
  water(P.x, oz1 - m / 2, P.w + 2 * m, m, 'moat');
  water(ox0 + m / 2, P.z, m, P.d, 'moat');
  water(ox1 - m / 2, P.z, m, P.d, 'moat');
  // Gates: 大手門 (east), 桜田門 (south), 北桔橋門 (north) — stone ramps over the moat onto the walls.
  const L = m + 220;
  ramp(ox1 - m + L / 2, P.z - 160, L, 110, 'x', -1, 0, P.top, 'slope', 'stone', 'palace');
  ramp(P.x + 90, oz1 - m + L / 2, 110, L, 'z', -1, 0, P.top, 'slope', 'stone', 'palace');
  ramp(P.x - 120, oz0 + m - L / 2, 110, L, 'z', 1, 0, P.top, 'slope', 'stone', 'palace');
  // 宮殿 (low palace hall) and the 天守台 (keep base), reached by stone stairs.
  box(P.x - 40, P.z + 140, 360, 150, P.top + 190, 'plaster', { y0: P.top, group: 'palaceHall' });
  box(P.x - 80, P.z - 250, 200, 150, P.top + 90, 'stone', { y0: P.top, group: 'keep' });
  ramp(P.x - 80, P.z - 250 + 75 + 110, 100, 220, 'z', -1, P.top, P.top + 90, 'stairs', 'stone', 'keep');
  for (const [tx, tz] of [[140, -80], [170, 300], [-220, -30], [60, -330], [-230, 300], [200, 60]]) tree(P.x + tx, P.z + tz, P.top + 280);
  reserve(P.x, P.z, P.w + 2 * m, P.d + 2 * m, 30);
  reserve(P.x, oz0 - L / 2 + m, 110, L, 30);
  reserve(P.x + 90, oz1 + L / 2 - m, 110, L, 30);
  reserve(PALACE_PLAZA.x, PALACE_PLAZA.z, PALACE_PLAZA.w, PALACE_PLAZA.d, 0);
  // Black pines on the plaza lawns.
  for (let i = 0; i < 6; i++) tree(PALACE_PLAZA.x + (i % 2 ? 150 : -150), PALACE_PLAZA.z - 280 + i * 110, 200);
}

// ---------------------------------------------------------------- landmarks

/** 東京駅 丸の内駅舎: long red-brick station building with two domes. */
const TOKYO_ST = { x: STATIONS[0].x - 180, z: STATIONS[0].z - 60, w: 150, d: 900, h: 260 };
box(TOKYO_ST.x, TOKYO_ST.z, TOKYO_ST.w, TOKYO_ST.d, TOKYO_ST.h, 'brick', { group: 'tokyoStation' });
reserve(TOKYO_ST.x, TOKYO_ST.z, TOKYO_ST.w, TOKYO_ST.d, 40);
/** 丸の内 / 大手町 office towers (about 200 m). */
for (const [x, z, h] of [[k8(1600), k8(-1100), 200], [k8(1880), k8(-1300), 180], [k8(1620), k8(-1450), 160]] as const) {
  box(x, z, 330, 330, realHeight(h), 'glass', { group: 'tower' });
  reserve(x, z, 330, 330, 20);
}
/** 国会議事堂: wide granite building with its central stepped tower (65 m). */
const DIET = { ...geo(35.6759, 139.7449), w: 560, d: 200, h: 520 };
{
  box(DIET.x, DIET.z, DIET.w, DIET.d, DIET.h, 'stone', { group: 'diet' });
  box(DIET.x, DIET.z, 160, 160, realHeight(55), 'stone', { y0: DIET.h, group: 'dietTower' });
  reserve(DIET.x, DIET.z, 620, 560, 0);
}
/** 霞が関 ministries. */
for (const z of [k8(488), k8(693)]) {
  box(k8(770), z, 200, 180, realHeight(40), 'concrete', { group: 'office' });
  reserve(k8(770), z, 200, 180, 20);
}
/** 日比谷公園 with the radio mast (管制塔) in the middle. */
export const MAST_H = 600;
box(TOWER.x, TOWER.z, 60, 60, MAST_H, 'steel', { group: 'radioTower' });
reserve(TOWER.x, TOWER.z, PLAZA.r * 2, PLAZA.r * 2, 20);
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2 + 0.3, r = PLAZA.r - 50;
  tree(TOWER.x + Math.cos(a) * r, TOWER.z + Math.sin(a) * r, 230 + (i % 3) * 40);
}

/** 東京タワー: four legs over the FootTown building, whose roof terrace is reached by an outdoor stair. */
const TOKYO_TOWER = geo(35.6586, 139.7454);
export const TOKYO_TOWER_H = realHeight(333);
const FOOTTOWN = { w: 300, d: 260, h: 180 };
{
  const t = TOKYO_TOWER, F = FOOTTOWN;
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(t.x + ox * 200, t.z + oz * 200, 50, 50, 1100, 'steel', { group: 'tokyoTowerLeg' });
  box(t.x, t.z, F.w, F.d, F.h, 'concrete', { group: 'footTown' });
  // Terrace parapets; the south one has a gap where the stair arrives.
  box(t.x, t.z - F.d / 2 + 5, F.w, 10, F.h + 30, 'metal', { y0: F.h });
  box(t.x - F.w / 2 + 5, t.z, 10, F.d, F.h + 30, 'metal', { y0: F.h });
  box(t.x + F.w / 2 + -5, t.z, 10, F.d, F.h + 30, 'metal', { y0: F.h });
  box(t.x - 95, t.z + F.d / 2 - 5, 110, 10, F.h + 30, 'metal', { y0: F.h });
  box(t.x + 95, t.z + F.d / 2 - 5, 110, 10, F.h + 30, 'metal', { y0: F.h });
  ramp(t.x, t.z + F.d / 2 + 180, 70, 360, 'z', -1, 0, F.h, 'stairs', 'metal', 'tokyoTower');
  // The tower above the legs (unreachable; the renderer draws the lattice).
  box(t.x, t.z, 90, 90, TOKYO_TOWER_H, 'steel', { y0: 700, group: 'tokyoTowerSpire' });
  reserve(t.x, t.z + 170, 560, 820, 40);
}
/** 増上寺 (temple east of Tokyo Tower). */
box(TOKYO_TOWER.x + 520, TOKYO_TOWER.z + 60, 360, 260, 340, 'wood', { group: 'temple' });
reserve(TOKYO_TOWER.x + 520, TOKYO_TOWER.z + 60, 360, 260, 40);
/** 愛宕山: a real hill with the steep 出世の石段 on its east side and a slope on the west. */
const ATAGO = { ...geo(35.6645, 139.7493), w: 520, d: 440, top: 130 };
{
  const A = ATAGO;
  box(A.x, A.z, A.w, A.d, A.top, 'earth', { group: 'hill' });
  ramp(A.x + A.w / 2 + 110, A.z, 220, 100, 'x', -1, 0, A.top, 'stairs', 'stone', 'hill');
  ramp(A.x - A.w / 2 - 240, A.z + 60, 480, 160, 'x', 1, 0, A.top, 'slope', 'earth', 'hill');
  tree(A.x - 120, A.z - 120, A.top + 260);
  tree(A.x + 140, A.z + 130, A.top + 240);
  tree(A.x + 150, A.z - 140, A.top + 220);
  reserve(A.x - 130, A.z, A.w + 720, A.d, 40);
}
/** 六本木ヒルズ 森タワー and 東京ミッドタウン. */
for (const [lat, lon, h, sz] of [[35.6604, 139.7292, 238, 420], [35.6655, 139.7310, 248, 380]] as const) {
  const p = geo(lat, lon);
  box(p.x, p.z, sz, sz, realHeight(h), 'glass', { group: 'tower' });
  reserve(p.x, p.z, sz + 120, sz + 120, 20);
}
/** 迎賓館 (State Guest House). */
{
  const p = geo(35.6803, 139.7286);
  box(p.x, p.z, 600, 220, 420, 'stone', { group: 'palaceHall' });
  reserve(p.x, p.z + 120, 700, 480, 20);
}
/** 国立競技場: stands you can climb (stairs from the field) around the pitch. */
const STADIUM = { ...geo(35.6778, 139.7145), W: 1000, D: 850, T: 160, H: 260 };
{
  const s = { ...STADIUM, z: STADIUM.z + 60 }, { W, D, T, H } = s;
  box(s.x, s.z - D / 2 + T / 2, W, T, H, 'wood', { group: 'stadium' }); // north stand
  box(s.x - W / 2 + T / 2, s.z, T, D - 2 * T, H, 'wood', { group: 'stadium' });
  box(s.x + W / 2 - T / 2, s.z, T, D - 2 * T, H, 'wood', { group: 'stadium' });
  // South stand split by the main gate.
  box(s.x - 290, s.z + D / 2 - T / 2, W / 2 - 80, T, H, 'wood', { group: 'stadium' });
  box(s.x + 290, s.z + D / 2 - T / 2, W / 2 - 80, T, H, 'wood', { group: 'stadium' });
  ramp(s.x - 150, s.z - D / 2 + T + 260, 100, 520, 'z', -1, 0, H, 'stairs', 'concrete', 'stadium');
  reserve(s.x, s.z, W, D, 40);
}
/** 新宿御苑: lawns, a pond and trees. */
const GYOEN = { ...geo(35.6852, 139.7101), z: geo(35.6852, 139.7101).z + k8(82), w: 600, d: 360 };
{
  water(GYOEN.x + 80, GYOEN.z + 20, 260, 120, 'pond');
  for (let i = 0; i < 8; i++) tree(GYOEN.x - 250 + (i % 4) * 90 + (i > 3 ? 360 : 0), GYOEN.z - 130 + (i % 2) * 250, 220 + (i % 3) * 50);
  reserve(GYOEN.x, GYOEN.z, GYOEN.w, GYOEN.d, 20);
}
/** 渋谷ヒカリエ, 恵比寿ガーデンプレイス and 池袋サンシャイン60. */
for (const [x, z, h, sz] of [[k8(-2300), k8(1850), 183, 300], [geo(35.6425, 139.7137).x, geo(35.6425, 139.7137).z, 167, 300], [k8(-1523), k8(-4100), 240, 360]] as const) {
  box(x, z, sz, sz, realHeight(h), 'glass', { group: 'tower' });
  reserve(x, z, sz + 80, sz + 80, 20);
}
/** 東京ドーム. */
const DOME = { ...geo(35.7056, 139.7519), z: k8(-2450), r: 320 };
box(DOME.x, DOME.z, 2 * DOME.r, 2 * DOME.r, 300, 'concrete', { group: 'dome' });
reserve(DOME.x, DOME.z, 2 * DOME.r, 2 * DOME.r, 40);
/** 六義園 (garden with a pond). */
const RIKUGIEN = { ...geo(35.7321, 139.7465), z: k8(-4550) };
{
  water(RIKUGIEN.x, RIKUGIEN.z, 260, 150, 'pond');
  for (let i = 0; i < 6; i++) tree(RIKUGIEN.x - 220 + i * 90, RIKUGIEN.z + (i % 2 ? 150 : -150), 230);
  reserve(RIKUGIEN.x, RIKUGIEN.z, 520, 400, 20);
}

// ---------------------------------------------------------------- 上野 (moon base area)
/** 上野の山 (Ueno hill, park on top): plateau with a slope from the west and stone stairs from the south. */
export const UENO_HILL = { x: k8(2200), z: k8(-3271), w: 560, d: 560, top: 130 };
const UENO_SLOPE = { x: UENO_HILL.x - UENO_HILL.w / 2 - 210, z: UENO_HILL.z + 120, len: 420 };
const UENO_STAIRS = { x: UENO_HILL.x + 150, z: UENO_HILL.z + UENO_HILL.d / 2 + 110, len: 220 };
{
  const h = UENO_HILL;
  box(h.x, h.z, h.w, h.d, h.top, 'earth', { group: 'hill' });
  ramp(UENO_SLOPE.x, UENO_SLOPE.z, UENO_SLOPE.len, 200, 'x', 1, 0, h.top, 'slope', 'earth', 'hill');
  ramp(UENO_STAIRS.x, UENO_STAIRS.z, 120, UENO_STAIRS.len, 'z', -1, 0, h.top, 'stairs', 'stone', 'hill');
  box(h.x - 80, h.z - 150, 340, 150, h.top + 300, 'stone', { y0: h.top, group: 'museum' }); // 国立博物館
  for (const [tx, tz] of [[-200, 60], [-40, 120], [120, -40], [200, 180], [-160, 210]]) tree(h.x + tx, h.z + tz, h.top + 250);
  reserve(h.x, h.z, h.w, h.d, 30);
  reserve(UENO_SLOPE.x, UENO_SLOPE.z, UENO_SLOPE.len, 200, 60);
  reserve(UENO_STAIRS.x, UENO_STAIRS.z, 120, UENO_STAIRS.len, 60);
  water(k8(1700), k8(-2750), 460, 340, 'pond'); // 不忍池
  reserve(k8(1700), k8(-2750), 460, 340, 60);
}

// ---------------------------------------------------------------- 神田川 (Kanda River) and its bridges
/** River course (x, z) from 高田馬場 to 秋葉原. */
export const KANDA: readonly Point[] = [
  geo(35.7126, 139.7038), geo(35.7101, 139.7215), geo(35.7075, 139.7327), geo(35.7021, 139.7450),
  geo(35.7020, 139.7535), geo(35.6997, 139.7650), geo(35.6986, 139.7728),
];
export const RIVER_WIDTH = 150;
/** Bridges: 高田橋, 早稲田, 江戸川橋, 飯田橋, 水道橋, 聖橋 (arched), 万世橋. */
const BRIDGE_X = [-1330, -760, -300, 180, 560, 1000, 1290].map(sc);
const HIJIRI = BRIDGE_X[5];
const riverZAt = (x: number) => {
  for (let i = 0; i < KANDA.length - 1; i++) {
    const a = KANDA[i], b = KANDA[i + 1];
    if (x >= a.x && x <= b.x) return a.z + ((b.z - a.z) * (x - a.x)) / (b.x - a.x);
  }
  return KANDA[KANDA.length - 1].z;
};
{
  // Collision: overlapping square water tiles along the course (the renderer draws a smooth strip).
  for (let i = 0; i < KANDA.length - 1; i++) {
    const a = KANDA[i], b = KANDA[i + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 60);
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
      if (!insideLoop(x, z, 0)) continue;
      water(x, z, RIVER_WIDTH, RIVER_WIDTH, 'river');
      keepOut.push({ x0: x - 150, z0: z - 150, x1: x + 150, z1: z + 150 });
    }
  }
  for (const bx of BRIDGE_X) {
    const z = riverZAt(bx);
    if (!insideLoop(bx, z - 260, 60) || !insideLoop(bx, z + 260, 60)) continue;
    reserve(bx, z, 260, 520, 60); // clear approaches on both banks
    if (bx === HIJIRI) {
      // 聖橋: arched stone bridge.
      ramp(bx, z - 200, 240, 200, 'z', 1, 0, 60, 'slope', 'stone', 'bridge');
      box(bx, z, 240, 200, 60, 'stone', { y0: 40, group: 'bridge' });
      ramp(bx, z + 200, 240, 200, 'z', -1, 0, 60, 'slope', 'stone', 'bridge');
    } else {
      const L = RIVER_WIDTH + 200;
      box(bx, z, 260, L, 8, 'stone', { group: 'bridge' });
      box(bx - 125, z, 10, L, 38, 'stone', { y0: 8, group: 'bridge' }); // railings
      box(bx + 125, z, 10, L, 38, 'stone', { y0: 8, group: 'bridge' });
    }
  }
}

// ---------------------------------------------------------------- 首都高 (elevated expressways: high routes)
/** Deck height of the Shuto expressway (≈11 m). */
export const EXPRESSWAY_H = 280;
const EXPRESSWAY_W = 300, EXPRESSWAY_RAMP = 1000;
const noFootbridge: Rect[] = [];
/** A walkable elevated deck on pillars with an on-ramp at each end and parapets. */
function expressway(axis: 'x' | 'z', fixed: number, from: number, to: number): void {
  const top = EXPRESSWAY_H, W = EXPRESSWAY_W, R = EXPRESSWAY_RAMP, len = to - from, mid = (from + to) / 2;
  const at = (along: number, across: number, a: number, b: number) => (axis === 'z' ? { x: across, z: along, w: b, d: a } : { x: along, z: across, w: a, d: b });
  const put = (along: number, across: number, a: number, b: number, y1: number, mat: Material, y0 = 0) => {
    const r = at(along, across, a, b);
    box(r.x, r.z, r.w, r.d, y1, mat, { y0, group: 'expressway' });
  };
  put(mid, fixed, len, W, top, 'concrete', top - SLAB * 2);
  put(mid, fixed - W / 2 + 6, len, 12, top + 36, 'concrete', top);
  put(mid, fixed + W / 2 - 6, len, 12, top + 36, 'concrete', top);
  for (let p = from + 60; p < to - 30; p += 700) put(p, fixed, 70, 90, top - SLAB * 2, 'concrete');
  const r1 = at(from - R / 2, fixed, R, W), r2 = at(to + R / 2, fixed, R, W);
  const all = at(mid, fixed, len + 2 * R, W + 200);
  noFootbridge.push({ x0: all.x - all.w / 2, x1: all.x + all.w / 2, z0: all.z - all.d / 2, z1: all.z + all.d / 2 });
  ramp(r1.x, r1.z, r1.w, r1.d, axis, 1, 0, top, 'slope', 'concrete', 'expressway');
  ramp(r2.x, r2.z, r2.w, r2.d, axis, -1, 0, top, 'slope', 'concrete', 'expressway');
}
const EXPRESS_C = { x: sc(-150), from: sc(-260), to: sc(640) };
expressway('z', EXPRESS_C.x, EXPRESS_C.from, EXPRESS_C.to); // 都心環状線 (赤坂〜霞が関)
const EXPRESS_5 = { z: sc(-2170), from: sc(-760), to: sc(60) };
expressway('x', EXPRESS_5.z, EXPRESS_5.from, EXPRESS_5.to); // 5号線 (池袋)

// ---------------------------------------------------------------- walk-up buildings (2F / rooftop) and the arcade
/** 歌舞伎町 雑居ビル and a 高輪 office with roof terraces. */
const WALKUP_KABUKI = walkUp('walkupK', sc(-1260), sc(-960));
walkUp('walkupT', sc(-40), sc(1960));
/** アメ横 style arcade you can walk straight through (west / east doors, 7 m roof). */
export const ARCADE = { x: k8(1600), z: k8(-2350), w: 700, d: 220 };
building('arcade', ARCADE.x, ARCADE.z, ARCADE.w, ARCADE.d, [{ side: 'w', at: 0, width: 140 }, { side: 'e', at: 0, width: 140 }], null, 'brick', 190);

// ---------------------------------------------------------------- avenues
/**
 * Width of the main avenues (4 lanes + sidewalks, ≈15 m). Avenues are the wide
 * lines of the street grid, placed near the real ones (明治通り, 外堀通り under
 * the 都心環状線, 春日通り under the 5号線, 靖国通り, 青山通り, 目黒通り).
 */
export const AVENUE_W = 380;
const AVENUES_X = [-2700, EXPRESS_C.x];
const AVENUES_Z = [EXPRESS_5.z, -1350, 1000, 3700];

// ---------------------------------------------------------------- nation bases and jails (reserved here; defined in nations.ts)
/** Base centres (must match config/nations.ts). */
export const BASE_SITES = {
  sun: geo(35.6905, 139.7050), // 新宿三丁目
  moon: geo(35.7075, 139.7710), // 上野広小路
  star: geo(35.6340, 139.7330), // 高輪
};
export const JAIL_SITES = {
  sun: { x: BASE_SITES.sun.x + 20, z: BASE_SITES.sun.z - 420 },
  moon: { x: BASE_SITES.moon.x - 250, z: BASE_SITES.moon.z + 380 },
  star: { x: BASE_SITES.star.x, z: BASE_SITES.star.z + 380 },
};
for (const k of ['sun', 'moon', 'star'] as const) {
  reserve(BASE_SITES[k].x, BASE_SITES[k].z, 500, 500, 0);
  reserve(JAIL_SITES[k].x, JAIL_SITES[k].z, 240, 60, 90);
}

// ---------------------------------------------------------------- the city
/** Deterministic PRNG so the city is the same every load. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type District = 'commercial' | 'business' | 'residential' | 'mixed';
const DISTRICTS: { p: Point; r: number; kind: District }[] = [
  { p: geo(35.6930, 139.7030), r: 900, kind: 'commercial' }, // 新宿・歌舞伎町
  { p: geo(35.6600, 139.7040), r: 700, kind: 'commercial' }, // 渋谷
  { p: geo(35.7290, 139.7140), r: 800, kind: 'commercial' }, // 池袋
  { p: geo(35.6990, 139.7705), r: 520, kind: 'commercial' }, // 秋葉原
  { p: geo(35.7085, 139.7735), r: 450, kind: 'commercial' }, // 上野・御徒町
  { p: geo(35.6665, 139.7560), r: 450, kind: 'commercial' }, // 新橋
  { p: geo(35.7010, 139.7580), r: 420, kind: 'commercial' }, // 神保町・水道橋
  { p: geo(35.6850, 139.7640), r: 700, kind: 'business' }, // 丸の内・大手町
  { p: geo(35.6700, 139.7480), r: 520, kind: 'business' }, // 霞が関・虎ノ門
  { p: geo(35.6630, 139.7320), r: 650, kind: 'business' }, // 六本木
  { p: geo(35.6300, 139.7400), r: 450, kind: 'business' }, // 品川
  { p: geo(35.7200, 139.7500), r: 1000, kind: 'residential' }, // 文京
  { p: geo(35.7180, 139.7120), r: 750, kind: 'residential' }, // 目白・雑司が谷
  { p: geo(35.6420, 139.7250), r: 800, kind: 'residential' }, // 白金・高輪
  { p: geo(35.6870, 139.7250), r: 500, kind: 'residential' }, // 四谷・信濃町
];
function districtAt(x: number, z: number, rnd: () => number): District {
  let best: District | null = null, bd = Infinity;
  for (const d of DISTRICTS) {
    const k = Math.hypot(x - d.p.x, z - d.p.z) / d.r;
    if (k < 1 && k < bd) { bd = k; best = d.kind; }
  }
  return best ?? (rnd() < 0.5 ? 'residential' : 'mixed');
}

export type StreetKind = 'avenue' | 'street' | 'alley';
/** A straight street running the whole city: `c` is its centre line (x for north–south, z for east–west). */
export interface StreetLine { c: number; w: number; kind: StreetKind }
/** 2-lane street with sidewalks (≈9 m) and a lane without (≈4.6 m). */
export const STREET_W = 240, ALLEY_W = 120;
const SIDEWALK: Record<StreetKind, number> = { avenue: 90, street: 70, alley: 22 };

/**
 * Street lines across [min, max]: the avenues at fixed positions, and between
 * them blocks of 16–28 m separated by 2-lane streets and narrow lanes.
 */
function streetLines(min: number, max: number, avenues: number[], rnd: () => number): StreetLine[] {
  const out: StreetLine[] = [];
  const fixed = [{ c: min, w: 0 }, ...avenues.map((c) => ({ c, w: AVENUE_W })), { c: max, w: 0 }];
  let n = 0;
  for (let k = 0; k < fixed.length - 1; k++) {
    const a = fixed[k], b = fixed[k + 1];
    if (a.w) out.push({ c: a.c, w: a.w, kind: 'avenue' });
    const start = a.c + a.w / 2, end = b.c - b.w / 2, span = end - start;
    const blocks = Math.max(1, Math.round(span / 720));
    const inner: StreetLine[] = [];
    for (let i = 1; i < blocks; i++) {
      const kind: StreetKind = n++ % 3 === 0 ? 'street' : 'alley';
      inner.push({ c: 0, w: kind === 'street' ? STREET_W : ALLEY_W, kind });
    }
    const sizes = Array.from({ length: blocks }, () => 0.8 + rnd() * 0.4);
    const total = sizes.reduce((q, v) => q + v, 0), free = span - inner.reduce((q, l) => q + l.w, 0);
    let pos = start;
    for (let i = 0; i < inner.length; i++) {
      pos += (sizes[i] / total) * free;
      inner[i].c = pos + inner[i].w / 2;
      pos += inner[i].w;
      out.push(inner[i]);
    }
  }
  return out;
}

export type BuildingType = 'house' | 'apartment' | 'mixed' | 'shop' | 'office' | 'tower';
export interface Building {
  x: number; z: number; w: number; d: number; h: number;
  type: BuildingType;
  floors: number;
  district: District;
  /** Side facing the street (shopfronts, signs, entrances). */
  front: Side;
  seed: number;
  /** Beyond the tracks: scenery only. */
  outside: boolean;
}
export interface StreetSeg { x: number; z: number; w: number; d: number; axis: 'x' | 'z'; kind: StreetKind }
export interface Block { x0: number; z0: number; x1: number; z1: number; sides: Record<Side, StreetKind> }

export const BUILDINGS: Building[] = [];
export const BLOCKS: Block[] = [];
/** Street pieces between intersections, and the intersections themselves (inside or outside the loop). */
export const STREET_SEGS: StreetSeg[] = [];
export const INTERSECTIONS: { x: number; z: number; w: number; d: number; streets: number }[] = [];
export const PARKINGS: { x: number; z: number; w: number; d: number; axis: 'x' | 'z' }[] = [];
/** Utility poles (電柱) and the wires between them, street lights and traffic signals. */
export const POLES: Point[] = [];
export const WIRES: [number, number][] = [];
export const LIGHTS: (Point & { ang: number })[] = [];
export const SIGNALS: (Point & { ang: number })[] = [];
/** Zebra crossings: rectangles striped across `axis` (the direction people walk). */
export const CROSSWALKS: { x: number; z: number; w: number; d: number; axis: 'x' | 'z' }[] = [];
/** Pedestrian footbridges (歩道橋): deck centre and span. */
export const FOOTBRIDGES: { x: number; z: number; span: number; alongZ: boolean }[] = [];
export const FOOTBRIDGE_H = 130;

const G0 = { x: GROUND.cx - GROUND.w / 2, z: GROUND.cz - GROUND.d / 2 };
const rndCity = prng(20252);
/** North–south streets (constant x) and east–west streets (constant z). */
export const GRID = { xs: streetLines(G0.x, G0.x + GROUND.w, AVENUES_X, rndCity), zs: streetLines(G0.z, G0.z + GROUND.d, AVENUES_Z, rndCity) };

/** Pieces of street free of landmarks (and inside the city ground). */
const streetFree = (r: Rect) => !reserved(r);

/** Footprints street furniture must avoid (footbridge stairs, crossings). */
const furnitureOut: Rect[] = [];

// Pedestrian footbridges (歩道橋) over the avenues near busy places.
{
  const targets = [geo(35.6925, 139.7040), geo(35.6605, 139.7045), geo(35.7285, 139.7140), geo(35.6995, 139.7700), geo(35.6660, 139.7565), geo(35.6620, 139.7330), geo(35.7050, 139.7300)];
  const cands: { c: number; w: number; t: number; alongZ: boolean }[] = [];
  const scan = (lines: StreetLine[], cross: StreetLine[], alongZ: boolean) => {
    for (const L of lines) {
      if (L.kind !== 'avenue') continue;
      for (let j = 0; j < cross.length - 1; j++) {
        const a = cross[j].c + cross[j].w / 2, b = cross[j + 1].c - cross[j + 1].w / 2;
        if (b - a >= 420) cands.push({ c: L.c, w: L.w, t: a + 60, alongZ });
      }
    }
  };
  scan(GRID.xs, GRID.zs, true);
  scan(GRID.zs, GRID.xs, false);
  const used: Point[] = [];
  for (const tg of targets) {
    let best: (typeof cands)[number] | null = null, bd = 1200;
    for (const q of cands) {
      const p = q.alongZ ? { x: q.c, z: q.t } : { x: q.t, z: q.c };
      const r = q.alongZ ? { x0: q.c - q.w / 2 - 100, x1: q.c + q.w / 2 + 100, z0: q.t - 50, z1: q.t + 320 } : { x0: q.t - 50, x1: q.t + 320, z0: q.c - q.w / 2 - 100, z1: q.c + q.w / 2 + 100 };
      const d = Math.hypot(p.x - tg.x, p.z - tg.z);
      if (d < bd && !reserved(r) && !noFootbridge.some((k) => overlaps(k, r)) && !used.some((u) => Math.hypot(u.x - p.x, u.z - p.z) < 1500)
        && [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]].every(([x, z]) => insideLoop(x, z, 60))) {
        bd = d;
        best = q;
      }
    }
    if (!best) continue;
    const { c, w, t, alongZ } = best;
    const H = FOOTBRIDGE_H, span = w + 2 * SIDEWALK.avenue, id = 'footbridge';
    // In local terms: `u` runs across the avenue, `v` along it. The deck spans u; stairs run along v on the sidewalks.
    const put = (u: number, v: number, du: number, dv: number, y1: number, y0: number) =>
      alongZ ? box(c + u, t + v, du, dv, y1, 'metal', { y0, group: id }) : box(t + v, c + u, dv, du, y1, 'metal', { y0, group: id });
    put(0, 0, span, 70, H, H - SLAB);
    put(0, -31, span, 8, H + 32, H); // railing on the far side
    put(-span / 2 + 4, 0, 8, 70, H + 32, H);
    put(span / 2 - 4, 0, 8, 70, H + 32, H);
    put(0, 31, w - 10, 8, H + 32, H); // near railing, open where the stairs arrive
    for (const s of [-1, 1]) {
      const u = s * (w / 2 + SIDEWALK.avenue / 2);
      if (alongZ) ramp(c + u, t + 35 + 130, 60, 260, 'z', -1, 0, H, 'stairs', 'metal', id);
      else ramp(t + 35 + 130, c + u, 260, 60, 'x', -1, 0, H, 'stairs', 'metal', id);
    }
    const p = alongZ ? { x: c, z: t } : { x: t, z: c };
    furnitureOut.push(alongZ ? { x0: c - span / 2 - 10, x1: c + span / 2 + 10, z0: t - 60, z1: t + 320 } : { x0: t - 60, x1: t + 320, z0: c - span / 2 - 10, z1: c + span / 2 + 10 });
    used.push(p);
    FOOTBRIDGES.push({ ...p, span, alongZ });
  }
}

{
  const rnd = rndCity;
  const { xs: X, zs: Z } = GRID;
  // Streets and intersections (drawn even beyond the tracks, where the city continues).
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < Z.length; j++) {
      const ix = { x0: X[i].c - X[i].w / 2, x1: X[i].c + X[i].w / 2, z0: Z[j].c - Z[j].w / 2, z1: Z[j].c + Z[j].w / 2 };
      if (streetFree(ix)) INTERSECTIONS.push({ x: X[i].c, z: Z[j].c, w: X[i].w, d: Z[j].w, streets: +(X[i].kind !== 'alley') + +(Z[j].kind !== 'alley') });
      if (j < Z.length - 1) {
        const r = { x0: ix.x0, x1: ix.x1, z0: ix.z1, z1: Z[j + 1].c - Z[j + 1].w / 2 };
        if (streetFree(r)) STREET_SEGS.push({ x: X[i].c, z: (r.z0 + r.z1) / 2, w: X[i].w, d: r.z1 - r.z0, axis: 'z', kind: X[i].kind });
      }
      if (i < X.length - 1) {
        const r = { x0: ix.x1, x1: X[i + 1].c - X[i + 1].w / 2, z0: ix.z0, z1: ix.z1 };
        if (streetFree(r)) STREET_SEGS.push({ x: (r.x0 + r.x1) / 2, z: Z[j].c, w: r.x1 - r.x0, d: Z[j].w, axis: 'x', kind: Z[j].kind });
      }
    }
  }

  const TYPES: Record<BuildingType | 'parking', { front: [number, number]; floors: [number, number]; gap: number; depth: number }> = {
    house: { front: [150, 220], floors: [2, 3], gap: 18, depth: 260 },
    apartment: { front: [240, 380], floors: [4, 9], gap: 12, depth: 360 },
    mixed: { front: [150, 260], floors: [4, 9], gap: 0, depth: 360 },
    shop: { front: [170, 280], floors: [2, 3], gap: 0, depth: 300 },
    office: { front: [420, 800], floors: [8, 16], gap: 30, depth: 700 },
    tower: { front: [500, 800], floors: [20, 34], gap: 40, depth: 700 },
    parking: { front: [230, 360], floors: [0, 0], gap: 10, depth: 400 },
  };
  const MIX: Record<District, [BuildingType | 'parking', number][]> = {
    commercial: [['mixed', 0.62], ['shop', 0.18], ['apartment', 0.1], ['parking', 0.05], ['office', 0.05]],
    business: [['office', 0.7], ['tower', 0.12], ['mixed', 0.18]],
    residential: [['house', 0.58], ['apartment', 0.28], ['parking', 0.08], ['shop', 0.06]],
    mixed: [['mixed', 0.34], ['apartment', 0.36], ['house', 0.17], ['shop', 0.08], ['parking', 0.05]],
  };
  const pick = (d: District): BuildingType | 'parking' => {
    let u = rnd();
    for (const [t, p] of MIX[d]) if ((u -= p) < 0) return t;
    return MIX[d][0][0];
  };
  const within = (lo: number, hi: number) => lo + rnd() * (hi - lo);

  const addBuilding = (x: number, z: number, w: number, d: number, type: BuildingType, district: District, front: Side, outside: boolean, streetFront: boolean) => {
    const [f0, f1] = TYPES[type].floors;
    const floors = Math.round(within(f0, f1));
    const h = type === 'tower' ? realHeight(floors * 3.4) : floorsToHeight(floors);
    BUILDINGS.push({ x, z, w, d, h, type, floors, district, front, seed: Math.floor(rnd() * 1e9), outside });
    if (outside) return;
    box(x, z, w, d, h, 'bldg', { noFloor: true });
    // Vending machines in front of houses, apartments and small buildings.
    if (streetFront && (type === 'house' || type === 'apartment' || type === 'mixed' || type === 'shop') && rnd() < 0.22) {
      const n = front === 'n' || front === 's' ? 1 : 0;
      const off = (rnd() - 0.5) * ((n ? w : d) - 80);
      const vx = n ? x + off : x + (front === 'e' ? w / 2 + 11 : -w / 2 - 11);
      const vz = n ? z + (front === 's' ? d / 2 + 11 : -d / 2 - 11) : z + off;
      const r = { x0: vx - 30, x1: vx + 30, z0: vz - 30, z1: vz + 30 };
      if (!furnitureOut.some((k) => overlaps(k, r))) box(vx, vz, n ? 54 : 20, n ? 20 : 54, 48, 'vending', { noFloor: true, group: front });
    }
  };

  for (let i = 0; i < X.length - 1; i++) {
    for (let j = 0; j < Z.length - 1; j++) {
      const sides: Record<Side, StreetKind> = { w: X[i].kind, e: X[i + 1].kind, n: Z[j].kind, s: Z[j + 1].kind };
      const b = { x0: X[i].c + X[i].w / 2, x1: X[i + 1].c - X[i + 1].w / 2, z0: Z[j].c + Z[j].w / 2, z1: Z[j + 1].c - Z[j + 1].w / 2 };
      const corners = [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]];
      const inside = corners.every(([x, z]) => insideLoop(x, z, TRACK_MARGIN + 20));
      const outside = corners.every(([x, z]) => loopSignedDist(x, z) < -TRACK_MARGIN - 60);
      if (!inside && !outside && corners.every(([x, z]) => !insideLoop(x, z, TRACK_MARGIN + 20))) continue; // along the tracks
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const district = districtAt(cx, cz, rnd);
      const clean = inside && !reserved(b);
      if (clean) {
        box(cx, cz, b.x1 - b.x0, b.z1 - b.z0, CURB, 'sidewalk');
        BLOCKS.push({ ...b, sides });
      }
      // Lot area inside the sidewalks.
      const L = { x0: b.x0 + SIDEWALK[sides.w], x1: b.x1 - SIDEWALK[sides.e], z0: b.z0 + SIDEWALK[sides.n], z1: b.z1 - SIDEWALK[sides.s] };
      const lotOk = (r: Rect) => outside
        ? !reserved(r)
          : !reserved(r) && [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]].every(([x, z]) => insideLoop(x, z, TRACK_MARGIN + 20));
      const W = L.x1 - L.x0, D = L.z1 - L.z0;
      if (district === 'business' && !outside) {
        // One or two big office buildings set back behind a small plaza.
        const n = W > 900 ? 2 : 1, g = 40;
        for (let k = 0; k < n; k++) {
          const x0 = L.x0 + (W / n) * k + g, x1 = L.x0 + (W / n) * (k + 1) - g;
          const r = { x0, x1, z0: L.z0 + g, z1: L.z1 - g };
          if (!lotOk(r)) continue;
          const type = rnd() < 0.2 ? 'tower' : 'office';
          addBuilding((x0 + x1) / 2, (r.z0 + r.z1) / 2, x1 - x0, r.z1 - r.z0, type, district, sides.s === 'street' ? 's' : 'n', false, false);
        }
        continue;
      }
      // Rows of lots along the longer side, one or two rows deep.
      const alongX = W >= D;
      const long = alongX ? W : D, short = alongX ? D : W;
      const rows = short >= 400 ? 2 : 1;
      for (let row = 0; row < rows; row++) {
        const front: Side = alongX ? (rows === 2 ? (row === 0 ? 'n' : 's') : sides.s === 'street' ? 's' : 'n') : (rows === 2 ? (row === 0 ? 'w' : 'e') : sides.e === 'street' ? 'e' : 'w');
        const rowDepth = short / rows;
        let pos = 0;
        while (pos < long - 120) {
          const type = outside && rnd() < 0.15 ? 'mixed' : pick(district);
          const T = TYPES[type];
          let fw = within(T.front[0], T.front[1]);
          if (long - pos - fw < 130) fw = long - pos;
          const depth = Math.min(rowDepth, T.depth);
          // Lot rectangle: flush with the row's front edge.
          const a0 = pos, a1 = pos + fw;
          const frontEdge = row === 0 && rows === 2 ? 0 : rows === 2 ? short : (front === 's' || front === 'e') ? short : 0;
          const b0 = frontEdge === 0 ? 0 : short - depth, b1 = b0 + depth;
          const r = alongX
            ? { x0: L.x0 + a0, x1: L.x0 + a1 - T.gap, z0: L.z0 + b0, z1: L.z0 + b1 }
            : { x0: L.x0 + b0, x1: L.x0 + b1, z0: L.z0 + a0, z1: L.z0 + a1 - T.gap };
          pos += fw;
          if (r.x1 - r.x0 < 120 || r.z1 - r.z0 < 120 || !lotOk(r)) continue;
          const x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0;
          if (type === 'parking') {
            if (outside) continue;
            PARKINGS.push({ x, z, w, d, axis: alongX ? 'z' : 'x' });
            // A few parked cars, nose to the street.
            const n = Math.floor((alongX ? w : d) / 90);
            for (let k = 0; k < n; k++) {
              if (rnd() < 0.45) continue;
              const t = (alongX ? r.x0 : r.z0) + 45 + k * 90;
              if (alongX) box(t, z, 46, Math.min(116, d - 20), 40, 'car', { noFloor: true, group: 'z' });
              else box(x, t, Math.min(116, w - 20), 46, 40, 'car', { noFloor: true, group: 'x' });
            }
            continue;
          }
          addBuilding(x, z, w, d, type, district, front, outside, sides[front] === 'street');
        }
      }
    }
  }

  // Street furniture along streets inside the loop.
  const freeSpot = (x: number, z: number, r = 30) => {
    const q = { x0: x - r, x1: x + r, z0: z - r, z1: z + r };
    return insideLoop(x, z, TRACK_MARGIN + 30) && !reserved(q) && !furnitureOut.some((k) => overlaps(k, q));
  };
  for (const s of STREET_SEGS) {
    if (!insideLoop(s.x, s.z, TRACK_MARGIN + 30)) continue;
    const alongZ = s.axis === 'z', len = alongZ ? s.d : s.w, half = (alongZ ? s.w : s.d) / 2;
    const at = (t: number, off: number) => (alongZ ? { x: s.x + off, z: s.z - len / 2 + t } : { x: s.x - len / 2 + t, z: s.z + off });
    if (s.kind === 'avenue') {
      // Ginkgo trees and tall street lights on both sidewalks.
      for (let t = 140; t < len - 100; t += 280) {
        for (const side of [-1, 1]) {
          const p = at(t, side * (half + 45));
          if (freeSpot(p.x, p.z, 20)) tree(p.x, p.z, 250 + (Math.floor(t / 280) % 3) * 30);
        }
      }
      for (let t = 280; t < len - 100; t += 560) {
        for (const side of [-1, 1]) {
          const p = at(t, side * (half + 14));
          if (freeSpot(p.x, p.z, 20)) LIGHTS.push({ ...p, ang: alongZ ? (side < 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2) });
        }
      }
      continue;
    }
    // 電柱 on one side, wired together; street lights on the other side of 2-lane streets.
    let prev = -1;
    for (let t = 70; t < len - 50; t += 330) {
      const p = at(t, half + 12);
      if (!freeSpot(p.x, p.z)) { prev = -1; continue; }
      box(p.x, p.z, 10, 10, 260, 'pole', { noFloor: true });
      POLES.push(p);
      if (prev >= 0) WIRES.push([prev, POLES.length - 1]);
      prev = POLES.length - 1;
    }
    if (s.kind === 'street') {
      for (let t = 200; t < len - 100; t += 480) {
        const p = at(t, -half - 16);
        if (freeSpot(p.x, p.z)) LIGHTS.push({ ...p, ang: alongZ ? 0 : Math.PI / 2 });
      }
      // Parked cars at the kerb, mid-block.
      if (len > 400 && rnd() < 0.35) {
        const p = at(len / 2 + (rnd() - 0.5) * (len - 400), half - 34);
        if (freeSpot(p.x, p.z, 60)) box(p.x, p.z, alongZ ? 46 : 116, alongZ ? 116 : 46, 40, 'car', { noFloor: true, group: s.axis });
      }
    }
  }
  // Zebra crossings where streets meet (not across lanes), and signals where an avenue is involved.
  for (const ix of INTERSECTIONS) {
    if (ix.streets < 2 || !insideLoop(ix.x, ix.z, TRACK_MARGIN + 60)) continue;
    const g = 16, depth = 90;
    CROSSWALKS.push({ x: ix.x, z: ix.z - ix.d / 2 - g - depth / 2, w: ix.w, d: depth, axis: 'x' });
    CROSSWALKS.push({ x: ix.x, z: ix.z + ix.d / 2 + g + depth / 2, w: ix.w, d: depth, axis: 'x' });
    CROSSWALKS.push({ x: ix.x - ix.w / 2 - g - depth / 2, z: ix.z, w: depth, d: ix.d, axis: 'z' });
    CROSSWALKS.push({ x: ix.x + ix.w / 2 + g + depth / 2, z: ix.z, w: depth, d: ix.d, axis: 'z' });
    SIGNALS.push({ x: ix.x - ix.w / 2 - 30, z: ix.z - ix.d / 2 - 30, ang: 0 });
    SIGNALS.push({ x: ix.x + ix.w / 2 + 30, z: ix.z + ix.d / 2 + 30, ang: Math.PI });
  }
}

export const WORLD: readonly Prim[] = prims;

/** Green and gravel areas painted on the ground (decoration). */
export const PARKS: readonly { x: number; z: number; w: number; d: number; kind: 'park' | 'gravel' }[] = [
  { x: PALACE_PLAZA.x, z: PALACE_PLAZA.z, w: PALACE_PLAZA.w + 40, d: PALACE_PLAZA.d + 40, kind: 'gravel' },
  { x: TOWER.x, z: TOWER.z, w: PLAZA.r * 2, d: PLAZA.r * 2, kind: 'park' },
  { x: GYOEN.x, z: GYOEN.z, w: GYOEN.w, d: GYOEN.d, kind: 'park' },
  { x: STADIUM.x, z: STADIUM.z + 60, w: STADIUM.W - 2 * STADIUM.T, d: STADIUM.D - 2 * STADIUM.T, kind: 'park' },
  { x: UENO_HILL.x, z: UENO_HILL.z, w: UENO_HILL.w + 200, d: UENO_HILL.d + 200, kind: 'park' },
  { x: RIKUGIEN.x, z: RIKUGIEN.z, w: 520, d: 400, kind: 'park' },
  { x: ATAGO.x, z: ATAGO.z, w: ATAGO.w + 100, d: ATAGO.d + 100, kind: 'park' },
  { x: TOKYO_TOWER.x, z: TOKYO_TOWER.z + 170, w: 560, d: 820, kind: 'gravel' },
];

/** Landmarks the renderer decorates (spires, domes, roofs) — positions only. */
export const LANDMARKS = {
  tokyoTower: TOKYO_TOWER,
  footTown: FOOTTOWN,
  tokyoStation: TOKYO_ST,
  diet: DIET,
  dome: DOME,
};

// ---------------------------------------------------------------- AI hints

/** Places patrols and searches gravitate to, so encounters happen across the city. */
export const HOTSPOTS: readonly (Point & { name: string; weight: number })[] = [
  { name: '日比谷公園（管制塔）', x: TOWER.x, z: TOWER.z + 150, weight: 4 },
  { name: '皇居前広場', x: PALACE_PLAZA.x, z: PALACE_PLAZA.z, weight: 3 },
  { name: '国会議事堂', x: DIET.x, z: DIET.z + 220, weight: 2 },
  { name: '東京タワー', x: TOKYO_TOWER.x, z: TOKYO_TOWER.z + 450, weight: 3 },
  { name: '六本木', ...geo(35.6628, 139.7330), weight: 2 },
  { name: '国立競技場', x: STADIUM.x, z: STADIUM.z + 60, weight: 2 },
  { name: '新宿御苑', x: GYOEN.x - 150, z: GYOEN.z, weight: 2 },
  { name: '東京ドーム', x: DOME.x, z: DOME.z + DOME.r + 150, weight: 2 },
  { name: '聖橋', x: HIJIRI, z: riverZAt(HIJIRI) - 400, weight: 2 },
  { name: '飯田橋', x: BRIDGE_X[3], z: riverZAt(BRIDGE_X[3]) + 330, weight: 2 },
  { name: '江戸川橋', x: BRIDGE_X[2], z: riverZAt(BRIDGE_X[2]) + 330, weight: 1 },
  { name: '秋葉原', ...geo(35.6993, 139.7695), weight: 2 },
  { name: '池袋', ...geo(35.7280, 139.7150), weight: 1 },
  { name: '渋谷', ...geo(35.6600, 139.7060), weight: 2 },
  { name: '愛宕山', x: ATAGO.x - ATAGO.w / 2 - 540, z: ATAGO.z + 60, weight: 1 },
  { name: '恵比寿', ...geo(35.6440, 139.7160), weight: 1 },
];

/** High places snipers hold (stand points on the walkable tops). */
export const PERCHES: readonly (Point & { y: number })[] = [
  { x: TOKYO_TOWER.x, y: FOOTTOWN.h, z: TOKYO_TOWER.z },
  { x: ATAGO.x, y: ATAGO.top, z: ATAGO.z },
  { x: UENO_HILL.x + 60, y: UENO_HILL.top, z: UENO_HILL.z + 80 },
  { x: PALACE.x - 80, y: PALACE.top + 90, z: PALACE.z - 250 },
  { x: EXPRESS_C.x, y: EXPRESSWAY_H, z: sc(250) + 300 },
  { x: sc(-400), y: EXPRESSWAY_H, z: EXPRESS_5.z },
  { x: STADIUM.x, y: STADIUM.H, z: STADIUM.z + 60 - STADIUM.D / 2 + STADIUM.T / 2 },
  { x: WALKUP_KABUKI.terrace.x, y: UPPER, z: WALKUP_KABUKI.terrace.z },
  ...FOOTBRIDGES.map((f) => ({ x: f.x, y: FOOTBRIDGE_H, z: f.z })),
];

/**
 * Named reference points (used by tests and debugging), all derived from the
 * geometry above so they stay valid if the layout changes.
 */
export const SITES = {
  /** Open, flat ground with nothing solid within ~180 units (皇居前広場). */
  open: { x: PALACE_PLAZA.x, z: PALACE_PLAZA.z },
  /** 2F building: stair foot (on the first step), 2F terrace, and a ground-floor spot under the 2F slab. */
  walkup: WALKUP_KABUKI,
  /** Tokyo Tower: a point half way up the outdoor stair (it rises northward) and the FootTown roof. */
  towerStairsMid: { x: TOKYO_TOWER.x, z: TOKYO_TOWER.z + FOOTTOWN.d / 2 + 180, y: FOOTTOWN.h / 2 },
  towerDeck: { x: TOKYO_TOWER.x, y: FOOTTOWN.h, z: TOKYO_TOWER.z },
  /** 上野の山: foot of the west slope (walk east to climb), the top, and a cliff foot to the north. */
  hillSlopeFoot: { x: UENO_SLOPE.x - UENO_SLOPE.len / 2 - 50, z: UENO_SLOPE.z },
  hillSlopeDir: { x: 1, z: 0 },
  hillTop: { x: UENO_HILL.x + 200, y: UENO_HILL.top, z: UENO_HILL.z + 60 },
  hillCliffFoot: { x: UENO_HILL.x + 60, z: UENO_HILL.z - UENO_HILL.d / 2 - 40 },
  /** 愛宕山 stone stairs (rise westward): a point half way up. */
  atagoStairsMid: { x: ATAGO.x + ATAGO.w / 2 + 110, z: ATAGO.z, y: ATAGO.top / 2 },
  /** Expressway: a street point west of the deck (walk east to pass under it) and a deck point. */
  underExpressway: { x: EXPRESS_C.x - EXPRESSWAY_W / 2 - 120, z: sc(250), passX: EXPRESS_C.x + EXPRESSWAY_W / 2 + 20 },
  expresswayDeck: { x: EXPRESS_C.x, y: EXPRESSWAY_H, z: sc(250) + 300 },
  /** Arcade: just outside the west door (walk east through it) and the far end. */
  arcadeWest: { x: ARCADE.x - ARCADE.w / 2 - 40, z: ARCADE.z },
  arcadeEastEnd: ARCADE.x + ARCADE.w / 2,
  /** 聖橋 (arched): south approach (walk north to cross); and a river bank point away from bridges. */
  bridgeSouth: { x: HIJIRI, z: riverZAt(HIJIRI) + 360 },
  riverBank: { x: sc(800), z: riverZAt(sc(800)) + RIVER_WIDTH / 2 + 60 },
  riverZ: riverZAt,
  /** Palace: a point on the island top. */
  palaceTop: { x: PALACE.x + 150, y: PALACE.top, z: PALACE.z + 330 },
  /** 国会議事堂: points north and south of it, off the tower's line, and a height that sees over it. */
  dietNorth: { x: DIET.x + 180, z: DIET.z - DIET.d / 2 - 90 },
  dietSouth: { x: DIET.x + 180, z: DIET.z + DIET.d / 2 + 90 },
  dietOverY: DIET.h * 4 + 200,
  /** 上野 stone stairs (rise northward): a point half way up. */
  uenoStairsMid: { x: UENO_STAIRS.x, z: UENO_STAIRS.z, y: UENO_HILL.top / 2 },
  /** 聖橋 south slope, half way up. */
  bridgeSlopeMid: { x: HIJIRI, z: riverZAt(HIJIRI) + 200, y: 30 },
  /** A footbridge deck (歩道橋), if any was placed. */
  footbridge: FOOTBRIDGES[0] ? { x: FOOTBRIDGES[0].x, y: FOOTBRIDGE_H, z: FOOTBRIDGES[0].z } : null,
};
