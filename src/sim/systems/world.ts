import type { Prim, RampPrim } from '../../config/map';
import { BOUNDS, WORLD } from '../../config/map';
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
  if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) return true;
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

/** 3D line of sight, sampled every ~18 units. */
export function lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(2, Math.ceil(len / 18));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (solidAt(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)) return false;
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

/**
 * Snaps up onto the floor underfoot (stairs and slopes rise smoothly) or falls
 * toward a lower one. Pass dt = Infinity to land instantly.
 */
export function settle(b: Body, dt: number): void {
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
