import type { Point } from './nations';

/**
 * v7.4 battlefield: Tokyo inside the JR Yamanote loop.
 *
 * Positions come from real latitude / longitude (see `geo`) at 0.45 units per
 * metre, so the loop keeps its true shape (≈13 km north–south, 7 km east–west,
 * scaled to ≈5900 × 3200 units) and every landmark sits where it really is.
 * A character is ~60 units tall, so the city is a compressed, game-scale Tokyo:
 * real layout, real building types, walkable in a five-minute match.
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
  | 'concrete' | 'glass' | 'brick' | 'steel' | 'tree';

interface PrimBase {
  x: number;
  z: number;
  w: number;
  d: number;
  y0: number;
  mat: Material;
  /** Line of sight passes through (water). Default: blocks. */
  seeThrough?: boolean;
  /** The top is not a floor (water). Default: walkable. */
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

// ---------------------------------------------------------------- geography

const LAT0 = 35.68, LON0 = 139.74;
/** Units per metre. */
export const MAP_SCALE = 0.45;
const KX = 90_200 * MAP_SCALE; // units per degree of longitude at 35.7°N
const KZ = 111_000 * MAP_SCALE; // units per degree of latitude

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
/** Width of the railway corridor inside the polygon (embankment + fence). */
export const TRACK_MARGIN = 40;

function segDist(px: number, pz: number, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

/** Inside the Yamanote loop and at least `margin` from the track. */
function insideLoopExact(x: number, z: number, margin: number): boolean {
  let inside = false;
  for (let i = 0, j = LOOP.length - 1; i < LOOP.length; j = i++) {
    const a = LOOP[i], b = LOOP[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  if (!inside) return false;
  for (let i = 0; i < LOOP.length; i++) if (segDist(x, z, LOOP[i], LOOP[(i + 1) % LOOP.length]) < margin) return false;
  return true;
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
  for (let c = 0; c < LCOLS; c++) {
    const x = LX0 + (c + 0.5) * LOOP_CELL, z = LZ0 + (r + 0.5) * LOOP_CELL;
    let d = Infinity;
    for (let i = 0; i < LOOP.length; i++) d = Math.min(d, segDist(x, z, LOOP[i], LOOP[(i + 1) % LOOP.length]));
    loopDist[r * LCOLS + c] = insideLoopExact(x, z, 0) ? d : -d;
  }
}

/** Inside the Yamanote loop and at least `margin` from the tracks. */
export function insideLoop(x: number, z: number, margin = TRACK_MARGIN): boolean {
  const c = Math.floor((x - LX0) / LOOP_CELL), r = Math.floor((z - LZ0) / LOOP_CELL);
  if (c < 0 || r < 0 || c >= LCOLS || r >= LROWS) return false;
  const d = loopDist[r * LCOLS + c];
  if (d - LOOP_SLACK >= margin) return true;
  if (d + LOOP_SLACK < margin) return false;
  return insideLoopExact(x, z, margin);
}

const xs = LOOP.map((p) => p.x), zs = LOOP.map((p) => p.z);
/** Bounding box of the loop (the nav grid and minimap cover this). */
export const BOUNDS = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
/** Painted ground: the loop plus a margin of city beyond the tracks. */
export const GROUND = { w: BOUNDS.maxX - BOUNDS.minX + 1400, d: BOUNDS.maxZ - BOUNDS.minZ + 1400, cx: (BOUNDS.minX + BOUNDS.maxX) / 2, cz: (BOUNDS.minZ + BOUNDS.maxZ) / 2 };

/** Floor height of second storeys, rooftops and decks. */
export const UPPER = 64;
const SLAB = 6;

// ---------------------------------------------------------------- key places

/** 管制塔: a radio tower in 日比谷公園, the point about equally far from all three bases (~2150). */
export const TOWER: Circle = { ...geo(35.6736, 139.7564), r: 80 };
/** 日比谷公園 around the tower. */
export const PLAZA: Circle = { ...TOWER, r: 170 };
/** 皇居 (Imperial Palace) island inside its moat. */
export const PALACE = { x: 480, z: -300, w: 400, d: 480, moat: 50, top: 14 };
/** 皇居前広場: the big open gravel plaza between the moat and Tokyo Station. */
export const PALACE_PLAZA = { x: 865, z: -90, w: 250, d: 460 };

const prims: Prim[] = [];
const box = (x: number, z: number, w: number, d: number, y1: number, mat: Material, extra: Partial<BoxPrim> = {}) =>
  prims.push({ kind: 'box', x, z, w, d, y0: 0, y1, mat, ...extra });
const ramp = (
  x: number, z: number, w: number, d: number, axis: 'x' | 'z', dir: 1 | -1, hLow: number, hHigh: number,
  style: 'stairs' | 'slope', mat: Material = style === 'stairs' ? 'wood' : 'earth', group?: string,
) => prims.push({ kind: 'ramp', x, z, w, d, y0: 0, axis, dir, hLow, hHigh, style, mat, group });
const slab = (x: number, z: number, w: number, d: number, top: number, mat: Material, group?: string) =>
  box(x, z, w, d, top, mat, { y0: top - SLAB, group });

/** Areas the city filler must leave open (landmarks, parks, water, bases, roads). */
const keepOut: { x0: number; z0: number; x1: number; z1: number }[] = [];
const reserve = (x: number, z: number, w: number, d: number, pad = 40) =>
  keepOut.push({ x0: x - w / 2 - pad, z0: z - d / 2 - pad, x1: x + w / 2 + pad, z1: z + d / 2 + pad });

type Side = 'n' | 's' | 'e' | 'w';

/**
 * A walled building. Ground-floor walls stop under the upper slab; doors are
 * full-height gaps. `upper` adds a walkable second floor / roof terrace with low
 * parapets. `hole` leaves a stairwell open; `stairs` (x-axis) climbs to it.
 */
function building(
  id: string, cx: number, cz: number, w: number, d: number,
  doors: { side: Side; at: number; width: number }[],
  upper: { parapetGaps?: { side: Side; at: number; width: number }[]; hole?: { x0: number; x1: number; z0: number; z1: number } } | null,
  mat: Material = 'plaster',
): void {
  const T = 12, H = UPPER - SLAB;
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
  if (!h) slab(cx, cz, w, d, UPPER, 'wood', id);
  else {
    const rect = (ax: number, bx: number, az: number, bz: number) => {
      if (bx - ax > 1 && bz - az > 1) slab((ax + bx) / 2, (az + bz) / 2, bx - ax, bz - az, UPPER, 'wood', id);
    };
    rect(x0, x1, z0, h.z0);
    rect(x0, x1, h.z1, z1);
    rect(x0, h.x0, h.z0, h.z1);
    rect(h.x1, x1, h.z0, h.z1);
  }
  if (upper) for (const side of ['n', 's', 'e', 'w'] as Side[]) wallSide(side, UPPER, UPPER + 14, (upper.parapetGaps ?? []).filter((g) => g.side === side));
  reserve(cx, cz, w, d, 50);
}

/**
 * Two-storey 雑居ビル (mixed-use block) with an interior staircase climbing
 * west → east to a roof terrace. Returns the stair foot and the terrace point.
 */
function walkUp(id: string, cx: number, cz: number, mat: Material = 'concrete') {
  const w = 200, d = 150;
  building(id, cx, cz, w, d,
    [{ side: 's', at: 30, width: 70 }, { side: 'e', at: 30, width: 70 }, { side: 'w', at: -20, width: 60 }],
    { hole: { x0: cx - 100, x1: cx + 40, z0: cz - 75, z1: cz - 15 } }, mat);
  ramp(cx - 25, cz - 40, 130, 50, 'x', 1, 0, UPPER, 'stairs', 'wood', id);
  return { stairsFoot: { x: cx - 75, z: cz - 40 }, terrace: { x: cx + 60, z: cz - 40 }, underFloor: { x: cx + 20, z: cz + 40 } };
}

// ---------------------------------------------------------------- 皇居 (Imperial Palace)
{
  const P = PALACE, m = P.moat;
  // Stone-walled island with gardens; its top is a walkable plateau.
  box(P.x, P.z, P.w, P.d, P.top, 'earth', { group: 'palace' });
  // Moat (water) all round.
  const ox0 = P.x - P.w / 2 - m, ox1 = P.x + P.w / 2 + m, oz0 = P.z - P.d / 2 - m, oz1 = P.z + P.d / 2 + m;
  const water = (x: number, z: number, w: number, d: number) =>
    prims.push({ kind: 'box', x, z, w, d, y0: -20, y1: 16, mat: 'water', seeThrough: true, noFloor: true, group: 'moat' });
  water(P.x, oz0 + m / 2, P.w + 2 * m, m);
  water(P.x, oz1 - m / 2, P.w + 2 * m, m);
  water(ox0 + m / 2, P.z, m, P.d);
  water(ox1 - m / 2, P.z, m, P.d);
  // Gates: 大手門 (east), 桜田門 (south), 北桔橋門 (north) — ramps over the moat onto the walls.
  ramp(ox1 - m / 2 + 25, P.z - 120, m + 50, 60, 'x', -1, 0, P.top, 'slope', 'stone', 'palace');
  ramp(P.x + 60, oz1 - m / 2 + 25, 60, m + 50, 'z', -1, 0, P.top, 'slope', 'stone', 'palace');
  ramp(P.x - 80, oz0 + m / 2 - 25, 60, m + 50, 'z', 1, 0, P.top, 'slope', 'stone', 'palace');
  // 宮殿 and the 天守台 (castle keep base), reached by stone stairs.
  box(P.x - 30, P.z + 90, 170, 60, P.top + 30, 'plaster', { y0: P.top, group: 'palaceHall' });
  box(P.x - 60, P.z - 170, 80, 60, P.top + 22, 'stone', { y0: P.top, group: 'keep' });
  ramp(P.x - 60, P.z - 110, 44, 60, 'z', -1, P.top, P.top + 22, 'stairs', 'stone', 'keep');
  for (const [hx, hz] of [[P.x + 110, P.z - 60], [P.x + 120, P.z + 180], [P.x - 140, P.z + 10], [P.x + 30, P.z - 200]]) {
    box(hx, hz, 70, 16, P.top + 18, 'hedge', { y0: P.top });
  }
  reserve(P.x, P.z, P.w + 2 * m, P.d + 2 * m, 30);
  reserve(PALACE_PLAZA.x, PALACE_PLAZA.z, PALACE_PLAZA.w, PALACE_PLAZA.d, 0);
}

// ---------------------------------------------------------------- landmarks

/** 東京駅 丸の内駅舎: long red-brick station building with two domes. */
{
  const s = geo(35.6812, 139.7671);
  const x = s.x - 80;
  box(x, s.z, 40, 160, 44, 'brick', { group: 'tokyoStation' });
  reserve(x, s.z, 40, 160, 30);
}
/** 丸の内 / 大手町 office towers. */
for (const [lat, lon, h] of [[35.6880, 139.7630, 190], [35.6900, 139.7645, 200], [35.6920, 139.7625, 160]] as const) {
  const p = geo(lat, lon);
  box(p.x, p.z, 64, 64, h, 'glass', { group: 'tower' });
  reserve(p.x, p.z, 64, 64, 30);
}
/** 国会議事堂: wide granite building with its central stepped tower. */
{
  const p = geo(35.6759, 139.7449);
  box(p.x, p.z, 150, 50, 50, 'stone', { group: 'diet' });
  box(p.x, p.z, 30, 30, 96, 'stone', { y0: 50, group: 'dietTower' });
  reserve(p.x, p.z + 30, 150, 110, 30);
}
/** 霞が関 ministries. */
for (const [lat, lon] of [[35.6745, 139.7505], [35.6722, 139.7512]] as const) {
  const p = geo(lat, lon);
  box(p.x, p.z, 80, 50, 110, 'concrete', { group: 'office' });
  reserve(p.x, p.z, 80, 50, 25);
}
/** 日比谷公園 with the radio tower (管制塔) in the middle. */
box(TOWER.x, TOWER.z, 40, 40, 150, 'steel', { group: 'radioTower' });
reserve(TOWER.x, TOWER.z, PLAZA.r * 2, PLAZA.r * 2, 20);
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2 + 0.3, r = PLAZA.r - 25;
  box(TOWER.x + Math.cos(a) * r, TOWER.z + Math.sin(a) * r, 14, 14, 46, 'tree');
}

/** 東京タワー: lattice legs, a walkable observation deck (stairs) and the spire. */
const TOKYO_TOWER = geo(35.6586, 139.7454);
{
  const t = TOKYO_TOWER, S = 76;
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(t.x + ox * (S / 2 - 6), t.z + oz * (S / 2 - 6), 12, 12, UPPER, 'steel', { group: 'tokyoTower' });
  slab(t.x, t.z, S, S, UPPER, 'steel', 'tokyoTower');
  box(t.x, t.z - S / 2 + 2, S, 4, UPPER + 12, 'steel', { y0: UPPER, group: 'tokyoTower' });
  ramp(t.x, t.z + S / 2 + 70, 44, 140, 'z', -1, 0, UPPER, 'stairs', 'steel', 'tokyoTower');
  // Upper tower above the deck is solid (visual lattice drawn by the renderer).
  box(t.x, t.z, 26, 26, 330, 'steel', { y0: UPPER + 16, group: 'tokyoTowerSpire' });
  reserve(t.x, t.z + 40, S, S + 160, 40);
}
/** 増上寺 (temple beside Tokyo Tower). */
{
  const p = geo(35.6575, 139.7482);
  box(p.x + 30, p.z + 20, 90, 60, 40, 'wood', { group: 'temple' });
  reserve(p.x + 30, p.z + 20, 90, 60, 30);
}
/** 愛宕山: a real hill with the steep 出世の石段 on its east side and a slope on the west. */
const ATAGO = geo(35.6645, 139.7493);
{
  box(ATAGO.x, ATAGO.z, 130, 110, 28, 'earth', { group: 'hill' });
  ramp(ATAGO.x + 65 + 28, ATAGO.z, 56, 44, 'x', -1, 0, 28, 'stairs', 'stone', 'hill');
  ramp(ATAGO.x - 65 - 50, ATAGO.z + 20, 100, 60, 'x', 1, 0, 28, 'slope', 'earth', 'hill');
  reserve(ATAGO.x, ATAGO.z, 330, 130, 30);
}
/** 六本木ヒルズ 森タワー and 東京ミッドタウン. */
for (const [lat, lon, h, sz] of [[35.6604, 139.7292, 250, 76], [35.6655, 139.7310, 240, 64]] as const) {
  const p = geo(lat, lon);
  box(p.x, p.z, sz, sz, h, 'glass', { group: 'tower' });
  reserve(p.x, p.z, sz + 80, sz + 80, 30);
}
/** 迎賓館 (State Guest House) with its front court. */
{
  const p = geo(35.6803, 139.7286);
  box(p.x, p.z, 150, 50, 36, 'stone', { group: 'palaceHall' });
  reserve(p.x, p.z + 60, 170, 180, 30);
}
/** 国立競技場: stands you can climb (ramps) around an open field. */
const STADIUM = geo(35.6778, 139.7145);
{
  const s = STADIUM, W = 200, D = 170, T = 30, H = 30;
  box(s.x, s.z - D / 2 + T / 2, W, T, H, 'wood', { group: 'stadium' }); // north stand
  box(s.x - W / 2 + T / 2, s.z, T, D - 2 * T, H, 'wood', { group: 'stadium' });
  box(s.x + W / 2 - T / 2, s.z, T, D - 2 * T, H, 'wood', { group: 'stadium' });
  // South stand split by the main gate; ramps up both halves from the field.
  box(s.x - 60, s.z + D / 2 - T / 2, W / 2 - 40, T, H, 'wood', { group: 'stadium' });
  box(s.x + 60, s.z + D / 2 - T / 2, W / 2 - 40, T, H, 'wood', { group: 'stadium' });
  ramp(s.x - 40, s.z - D / 2 + T + 30, 44, 60, 'z', -1, 0, H, 'stairs', 'concrete', 'stadium');
  reserve(s.x, s.z, W, D, 40);
}
/** 新宿御苑: lawns, a pond and trees. */
const GYOEN = geo(35.6852, 139.7101);
{
  prims.push({ kind: 'box', x: GYOEN.x + 40, z: GYOEN.z + 20, w: 110, d: 50, y0: -20, y1: 16, mat: 'water', seeThrough: true, noFloor: true, group: 'pond' });
  for (let i = 0; i < 9; i++) box(GYOEN.x - 110 + (i % 3) * 70, GYOEN.z - 70 + Math.floor(i / 3) * 60 + ((i * 17) % 20), 16, 16, 50, 'tree');
  reserve(GYOEN.x, GYOEN.z, 320, 220, 20);
}
/** 渋谷ヒカリエ, 恵比寿ガーデンプレイス and 池袋サンシャイン60. */
for (const [lat, lon, h, sz] of [[35.6590, 139.7036, 210, 60], [35.6425, 139.7137, 170, 60], [35.7289, 139.7189, 280, 72]] as const) {
  const p = geo(lat, lon);
  box(p.x, p.z, sz, sz, h, 'glass', { group: 'tower' });
  reserve(p.x, p.z, sz + 60, sz + 60, 30);
}
/** 東京ドーム and 小石川後楽園. */
const DOME = geo(35.7056, 139.7519);
box(DOME.x, DOME.z, 150, 150, 56, 'concrete', { group: 'dome' });
reserve(DOME.x, DOME.z, 150, 150, 40);
/** 六義園 (garden with a pond). */
{
  const p = geo(35.7321, 139.7465);
  prims.push({ kind: 'box', x: p.x, z: p.z, w: 90, d: 60, y0: -20, y1: 16, mat: 'water', seeThrough: true, noFloor: true, group: 'pond' });
  for (let i = 0; i < 6; i++) box(p.x - 110 + i * 44, p.z + (i % 2 ? 70 : -70), 16, 16, 50, 'tree');
  reserve(p.x, p.z, 260, 200, 20);
}

// ---------------------------------------------------------------- 上野 (moon base area)
/** 上野の山 (Ueno hill, park on top): plateau with a slope from the south and stairs from the east. */
export const UENO_HILL = { x: 1320, z: -1840, w: 240, d: 200, top: 24 };
{
  const h = UENO_HILL;
  box(h.x, h.z, h.w, h.d, h.top, 'earth', { group: 'hill' });
  ramp(h.x + 50, h.z + h.d / 2 + 50, 90, 100, 'z', -1, 0, h.top, 'slope', 'earth', 'hill');
  ramp(h.x - h.w / 2 - 25, h.z - 40, 50, 50, 'x', 1, 0, h.top, 'stairs', 'stone', 'hill');
  box(h.x - 40, h.z - 50, 90, 40, h.top + 30, 'stone', { y0: h.top, group: 'museum' }); // 国立博物館
  reserve(h.x, h.z + 40, h.w + 60, h.d + 180, 30);
  const pond = geo(35.7118, 139.7707); // 不忍池
  prims.push({ kind: 'box', x: pond.x - 40, z: pond.z - 20, w: 130, d: 100, y0: -20, y1: 16, mat: 'water', seeThrough: true, noFloor: true, group: 'pond' });
  reserve(pond.x - 40, pond.z - 20, 130, 100, 30);
}

// ---------------------------------------------------------------- 神田川 (Kanda River) and its bridges
/** River course (x, z) from 高田馬場 to 秋葉原. */
export const KANDA: readonly Point[] = [
  geo(35.7126, 139.7038), geo(35.7101, 139.7215), geo(35.7075, 139.7327), geo(35.7021, 139.7450),
  geo(35.7020, 139.7535), geo(35.6997, 139.7650), geo(35.6986, 139.7728),
];
export const RIVER_WIDTH = 56;
/** Bridges: 高田橋, 早稲田, 江戸川橋, 飯田橋, 水道橋, 聖橋 (arched), 万世橋. */
const BRIDGE_X = [-1330, -760, -300, 180, 560, 1000, 1290];
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
    const a = KANDA[i], b = KANDA[i + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 24);
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
      if (!insideLoop(x, z, 0)) continue;
      prims.push({ kind: 'box', x, z, w: RIVER_WIDTH, d: RIVER_WIDTH, y0: -20, y1: 16, mat: 'water', seeThrough: true, noFloor: true, group: 'river' });
      keepOut.push({ x0: x - 70, z0: z - 70, x1: x + 70, z1: z + 70 });
    }
  }
  BRIDGE_X.forEach((bx, i) => {
    const z = riverZAt(bx);
    reserve(bx, z, 70, 300, 60); // clear approaches on both banks
    if (i === 5) {
      // 聖橋: arched stone bridge.
      ramp(bx, z - 75, 70, 70, 'z', 1, 0, 24, 'slope', 'stone', 'bridge');
      box(bx, z, 70, 80, 24, 'stone', { y0: 12, group: 'bridge' });
      ramp(bx, z + 75, 70, 70, 'z', -1, 0, 24, 'slope', 'stone', 'bridge');
    } else box(bx, z, 64, 110, 8, 'stone', { group: 'bridge' });
  });
}

// ---------------------------------------------------------------- 首都高 (elevated expressways: high routes)
/** A walkable elevated deck on pillars with an on-ramp at each end. */
function expressway(axis: 'x' | 'z', fixed: number, from: number, to: number): void {
  // Deck at 2nd-floor height so people can walk underneath (a character is 50 tall).
  const top = UPPER, W = 54, len = to - from, mid = (from + to) / 2;
  if (axis === 'z') {
    slab(fixed, mid, W, len, top, 'concrete', 'expressway');
    ramp(fixed, from - 70, W, 140, 'z', 1, 0, top, 'slope', 'concrete', 'expressway');
    ramp(fixed, to + 70, W, 140, 'z', -1, 0, top, 'slope', 'concrete', 'expressway');
    for (let p = from + 60; p < to - 30; p += 130) box(fixed, p, 12, 12, top - SLAB, 'concrete', { group: 'expressway' });
    reserve(fixed, mid, W, len + 280, 30);
  } else {
    slab(mid, fixed, len, W, top, 'concrete', 'expressway');
    ramp(from - 70, fixed, 140, W, 'x', 1, 0, top, 'slope', 'concrete', 'expressway');
    ramp(to + 70, fixed, 140, W, 'x', -1, 0, top, 'slope', 'concrete', 'expressway');
    for (let p = from + 60; p < to - 30; p += 130) box(p, fixed, 12, 12, top - SLAB, 'concrete', { group: 'expressway' });
    reserve(mid, fixed, len + 280, W, 30);
  }
}
expressway('z', -150, -260, 640); // 都心環状線 (赤坂〜霞が関)
reserve(-150, 250, 320, 70, 10); // the crossing under it (between pillars)
expressway('x', -2170, -760, 60); // 5号線 (池袋)

// ---------------------------------------------------------------- walk-up buildings (2F / rooftop)
/** 歌舞伎町 and 秋葉原 雑居ビル; 高輪 office. */
const WALKUP_KABUKI = walkUp('walkupK', -1260, -960);
walkUp('walkupA', 1150, -760);
walkUp('walkupT', -40, 1960);
/** アメ横 style arcade you can walk straight through (north / south doors). */
export const ARCADE = { x: 700, z: -880, w: 80, d: 200 };
building('arcade', ARCADE.x, ARCADE.z, ARCADE.w, ARCADE.d, [{ side: 'n', at: 0, width: 50 }, { side: 's', at: 0, width: 50 }], null, 'brick');

// ---------------------------------------------------------------- roads (kept clear of buildings)
/** Main roads as polylines (x, z): drawn on the ground and kept free of buildings. */
export const ROADS: readonly (readonly [number, number])[][] = [
  // 靖国通り
  [[-1421, -525], [-175, -600], [467, -774], [1230, -589]],
  // 青山通り → 渋谷
  [[-114, 155], [-649, 365], [-1132, 739], [-1520, 1060]],
  // 明治通り (渋谷〜新宿〜池袋)
  [[-1480, 1000], [-1430, 500], [-1450, -300], [-1420, -1200], [-1300, -1800], [-1100, -2350]],
  // 桜田通り
  [[380, 250], [191, 854], [60, 1500], [-250, 2100]],
  // 中央通り (神田〜秋葉原〜上野)
  [[1230, -300], [1230, -700], [1240, -1250], [1270, -1600]],
  // 白山通り
  [[548, -1099], [300, -1800], [-28, -2600]],
  // 本郷通り
  [[900, -1000], [816, -1394], [304, -2700]],
  // 目白通り
  [[-1373, -2058], [-296, -1374], [203, -1104]],
  // 六本木通り
  [[380, 250], [-365, 859], [-1480, 1050]],
  // 外苑東通り
  [[-398, -310], [-365, 859], [-300, 1500]],
  // 日比谷通り〜第一京浜
  [[860, -600], [760, 300], [550, 1000], [200, 1700], [0, 2300]],
  // 目黒通り
  [[-986, 2298], [-556, 2098], [-200, 2100]],
  // 早稲田通り / 春日通り
  [[-1440, -1560], [-700, -1300], [0, -1500], [700, -1600], [1250, -1500]],
  // 内堀通り (around the palace)
  [[210, -620], [760, -620], [760, 20], [210, 20], [210, -620]],
];
const nearRoad = (x: number, z: number, pad: number) => ROADS.some((r) => r.some((p, i) => i > 0 && segDist(x, z, { x: r[i - 1][0], z: r[i - 1][1] }, { x: p[0], z: p[1] }) < pad));

// ---------------------------------------------------------------- nation bases and jails (reserved here; defined in nations.ts)
/** Base centres (must match config/nations.ts). */
export const BASE_SITES = {
  sun: geo(35.6905, 139.7050), // 新宿三丁目
  moon: geo(35.7075, 139.7710), // 上野広小路
  star: geo(35.6340, 139.7330), // 高輪
};
export const JAIL_SITES = {
  sun: { x: BASE_SITES.sun.x + 20, z: BASE_SITES.sun.z - 230 },
  moon: { x: BASE_SITES.moon.x - 140, z: BASE_SITES.moon.z + 210 },
  star: { x: BASE_SITES.star.x, z: BASE_SITES.star.z + 210 },
};
for (const k of ['sun', 'moon', 'star'] as const) {
  reserve(BASE_SITES[k].x, BASE_SITES[k].z, 260, 260, 20);
  reserve(JAIL_SITES[k].x, JAIL_SITES[k].z, 240, 60, 60);
}

// ---------------------------------------------------------------- the city (procedural blocks)
/** Deterministic PRNG so the city is the same every load. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Business districts get towers; elsewhere mid-rise and low-rise. */
const DISTRICTS: { p: Point; r: number; min: number; max: number }[] = [
  { p: geo(35.6905, 139.7020), r: 380, min: 90, max: 190 }, // 新宿
  { p: geo(35.6590, 139.7036), r: 300, min: 80, max: 170 }, // 渋谷
  { p: geo(35.6860, 139.7640), r: 320, min: 110, max: 200 }, // 丸の内・大手町
  { p: geo(35.6630, 139.7300), r: 350, min: 80, max: 180 }, // 六本木
  { p: geo(35.6300, 139.7380), r: 300, min: 80, max: 160 }, // 品川
  { p: geo(35.7290, 139.7150), r: 300, min: 70, max: 150 }, // 池袋
  { p: geo(35.6990, 139.7715), r: 250, min: 60, max: 110 }, // 秋葉原
];
{
  const rnd = prng(20251);
  const PITCH = 210, STREET = 56;
  const blocked = (x0: number, z0: number, x1: number, z1: number) =>
    keepOut.some((k) => x0 < k.x1 && x1 > k.x0 && z0 < k.z1 && z1 > k.z0)
    || ![[x0, z0], [x1, z0], [x0, z1], [x1, z1]].every(([x, z]) => insideLoop(x, z, 90))
    || nearRoad((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2 + 40);
  for (let cx = BOUNDS.minX + PITCH / 2; cx < BOUNDS.maxX; cx += PITCH) {
    for (let cz = BOUNDS.minZ + PITCH / 2; cz < BOUNDS.maxZ; cz += PITCH) {
      const inner = PITCH - STREET;
      // Split the block into 1–4 lots.
      const split = rnd();
      const lots: [number, number, number, number][] =
        split < 0.3 ? [[cx, cz, inner, inner]]
          : split < 0.65 ? [[cx - inner / 4 - 4, cz, inner / 2 - 8, inner], [cx + inner / 4 + 4, cz, inner / 2 - 8, inner]]
            : [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [cx + sx * (inner / 4 + 4), cz + sz * (inner / 4 + 4), inner / 2 - 8, inner / 2 - 8] as [number, number, number, number]);
      const d = DISTRICTS.find((q) => Math.hypot(cx - q.p.x, cz - q.p.z) < q.r);
      for (const [x, z, w, dd] of lots) {
        if (blocked(x - w / 2, z - dd / 2, x + w / 2, z + dd / 2)) continue;
        if (rnd() < 0.12) continue; // open lot / small square
        const h = d ? d.min + rnd() * (d.max - d.min) : 34 + rnd() * rnd() * 90;
        box(x, z, w, dd, Math.round(h), d && h > 100 ? 'glass' : 'concrete', { group: 'city' });
      }
    }
  }
}

export const WORLD: readonly Prim[] = prims;

/** Green and gravel areas painted on the ground (decoration). */
export const PARKS: readonly { x: number; z: number; w: number; d: number; kind: 'park' | 'gravel' }[] = [
  { x: PALACE_PLAZA.x, z: PALACE_PLAZA.z, w: PALACE_PLAZA.w + 40, d: PALACE_PLAZA.d + 40, kind: 'gravel' },
  { x: TOWER.x, z: TOWER.z, w: PLAZA.r * 2, d: PLAZA.r * 2, kind: 'park' },
  { x: GYOEN.x, z: GYOEN.z, w: 320, d: 220, kind: 'park' },
  { x: STADIUM.x, z: STADIUM.z, w: 150, d: 120, kind: 'park' },
  { x: UENO_HILL.x, z: UENO_HILL.z + 60, w: 320, d: 320, kind: 'park' },
  { ...geo(35.7321, 139.7465), w: 260, d: 200, kind: 'park' },
  { x: ATAGO.x, z: ATAGO.z, w: 200, d: 170, kind: 'park' },
  { x: TOKYO_TOWER.x, z: TOKYO_TOWER.z + 60, w: 180, d: 260, kind: 'gravel' },
];

/** Landmarks the renderer decorates (spires, domes, roofs) — positions only. */
export const LANDMARKS = {
  tokyoTower: TOKYO_TOWER,
  tokyoStation: { x: geo(35.6812, 139.7671).x - 80, z: geo(35.6812, 139.7671).z },
  diet: geo(35.6759, 139.7449),
  dome: DOME,
};

// ---------------------------------------------------------------- AI hints

/** Places patrols and searches gravitate to, so encounters happen across the city. */
export const HOTSPOTS: readonly (Point & { name: string; weight: number })[] = [
  { name: '日比谷公園（管制塔）', ...geo(35.6736, 139.7564), weight: 4 },
  { name: '皇居前広場', x: PALACE_PLAZA.x, z: PALACE_PLAZA.z, weight: 3 },
  { name: '国会議事堂', ...geo(35.6745, 139.7449), weight: 2 },
  { name: '東京タワー', x: TOKYO_TOWER.x, z: TOKYO_TOWER.z + 120, weight: 3 },
  { name: '六本木', ...geo(35.6628, 139.7310), weight: 2 },
  { name: '国立競技場', x: STADIUM.x, z: STADIUM.z + 20, weight: 2 },
  { name: '新宿御苑', x: GYOEN.x, z: GYOEN.z, weight: 2 },
  { name: '東京ドーム', x: DOME.x, z: DOME.z + 120, weight: 2 },
  { name: '聖橋', x: 1000, z: riverZAt(1000) - 120, weight: 2 },
  { name: '飯田橋', x: 180, z: riverZAt(180) + 100, weight: 2 },
  { name: '江戸川橋', x: -300, z: riverZAt(-300) + 100, weight: 1 },
  { name: '秋葉原', ...geo(35.6993, 139.7700), weight: 2 },
  { name: '池袋', ...geo(35.7280, 139.7150), weight: 1 },
  { name: '渋谷', ...geo(35.6600, 139.7050), weight: 2 },
  { name: '愛宕山', x: ATAGO.x - 150, z: ATAGO.z, weight: 1 },
  { name: '恵比寿', ...geo(35.6440, 139.7150), weight: 1 },
];

/** High places snipers hold (stand points on the walkable tops). */
export const PERCHES: readonly (Point & { y: number })[] = [
  { x: TOKYO_TOWER.x, y: UPPER, z: TOKYO_TOWER.z },
  { x: ATAGO.x, y: 28, z: ATAGO.z },
  { x: UENO_HILL.x + 60, y: UENO_HILL.top, z: UENO_HILL.z + 40 },
  { x: PALACE.x - 60, y: PALACE.top + 22, z: PALACE.z - 170 },
  { x: -150, y: UPPER, z: 190 },
  { x: -350, y: UPPER, z: -2170 },
  { x: STADIUM.x, y: 30, z: STADIUM.z - 85 + 15 },
  { x: WALKUP_KABUKI.terrace.x, y: UPPER, z: WALKUP_KABUKI.terrace.z },
];

/**
 * Named reference points (used by tests and debugging), all derived from the
 * geometry above so they stay valid if the layout changes.
 */
export const SITES = {
  /** Open, flat ground with nothing solid within ~120 units (皇居前広場). */
  open: { x: PALACE_PLAZA.x, z: PALACE_PLAZA.z },
  /** 2F building: stair foot (on the first step), 2F terrace, and a ground-floor spot under the 2F slab. */
  walkup: WALKUP_KABUKI,
  /** Tokyo Tower stairs: a point on the stairs half way up, and the deck. */
  towerStairsMid: { x: TOKYO_TOWER.x, z: TOKYO_TOWER.z + 38 + 70, y: 32 },
  towerDeck: { x: TOKYO_TOWER.x, y: UPPER, z: TOKYO_TOWER.z },
  /** 上野の山: foot of the south slope (walk north to climb), the top, and a cliff foot to the north. */
  hillSlopeFoot: { x: UENO_HILL.x + 50, z: UENO_HILL.z + UENO_HILL.d / 2 + 110 },
  hillTop: { x: UENO_HILL.x + 20, y: UENO_HILL.top, z: UENO_HILL.z + 20 },
  hillCliffFoot: { x: UENO_HILL.x + 60, z: UENO_HILL.z - UENO_HILL.d / 2 - 40 },
  /** 愛宕山 stone stairs: a point half way up (the stairs rise westward). */
  atagoStairsMid: { x: ATAGO.x + 65 + 28, z: ATAGO.z, y: 14 },
  /** Expressway: a street point west of the deck (walk east to pass under it) and a deck point. */
  underExpressway: { x: -270, z: 250 },
  expresswayDeck: { x: -150, y: UPPER, z: 190 },
  /** Arcade: just outside the south door (walk north through it). */
  arcadeSouth: { x: ARCADE.x, z: ARCADE.z + ARCADE.d / 2 + 30 },
  arcadeNorthEnd: ARCADE.z - ARCADE.d / 2,
  /** 聖橋 (arched): south approach (walk north to cross); and a river bank point away from bridges. */
  bridgeSouth: { x: 1000, z: riverZAt(1000) + 150 },
  riverBank: { x: 800, z: riverZAt(800) + 80 },
  riverZ: riverZAt,
  /** Palace: a point on the island top and a point in front of the keep stairs. */
  palaceTop: { x: PALACE.x + 100, y: PALACE.top, z: PALACE.z + 150 },
  /** 国会議事堂 (50 high, tower in the middle): points north and south of it, off the tower's line. */
  dietNorth: { x: geo(35.6759, 139.7449).x + 50, z: geo(35.6759, 139.7449).z - 45 },
  dietSouth: { x: geo(35.6759, 139.7449).x + 50, z: geo(35.6759, 139.7449).z + 80 },
  /** 上野 stone stairs (rise eastward): a point half way up. */
  uenoStairsMid: { x: UENO_HILL.x - UENO_HILL.w / 2 - 25, z: UENO_HILL.z - 40, y: 12 },
  /** 聖橋 south slope, half way up. */
  bridgeSlopeMid: { x: 1000, z: riverZAt(1000) + 75, y: 12 },
};
