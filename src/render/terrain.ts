import { SNIPE } from '../config/map';

/** Height of the sniper hills' flat top (v6 drew snipers at y=24). */
export const HILL_HEIGHT = 24;
/** Fraction of a hill's radius that is flat on top; the rest is slope. */
export const HILL_TOP = 0.72;

/**
 * Visual ground height. Only the two sniper hills are raised; gameplay stays
 * on the flat XZ plane, so this is purely where models are drawn.
 */
export function heightAt(x: number, z: number): number {
  for (const h of SNIPE) {
    const d = Math.hypot(x - h.x, z - h.z);
    if (d <= h.r * HILL_TOP) return HILL_HEIGHT;
    if (d < h.r) return HILL_HEIGHT * (1 - (d - h.r * HILL_TOP) / (h.r * (1 - HILL_TOP)));
  }
  return 0;
}
