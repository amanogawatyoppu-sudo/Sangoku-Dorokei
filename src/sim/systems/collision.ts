import type { Point } from '../../config/nations';

/** Distance on the ground plane (ignores height). */
export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Full 3D distance between two characters' feet. */
export function dist3(a: Point & { y: number }, b: Point & { y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Largest height difference at which two characters count as on the same level. */
export const SAME_LEVEL = 30;

export function sameLevel(a: { y: number }, b: { y: number }): boolean {
  return Math.abs(a.y - b.y) <= SAME_LEVEL;
}
