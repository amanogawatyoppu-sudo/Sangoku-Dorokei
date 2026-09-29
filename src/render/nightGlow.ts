/** City lights that brighten after dark: each registers how to set itself for night k (0 dusk … 1 night). */
export const NIGHT_GLOW: { set: (k: number) => void }[] = [];

/** Registers a material whose emissive glow goes from `dusk` to `night`. */
export function glowAtNight(m: { emissiveIntensity: number }, dusk: number, night: number): void {
  NIGHT_GLOW.push({ set: (k) => { m.emissiveIntensity = dusk + (night - dusk) * k; } });
}
