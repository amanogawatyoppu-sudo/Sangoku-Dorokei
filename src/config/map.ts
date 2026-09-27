import type { Point } from './nations';

/**
 * v7.3 battlefield: roughly twice v7.2's size (4000 x 2500) with real height.
 *
 * The world is built from two kinds of solid primitive:
 * - box:  an axis-aligned block from y0 to y1. Its top is a floor you can stand on.
 * - ramp: a block whose top rises linearly along one axis (stairs and slopes).
 * Everything that walks, sees or aims asks these primitives (see sim/systems/world.ts),
 * so floors, bridges, rooftops and hills are real terrain, not decoration.
 *
 *              ┌──────────── 星国拠点 / 牢屋 ────────────┐
 *        西の高台 ── 中央街 (2階建て・空中回廊・通り抜け) ── 東の高台
 *              │               管制塔               │
 *      ════════╪══ 西橋 ═══ 中央の太鼓橋 ═══ 東橋 ══╪════  川（両端は陸路）
 *   見張り台   │              中央広場               │   見張り台
 *   太陽国拠点 ─────────────── 南街道 ─────────────── 月国拠点
 *   太陽の牢屋                                      月の牢屋
 */

export interface Circle extends Point {
  r: number;
}

export type Material = 'stone' | 'plaster' | 'wood' | 'roof' | 'earth' | 'water' | 'hedge';

interface PrimBase {
  /** Centre and footprint on the ground plane. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Bottom of the solid. */
  y0: number;
  mat: Material;
  /** Line of sight passes through (water). Default: blocks. */
  seeThrough?: boolean;
  /** The top is not a floor (water). Default: walkable. */
  noFloor?: boolean;
  /** Group id for rendering related parts together (e.g. one building). */
  group?: string;
}

export interface BoxPrim extends PrimBase {
  kind: 'box';
  y1: number;
}

export interface RampPrim extends PrimBase {
  kind: 'ramp';
  /** Surface height at the low and high ends. */
  hLow: number;
  hHigh: number;
  /** Axis the surface rises along, and which way (+1: towards +axis). */
  axis: 'x' | 'z';
  dir: 1 | -1;
  /** Rendered as steps (stairs) or a smooth slope. */
  style: 'stairs' | 'slope';
}

export type Prim = BoxPrim | RampPrim;

/** Walkable area (movement is clamped to this). */
export const BOUNDS = { minX: -2000, maxX: 2000, minZ: -1250, maxZ: 1250 };
/** Size of the painted ground plane (a margin of forest around the bounds). */
export const GROUND = { w: 4400, d: 2900 };

/** Floor height of second storeys, rooftops, skyways and watch platforms. */
export const UPPER = 64;
const SLAB = 6;

export const TOWER: Circle = { x: 0, z: -180, r: 80 };
export const PLAZA: Circle = { x: 0, z: 520, r: 230 };
export const RIVER = { minX: -1700, maxX: 1700, z: 220, d: 100 };

const prims: Prim[] = [];
const box = (x: number, z: number, w: number, d: number, y1: number, mat: Material, extra: Partial<BoxPrim> = {}) =>
  prims.push({ kind: 'box', x, z, w, d, y0: 0, y1, mat, ...extra });
const ramp = (
  x: number, z: number, w: number, d: number, axis: 'x' | 'z', dir: 1 | -1, hLow: number, hHigh: number,
  style: 'stairs' | 'slope', mat: Material = style === 'stairs' ? 'wood' : 'earth', group?: string,
) => prims.push({ kind: 'ramp', x, z, w, d, y0: 0, axis, dir, hLow, hHigh, style, mat, group });

/** A floor slab at `top` (bottom at top - SLAB). */
const slab = (x: number, z: number, w: number, d: number, top: number, mat: Material, group?: string) =>
  box(x, z, w, d, top, mat, { y0: top - SLAB, group });

type Side = 'n' | 's' | 'e' | 'w';

/**
 * A walled building. Ground-floor walls stop under the upper slab; doors are
 * full-height gaps. `upper` adds a walkable second floor / roof terrace with
 * low parapets (gaps where skyways join). `hole` leaves a stairwell open.
 */
function building(
  id: string, cx: number, cz: number, w: number, d: number,
  doors: { side: Side; at: number; width: number }[],
  upper: { parapetGaps?: { side: Side; at: number; width: number }[]; hole?: { x0: number; x1: number; z0: number; z1: number } } | null,
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
        if (horizontal) box(mid, fixed, span, T, y1, 'plaster', { y0, group: id });
        else box(fixed, mid, T, span, y1, 'plaster', { y0, group: id });
      }
      a = Math.max(a, g1);
    }
  };
  for (const side of ['n', 's', 'e', 'w'] as Side[]) wallSide(side, 0, H, doors.filter((dr) => dr.side === side));
  // Upper slab (roof or second floor), leaving an optional stairwell hole.
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
  if (upper) {
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      wallSide(side, UPPER, UPPER + 14, (upper.parapetGaps ?? []).filter((g) => g.side === side));
    }
  } else {
    // Plain house: pitched-roof look comes from the renderer; the flat top is still walkable.
  }
}

// ---------------------------------------------------------------- 中央街 (town)
// West hall: two storeys, interior stairs rising west → east, doors south and east.
building('hallW', -380, -600, 200, 150,
  [{ side: 's', at: 30, width: 70 }, { side: 'e', at: 30, width: 70 }, { side: 'w', at: -20, width: 60 }],
  { parapetGaps: [{ side: 'e', at: -30, width: 60 }], hole: { x0: -480, x1: -340, z0: -675, z1: -615 } });
ramp(-405, -640, 130, 50, 'x', 1, 0, UPPER, 'stairs', 'wood', 'hallW');
// East hall mirrors it.
building('hallE', 380, -600, 200, 150,
  [{ side: 's', at: -30, width: 70 }, { side: 'w', at: 30, width: 70 }, { side: 'e', at: -20, width: 60 }],
  { parapetGaps: [{ side: 'w', at: -30, width: 60 }], hole: { x0: 340, x1: 480, z0: -675, z1: -615 } });
ramp(405, -640, 130, 50, 'x', -1, 0, UPPER, 'stairs', 'wood', 'hallE');
// Centre hall: walk straight through (north / south doors); its roof is a terrace.
building('hallC', 0, -600, 180, 130,
  [{ side: 'n', at: -40, width: 64 }, { side: 's', at: -40, width: 64 }], null);
// Outside stairs to the centre roof, along its south wall.
ramp(45, -510, 90, 50, 'x', -1, 0, UPPER, 'stairs', 'wood', 'hallC');
// Skyways join the three roofs over the alleys (walk underneath too).
slab(-185, -630, 190, 56, UPPER, 'wood', 'skyW');
slab(185, -630, 190, 56, UPPER, 'wood', 'skyE');
// Small houses make the back alleys.
box(-560, -455, 100, 80, 50, 'plaster', { group: 'house' });
box(560, -455, 100, 80, 50, 'plaster', { group: 'house' });
box(-210, -440, 90, 60, 46, 'plaster', { group: 'house' });
box(210, -440, 90, 60, 46, 'plaster', { group: 'house' });
box(-600, -720, 70, 110, 50, 'plaster', { group: 'house' });
box(600, -720, 70, 110, 50, 'plaster', { group: 'house' });

// ---------------------------------------------------------------- 管制塔 and surroundings
box(TOWER.x, TOWER.z, 46, 46, 130, 'stone', { group: 'tower' });
box(-230, -190, 40, 170, 55, 'stone');
box(230, -190, 40, 170, 55, 'stone');
box(-110, -350, 150, 36, 55, 'stone');
box(110, -350, 150, 36, 55, 'stone');

// ---------------------------------------------------------------- 高台 (plateaus west / east of town)
for (const s of [-1, 1] as const) {
  const px = 1150 * s;
  box(px, -520, 320, 260, 44, 'earth', { group: 'plateau' });
  // Wide slope from the south (the easy way up)…
  ramp(px, -330, 90, 120, 'z', -1, 0, 44, 'slope');
  // …and narrow stairs from the town side.
  ramp(px - 205 * s, -560, 90, 50, 'x', s, 0, 44, 'stairs', 'stone');
  // Low stone parapet on the outer edge gives snipers cover.
  box(px + 150 * s, -520, 16, 200, 58, 'stone', { y0: 44 });
}
export const SNIPE: readonly Circle[] = [
  { x: -1150, z: -540, r: 140 },
  { x: 1150, z: -540, r: 140 },
];

// ---------------------------------------------------------------- 見張り台 (watch platforms)
function watchtower(x: number, z: number, stairAxis: 'x' | 'z', dir: 1 | -1): void {
  const S = 70;
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(x + ox * (S / 2 - 5), z + oz * (S / 2 - 5), 10, 10, UPPER, 'wood', { group: 'watch' });
  slab(x, z, S, S, UPPER, 'wood', 'watch');
  box(x, z - S / 2 + 2, S, 4, UPPER + 12, 'wood', { y0: UPPER, group: 'watch' });
  const run = 130;
  if (stairAxis === 'z') ramp(x, z - dir * (S / 2 + run / 2), 44, run, 'z', dir, 0, UPPER, 'stairs', 'wood', 'watch');
  else ramp(x - dir * (S / 2 + run / 2), z, run, 44, 'x', dir, 0, UPPER, 'stairs', 'wood', 'watch');
}
watchtower(-1180, 620, 'x', 1);
watchtower(1180, 620, 'x', -1);
watchtower(420, -930, 'z', -1);

// ---------------------------------------------------------------- 城壁 (wall walk north-west of the star base)
box(-500, -900, 400, 40, 44, 'stone', { group: 'wallwalk' });
ramp(-760, -900, 120, 40, 'x', 1, 0, 44, 'stairs', 'stone', 'wallwalk');

// ---------------------------------------------------------------- 川 and bridges
prims.push({ kind: 'box', x: 0, z: RIVER.z, w: RIVER.maxX - RIVER.minX, d: RIVER.d, y0: -20, y1: 16, mat: 'water', seeThrough: true, noFloor: true });
// Central arched bridge: wide, direct, and exposed.
ramp(0, RIVER.z - RIVER.d / 2 - 50, 150, 100, 'z', 1, 0, 26, 'slope', 'stone', 'bridgeC');
box(0, RIVER.z, 150, RIVER.d + 4, 26, 'stone', { y0: 14, group: 'bridgeC' });
ramp(0, RIVER.z + RIVER.d / 2 + 50, 150, 100, 'z', -1, 0, 26, 'slope', 'stone', 'bridgeC');
// Narrow side bridges: low wooden decks (step up 8).
for (const bx of [-1000, 1000]) box(bx, RIVER.z, 70, RIVER.d + 24, 8, 'wood', { y0: 0, group: 'bridgeS' });

// ---------------------------------------------------------------- 中央広場
box(PLAZA.x, PLAZA.z, 60, 60, 20, 'stone', { group: 'fountain' });
for (const s of [-1, 1]) {
  box(330 * s, 400, 60, 150, 50, 'hedge');
  box(330 * s, 660, 60, 150, 50, 'hedge');
}

// ---------------------------------------------------------------- fields and cover
for (const s of [-1, 1]) {
  box(800 * s, 640, 220, 50, 50, 'stone');
  box(900 * s, 960, 60, 220, 50, 'stone');
  box(420 * s, 960, 220, 50, 50, 'stone');
  box(700 * s, -230, 60, 240, 55, 'stone');
  box(1500 * s, -300, 240, 60, 50, 'stone');
  box(1560 * s, 560, 260, 40, 50, 'stone'); // wall shielding each southern base
  box(1400 * s, 30, 60, 200, 50, 'hedge');
  box(650 * s, -950, 200, 50, 50, 'stone');
  // 狭い裏道: a walled lane along each side edge.
  box(1880 * s, -150, 30, 900, 60, 'stone');
  box(1790 * s, -150, 30, 900, 60, 'stone');
}
box(0, -860, 300, 40, 50, 'stone'); // in front of the star base

export const WORLD: readonly Prim[] = prims;

/**
 * Places AI patrols and searches gravitate to, so the larger map still
 * produces encounters (bridges, plaza, tower, town, stairs, high ground).
 */
export const HOTSPOTS: readonly (Point & { name: string; weight: number })[] = [
  { name: '中央広場', x: 0, z: 520, weight: 4 },
  { name: '管制塔', x: 0, z: -80, weight: 4 },
  { name: '中央の太鼓橋', x: 0, z: 90, weight: 3 },
  { name: '西橋', x: -1000, z: 110, weight: 2 },
  { name: '東橋', x: 1000, z: 110, weight: 2 },
  { name: '中央街', x: 0, z: -470, weight: 3 },
  { name: '西の高台', x: -1150, z: -330, weight: 2 },
  { name: '東の高台', x: 1150, z: -330, weight: 2 },
  { name: '南街道', x: -700, z: 780, weight: 2 },
  { name: '南街道', x: 700, z: 780, weight: 2 },
  { name: '北西の城壁', x: -500, z: -960, weight: 1 },
];

/** Dirt roads painted on the ground and minimap (decoration; AI uses the nav graph). */
export const ROADS: readonly (readonly [number, number])[][] = [
  [[-1560, 780], [-900, 780], [-300, 700], [0, 520], [300, 700], [900, 780], [1560, 780]],
  [[0, 520], [0, 60], [0, -100]],
  [[0, -260], [-40, -420], [-40, -760], [0, -1020]],
  [[-1560, 780], [-1300, 400], [-1000, 60], [-1000, -330], [-1150, -380]],
  [[1560, 780], [1300, 400], [1000, 60], [1000, -330], [1150, -380]],
  [[-1000, 60], [-500, 0], [0, -100], [500, 0], [1000, 60]],
  [[0, -1020], [-800, -1000], [-1150, -700]],
  [[0, -1020], [800, -1000], [1150, -700]],
  [[-1560, 780], [-1840, 400], [-1840, -700], [-1150, -1000]],
  [[1560, 780], [1840, 400], [1840, -700], [1150, -1000]],
];
