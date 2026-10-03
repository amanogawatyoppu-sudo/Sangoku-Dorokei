import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NATIONS } from '../config/nations';
import { ClipPlayer, GLB_GAME_HEIGHT } from './glbCharacter';
import type { GlbClip, GlbDrive, GlbStats, PlayerModel } from './glbCharacter';

/**
 * Auto-rigged Meshy SOL (evaluation model, `?glb=meshy` / `?glb=meshy40`), player only.
 *
 * One skinned mesh (60k or 40k triangles), 19 joints, 6 in-place clips, one PBR material
 * with three baked textures. The model is centred on the origin (feet at y ≈ −0.95, about
 * 1.87 tall), so a parent group lifts and scales it to the procedural player's height; the
 * GLB itself is never moved. Its texture is SOL's, so it is only used while the player is
 * shown as SOL (otherwise the procedural body, in the right colour, stays visible).
 */

/** Feet and height in model units (from the package README; checked by tests). */
export const MESHY_FEET_Y = -0.952;
export const MESHY_HEIGHT = 1.87;

export class MeshyCharacter implements PlayerModel {
  /** Placed on the procedural rig (position, facing, lean). */
  readonly root = new THREE.Group();
  /** Lifts the feet to y = 0 and scales to game height. Only this group is transformed. */
  readonly fit = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  readonly clips: ClipPlayer;
  readonly body: THREE.SkinnedMesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly stats: GlbStats;
  readonly ownXray = false;

  constructor(gltf: GLTF) {
    const model = gltf.scene;
    let body: THREE.SkinnedMesh | null = null;
    model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !body) body = o as THREE.SkinnedMesh; });
    if (!body) throw new Error('Meshy GLB: no skinned mesh');
    this.body = body;
    // The file has no normals (the loader then shades it flat): smooth ones read better.
    const geo = this.body.geometry;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    this.material = this.body.material as THREE.MeshStandardMaterial;
    this.material.flatShading = false;
    // The game draws colours as they are (colour management off); the base colour texture too.
    if (this.material.map) { this.material.map.colorSpace = THREE.NoColorSpace; this.material.map.needsUpdate = true; }
    this.material.needsUpdate = true;
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.frustumCulled = false; // skinned bounds do not follow the pose (the player is always on screen)
    this.body.renderOrder = 2;
    const k = GLB_GAME_HEIGHT / MESHY_HEIGHT;
    this.fit.scale.setScalar(k);
    this.fit.position.y = -MESHY_FEET_Y * k;
    this.fit.add(model);
    this.root.add(this.fit);
    this.root.name = 'meshy-character';
    // In place: the simulation moves the character. Keep only the hips' bob (y), never x/z.
    for (const clip of gltf.animations) {
      for (const t of clip.tracks) {
        if (!t.name.endsWith('.position')) continue;
        const v = t.values;
        for (let i = 0; i < v.length; i += 3) { v[i] = 0; v[i + 2] = 0; }
      }
    }
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = new ClipPlayer(this.mixer, gltf.animations, 1.2);
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    this.stats = { meshes: 1, triangles: tris, vertices: geo.attributes.position.count, sourceMeshes: 1, parts: this.body.skeleton.bones.length };
  }

  get actions(): Map<GlbClip, THREE.AnimationAction> { return this.clips.actions; }
  get current(): GlbClip { return this.clips.current; }
  update(dt: number, d: GlbDrive): void { this.clips.update(dt, d); }
  /** The baked texture is SOL's: other factions (or a disguise as one) keep the procedural body. */
  showsNation(hex: number): boolean { return hex === NATIONS.sun.color; }
  setNationColor(): void {}

  setOpacity(opacity: number): void {
    const ghost = opacity < 0.99;
    if (this.material.transparent !== ghost) { this.material.transparent = ghost; this.material.needsUpdate = true; }
    this.material.opacity = opacity;
  }
}
