import type { Point } from '../../config/nations';
import type { Obstacle } from '../../config/map';
import { BOUNDS, OBST } from '../../config/map';
import { CR } from '../../config/constants';

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function rectHit(x: number, z: number, r: number, o: Obstacle): boolean {
  return x + r > o.x - o.w / 2 && x - r < o.x + o.w / 2 && z + r > o.z - o.d / 2 && z - r < o.z + o.d / 2;
}

export function anyHit(x: number, z: number, r: number): boolean {
  for (const o of OBST) if (rectHit(x, z, r, o)) return true;
  return false;
}

/** Sampled 2D line-of-sight test against obstacles. */
export function lineClear(x1: number, z1: number, x2: number, z2: number): boolean {
  const steps = 12;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (anyHit(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, 2)) return false;
  }
  return true;
}

/** Moves toward (nx, nz), clamped to the map and sliding along obstacles per axis. */
export function clampMove(e: Point, nx: number, nz: number): void {
  const x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, nx));
  const z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, nz));
  if (!anyHit(x, e.z, CR)) e.x = x;
  if (!anyHit(e.x, z, CR)) e.z = z;
}
