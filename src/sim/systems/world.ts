import type { Prim, RampPrim } from '../../config/map';
import { BOUNDS, WORLD, insideLoop } from '../../config/map';
import { CR } from '../../config/constants';

/** Highest ledge a character can walk up without stairs. */
export const STEP_UP = 12;
/** Height of a character's body, for head clearance under floors. */
export const BODY_H = 50;
/** Eye and chest heights above the feet, for line of sight. */
export const EYE_H = 40;
export const CHEST_H = 28;
/** Speed of dropping off a ledge (units/s). */
export const FALL_SPEED = 520;

// ---------------------------------------------------------------- spatial grid
const CELL = 100;
const COLS = Math.ceil((BOUNDS.maxX - BOUNDS.minX + 400) / CELL);
const ROWS = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ + 400) / CELL);
const OX = BOUNDS.minX - 200, OZ = BOUNDS.minZ - 200;
const grid: number[][] = Array.from({ length: COLS * ROWS }, () => []);
const cellOf = (x: number, z: number) => [Math.floor((x - OX) / CELL), Math.floor((z - OZ) / CELL)];
WORLD.forEach((p, i) => {
  const [c0, r0] = cellOf(p.x - p.w / 2, p.z - p.d / 2), [c1, r1] = cellOf(p.x + p.w / 2, p.z + p.d / 2);
  for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) {
    for (let r = Math.max(0, r0); r <= Math.min(ROWS - 1, r1); r++) grid[r * COLS + c].push(i);
  }
});
let stamp = 0;
const seen = new Uint32Array(WORLD.length);

/** Primitives whose footprint may overlap the given rectangle. */
function near(x0: number, z0: number, x1: number, z1: number, out: Prim[]): Prim[] {
  out.length = 0;
  stamp++;
  const [c0, r0] = cellOf(x0, z0), [c1, r1] = cellOf(x1, z1);
  for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) {
    for (let r = Math.max(0, r0); r <= Math.min(ROWS - 1, r1); r++) {
      for (const i of grid[r * COLS + c]) if (seen[i] !== stamp) { seen[i] = stamp; out.push(WORLD[i]); }
    }
  }
  return out;
}
const scratch: Prim[] = [];

/** Primitives whose footprint may contain the point (x, z) (a fresh array). */
export function primsAt(x: number, z: number): Prim[] {
  return [...near(x, z, x, z, scratch)];
}

// ---------------------------------------------------------------- primitive geometry
export function rampHeight(p: RampPrim, x: number, z: number): number {
  const len = p.axis === 'x' ? p.w : p.d;
  const u = ((p.axis === 'x' ? x - p.x : z - p.z) / len) + 0.5;
  const t = Math.min(1, Math.max(0, p.dir === 1 ? u : 1 - u));
  return p.hLow + (p.hHigh - p.hLow) * t;
}

function inside(p: Prim, x: number, z: number): boolean {
  return Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.z) < p.d / 2;
}

/** Standing support includes the rim, so floors that meet edge to edge have no seam to fall through. */
function underfoot(p: Prim, x: number, z: number): boolean {
  return Math.abs(x - p.x) <= p.w / 2 + 0.5 && Math.abs(z - p.z) <= p.d / 2 + 0.5;
}

/** Top surface height of a primitive at (x, z). */
export function topAt(p: Prim, x: number, z: number): number {
  return p.kind === 'box' ? p.y1 : rampHeight(p, x, z);
}

/** Highest top a circle of radius r overlapping the primitive would touch. */
function topOverCircle(p: Prim, x: number, z: number, r: number): number {
  if (p.kind === 'box') return p.y1;
  // Sample the up-slope edge of the circle, clamped into the ramp.
  const ux = p.axis === 'x' ? p.dir * r : 0, uz = p.axis === 'z' ? p.dir * r : 0;
  const cx = Math.min(p.x + p.w / 2, Math.max(p.x - p.w / 2, x + ux));
  const cz = Math.min(p.z + p.d / 2, Math.max(p.z - p.d / 2, z + uz));
  return rampHeight(p, cx, cz);
}

// ---------------------------------------------------------------- queries

/**
 * Height a character standing at (x, z) with feet at `y` rests on: the highest
 * floor under that point it can reach (no higher than y + STEP_UP). Ground is 0.
 */
export function supportHeight(x: number, z: number, y: number): number {
  let best = 0;
  for (const p of near(x, z, x, z, scratch)) {
    if (p.noFloor || !underfoot(p, x, z)) continue;
    const t = topAt(p, x, z);
    if (t <= y + STEP_UP && t > best) best = t;
  }
  return best;
}

/** Whether a character at (x, y, z) would intersect a wall, parapet, cliff or water. */
export function blocked(x: number, z: number, y: number, r = CR): boolean {
  if (!insideLoop(x, z, r + 26)) return true; // the Yamanote tracks are the edge of the world
  for (const p of near(x - r, z - r, x + r, z + r, scratch)) {
    if (Math.abs(x - p.x) >= p.w / 2 + r || Math.abs(z - p.z) >= p.d / 2 + r) continue;
    if (p.y0 >= y + BODY_H) continue; // overhead: walk underneath
    if (topOverCircle(p, x, z, r) > y + STEP_UP) return true;
  }
  return false;
}

/** Point inside solid, sight-blocking matter (walls, floors, hills; not water). */
export function solidAt(x: number, y: number, z: number): boolean {
  for (const p of near(x, z, x, z, scratch)) {
    if (p.seeThrough || !inside(p, x, z)) continue;
    if (y > p.y0 && y < topAt(p, x, z)) return true;
  }
  return false;
}

/** Does the segment a→b pass through the box's interior (slab test)? */
function segmentHitsBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, p: Prim, y1: number): boolean {
  let t0 = 0, t1 = 1;
  const axes: [number, number, number, number][] = [
    [ax, bx - ax, p.x - p.w / 2, p.x + p.w / 2],
    [ay, by - ay, p.y0, y1],
    [az, bz - az, p.z - p.d / 2, p.z + p.d / 2],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o <= lo || o >= hi) return false;
      continue;
    }
    let ta = (lo - o) / d, tb = (hi - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 >= t1) return false;
  }
  return true;
}

const losScratch: Prim[] = [];

/**
 * 3D line of sight. Boxes (walls, floors, buildings) are tested exactly, so
 * even a thin floor slab blocks; ramps are sampled finely.
 */
export function lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const cand = near(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), losScratch);
  let ramps = false;
  for (const p of cand) {
    if (p.seeThrough) continue;
    if (p.kind === 'ramp') { ramps = true; continue; }
    if (segmentHitsBox(ax, ay, az, bx, by, bz, p, p.y1)) return false;
  }
  if (!ramps) return true;
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(2, Math.ceil(len / 8));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
    for (const p of cand) {
      if (p.kind !== 'ramp' || !inside(p, x, z)) continue;
      if (y > p.y0 && y < rampHeight(p, x, z)) return false;
    }
  }
  return true;
}

export interface Body {
  x: number;
  y: number;
  z: number;
}

/**
 * Moves a body toward (nx, nz): X then Z separately so it slides along walls
 * (the v6 feel), stepping up stairs/slopes. Vertical settling is separate.
 */
export function moveBody(b: Body, nx: number, nz: number): void {
  if (!blocked(nx, b.z, b.y)) b.x = nx;
  if (!blocked(b.x, nz, b.y)) b.z = nz;
}

/** The blocking primitive a body at (x, y, z) overlaps, if any (same rule as `blocked`). */
function blockingPrim(x: number, z: number, y: number, r: number): Prim | null {
  for (const p of near(x - r, z - r, x + r, z + r, scratch)) {
    if (Math.abs(x - p.x) >= p.w / 2 + r || Math.abs(z - p.z) >= p.d / 2 + r) continue;
    if (p.y0 >= y + BODY_H) continue;
    if (topOverCircle(p, x, z, r) > y + STEP_UP) return p;
  }
  return null;
}

/**
 * If a body ended up overlapping a wall (dropped off the side of stairs,
 * shoved by separation, teleported), push it out to the nearest free side.
 * Without this every move from inside counts as blocked and the body freezes.
 */
export function pushOut(b: Body, r = CR): void {
  for (let iter = 0; iter < 4; iter++) {
    const p = blockingPrim(b.x, b.z, b.y, r);
    if (!p) return;
    const hw = p.w / 2, hd = p.d / 2;
    const cx = Math.max(p.x - hw, Math.min(p.x + hw, b.x)), cz = Math.max(p.z - hd, Math.min(p.z + hd, b.z));
    let dx = b.x - cx, dz = b.z - cz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) {
      // Centre outside the footprint: move straight away from the closest point.
      dx /= d; dz /= d;
      b.x = cx + dx * (r + 0.05);
      b.z = cz + dz * (r + 0.05);
    } else {
      // Centre inside: leave through the nearest edge.
      const ex = [p.x - hw - r - 0.05 - b.x, p.x + hw + r + 0.05 - b.x], ez = [p.z - hd - r - 0.05 - b.z, p.z + hd + r + 0.05 - b.z];
      const opts = [[ex[0], 0], [ex[1], 0], [0, ez[0]], [0, ez[1]]].sort((u, v) => Math.hypot(u[0], u[1]) - Math.hypot(v[0], v[1]));
      b.x += opts[0][0];
      b.z += opts[0][1];
    }
  }
}

/**
 * Snaps up onto the floor underfoot (stairs and slopes rise smoothly) or falls
 * toward a lower one. Pass dt = Infinity to land instantly.
 */
export function settle(b: Body, dt: number): void {
  pushOut(b);
  const s = supportHeight(b.x, b.z, b.y);
  if (s >= b.y) b.y = s;
  else b.y = Math.max(s, b.y - FALL_SPEED * dt);
}

/** Floor height for placing a character at (x, z) from above (spawns, jails, teleports). */
export function groundAt(x: number, z: number, fromY = 0): number {
  return supportHeight(x, z, fromY);
}

/**
 * Simulates walking in a straight line (used for nav edges and shortcuts).
 * Returns where the walker ended up.
 */
export function walkLine(from: Body, tx: number, tz: number, step = 8): Body {
  const b = { ...from };
  const len = Math.hypot(tx - b.x, tz - b.z);
  const n = Math.max(1, Math.ceil(len / step));
  const sx = (tx - from.x) / n, sz = (tz - from.z) / n;
  for (let i = 0; i < n; i++) {
    moveBody(b, b.x + sx, b.z + sz);
    settle(b, Infinity);
  }
  return b;
}

/** True if walking straight from `from` reaches (tx, ty, tz). */
export function canWalk(from: Body, tx: number, ty: number, tz: number): boolean {
  const end = walkLine(from, tx, tz);
  return Math.hypot(end.x - tx, end.z - tz) < 3 && Math.abs(end.y - ty) < 6;
}
