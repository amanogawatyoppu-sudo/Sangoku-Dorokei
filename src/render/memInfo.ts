import type * as THREE from 'three';

/**
 * Rough GPU memory use of a scene, for comparing builds (debug only): every distinct texture
 * (width × height × 4 bytes, +⅓ for mipmaps when it has them) and every distinct geometry's
 * vertex and index buffers. Not exact (driver padding, render targets and the shadow map are
 * left out), but the same measure for every build.
 */
export function sceneMemory(scene: THREE.Scene): { textures: number; textureMB: number; geometries: number; geometryMB: number } {
  const tex = new Set<THREE.Texture>(), geo = new Set<THREE.BufferGeometry>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geo.add(m.geometry);
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) tex.add(v as THREE.Texture);
  });
  let tb = 0;
  for (const t of tex) {
    const img = t.image as { width?: number; height?: number } | undefined;
    const px = (img?.width ?? 0) * (img?.height ?? 0);
    tb += px * 4 * (t.generateMipmaps ? 4 / 3 : 1);
  }
  let gb = 0;
  for (const g of geo) {
    for (const a of Object.values(g.attributes)) gb += (a.array as ArrayLike<number> & { byteLength: number }).byteLength;
    for (const list of Object.values(g.morphAttributes)) for (const a of list) gb += (a.array as ArrayLike<number> & { byteLength: number }).byteLength;
    if (g.index) gb += (g.index.array as ArrayLike<number> & { byteLength: number }).byteLength;
  }
  return { textures: tex.size, textureMB: +(tb / 1048576).toFixed(1), geometries: geo.size, geometryMB: +(gb / 1048576).toFixed(1) };
}
