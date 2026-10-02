/**
 * v9.2 art prototype switch (from the page address, read once):
 * - nothing: the v9.1 look everywhere (the default until the prototype is approved)
 * - `?art=v2`: the new street-agent body for your own character, the Shibuya showcase block, the tuned camera
 * - `?art=v2all`: as `v2`, and every character uses the new body (for checking role hiding at scale)
 */
export type ArtMode = 'off' | 'player' | 'all';

let mode: ArtMode | null = null;

export function artMode(): ArtMode {
  if (mode) return mode;
  let q = '';
  try { q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('art') ?? ''; } catch { q = ''; }
  mode = q === 'v2all' ? 'all' : q === 'v2' ? 'player' : 'off';
  return mode;
}

/** For tests and tools. */
export function setArtMode(m: ArtMode): void { mode = m; }

/** Default camera distance with the prototype on (v9.1: 160). */
export const ART_CAMERA_DISTANCE = 145;

/**
 * Default camera tilt with the prototype on (v9.1: 0.42 rad). A little flatter, so shopfronts,
 * signs and screens at street level stay in view; the street ahead and the escape routes
 * still show. Players can tilt it as before.
 */
export const ART_CAMERA_PITCH = 0.34;
