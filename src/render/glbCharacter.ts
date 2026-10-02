import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import solGlbUrl from '../assets/characters/TRI_TRACE_SOL_animated_v02.glb?inline';
import { toonGradient } from './humanModel';

/**
 * GLB character integration test (player only).
 *
 * With the flag on, the player's own character is drawn by the SOL prototype GLB
 * (rigid node animation, clips Idle / Walk / Run / Sprint / Turn / Trace) instead of
 * the procedural body. Everyone else — CPUs and online players — keeps the procedural
 * body. The procedural body still exists under it as an invisible rig, so positions,
 * collision, TRACE, speeds, rules, effects and online sync are exactly as before:
 * this file only decides what the player looks like.
 *
 * Off by default. For testing, `?glb=1` turns it on and `?glb=0` forces it off.
 */
export const EXPERIMENTAL_GLB_CHARACTER = false;

export function glbCharacterEnabled(search = typeof location === 'undefined' ? '' : location.search): boolean {
  let q: string | null = null;
  try { q = new URLSearchParams(search).get('glb'); } catch { q = null; }
  if (q === '1') return true;
  if (q === '0') return false;
  return EXPERIMENTAL_GLB_CHARACTER;
}

/** The model's height in its own units (Y-up, feet at the origin, facing +Z). */
export const GLB_MODEL_HEIGHT = 2.06;
/** Height in game units before the per-character height factor (the procedural body is ≈ 46–47). */
export const GLB_GAME_HEIGHT = 46.5;
export const GLB_CLIPS = ['Idle', 'Walk', 'Run', 'Sprint', 'Turn', 'Trace'] as const;
export type GlbClip = (typeof GLB_CLIPS)[number];

/** The SOL accent baked into the vertex colours, and the light tint used on the device screen. */
const ACCENT = [248, 105, 39], ACCENT_TINT = [248, 198, 175];
const near = (r: number, g: number, b: number, c: number[]) => Math.abs(r * 255 - c[0]) < 2.5 && Math.abs(g * 255 - c[1]) < 2.5 && Math.abs(b * 255 - c[2]) < 2.5;

/**
 * The faction accent as painted: a shade deeper than the faction colour, because the cel
 * shading's lit band and the rim brighten it (a lit SOL orange otherwise reads as STAR amber).
 */
export const accentTone = (hex: number) => new THREE.Color(hex).multiplyScalar(0.72).getHex();

/** What drives the clips each frame (all read from the existing animation state). */
export interface GlbDrive {
  /** Smoothed ground speed (units/s). */
  speed: number;
  /** Yaw rate (rad/s). */
  turnRate: number;
  /** Held still by the game (locked up, kneeling at a lock, stunned). */
  held: boolean;
  /** A TRACE was just made (one-shot). */
  trace: boolean;
}

export interface GlbStats { meshes: number; triangles: number; vertices: number; sourceMeshes: number; parts: number }

/**
 * The prepared character: meshes merged per moving part (71 → one per part), the game's
 * cel shading, faction recolouring, an x-ray silhouette and an AnimationMixer with
 * short cross-fades between the clips.
 */
export class GlbCharacter {
  readonly root = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  readonly actions = new Map<GlbClip, THREE.AnimationAction>();
  readonly material: THREE.MeshToonMaterial;
  readonly stats: GlbStats;
  /** The single skinned body mesh. */
  body!: THREE.SkinnedMesh;
  current: GlbClip = 'Idle';
  private colorAttrs: { attr: THREE.BufferAttribute; accent: number[]; tint: number[] }[] = [];
  private painted = -1;
  private traceLeft = 0;
  private xrayMat: THREE.MeshBasicMaterial;

  constructor(gltf: GLTF, xrayColor: number) {
    const model = gltf.scene;
    this.material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }); // merged non-indexed: per-face normals, faceted like the model
    this.material.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += vec3(0.78, 0.86, 1.0) * rimF * 0.32 + diffuseColor.rgb * (0.05 + vGlow * 0.25);`);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;');
    };
    this.material.customProgramCacheKey = () => 'tt-glb';
    this.xrayMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(xrayColor).multiplyScalar(0.55), blending: THREE.AdditiveBlending, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false });
    this.stats = this.mergeParts(model);
    // Model units → game units; it already faces +Z like the game's characters.
    const k = GLB_GAME_HEIGHT / GLB_MODEL_HEIGHT;
    model.scale.setScalar(k);
    this.root.add(model);
    this.root.name = 'glb-character';
    this.mixer = new THREE.AnimationMixer(model);
    for (const name of GLB_CLIPS) {
      const clip = gltf.animations.find((c) => c.name === name);
      if (!clip) continue;
      const act = this.mixer.clipAction(clip);
      if (name === 'Trace') { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
      this.actions.set(name, act);
    }
    this.actions.get('Idle')?.play();
  }

  /**
   * The animation is rigid (each moving part follows one node), so the whole body becomes
   * ONE skinned mesh whose "bones" are those nodes, each vertex fully on its part's node:
   * 71 source meshes → 1 draw call (plus 1 for the x-ray and 1 for the shadow).
   */
  private mergeParts(model: THREE.Object3D): GlbStats {
    model.updateMatrixWorld(true);
    const toModel = model.matrixWorld.clone().invert();
    const groups = new Map<THREE.Object3D, THREE.Mesh[]>();
    let sourceMeshes = 0;
    model.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh || !o.parent) return;
      sourceMeshes++;
      const list = groups.get(o.parent) ?? [];
      list.push(o as THREE.Mesh);
      groups.set(o.parent, list);
    });
    const bones: THREE.Object3D[] = [], geos: THREE.BufferGeometry[] = [];
    for (const [parent, list] of groups) {
      const bi = bones.push(parent) - 1;
      for (const m of list) {
        const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(toModel.clone().multiply(m.matrixWorld));
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
        const n = g.attributes.position.count;
        const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        geos.push(g);
        parent.remove(m);
        m.geometry.dispose();
      }
    }
    const merged = mergeGeometries(geos)!;
    merged.computeVertexNormals(); // non-indexed: one normal per face, faceted like the source
    const skeleton = new THREE.Skeleton(bones as THREE.Bone[]);
    const mesh = new THREE.SkinnedMesh(merged, this.material);
    mesh.name = 'glb-body';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    mesh.frustumCulled = false; // skinned bounds do not follow the pose (the player is always on screen)
    model.add(mesh);
    model.updateMatrixWorld(true);
    mesh.bind(skeleton);
    // Seen through walls like the procedural player (drawn first, only where something hides it).
    const x = new THREE.SkinnedMesh(merged, this.xrayMat);
    x.name = 'glb-xray';
    x.renderOrder = 1;
    x.frustumCulled = false;
    model.add(x);
    x.bind(skeleton, mesh.bindMatrix);
    this.body = mesh;
    const attr = merged.attributes.color as THREE.BufferAttribute;
    const accent: number[] = [], tint: number[] = [];
    for (let i = 0; i < attr.count; i++) {
      const r = attr.getX(i), g = attr.getY(i), b = attr.getZ(i);
      if (near(r, g, b, ACCENT)) accent.push(i);
      else if (near(r, g, b, ACCENT_TINT)) tint.push(i);
    }
    this.colorAttrs.push({ attr, accent, tint });
    // The faction accents glow softly, like the light strips on the procedural body (readable at night).
    const glow = new Float32Array(attr.count);
    for (const i of accent) glow[i] = 1;
    for (const i of tint) glow[i] = 1;
    merged.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
    const vertices = merged.attributes.position.count;
    return { meshes: 1, triangles: vertices / 3, vertices, sourceMeshes, parts: bones.length };
  }

  /** Repaints the faction accents (own faction, or a disguise) — collar, shoulders, trims, device. */
  setNationColor(hex: number): void {
    if (hex === this.painted) return;
    this.painted = hex;
    const c = new THREE.Color(accentTone(hex)), t = new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.6);
    for (const { attr, accent, tint } of this.colorAttrs) {
      for (const i of accent) attr.setXYZ(i, c.r, c.g, c.b);
      for (const i of tint) attr.setXYZ(i, t.r, t.g, t.b);
      attr.needsUpdate = true;
    }
  }

  setOpacity(opacity: number): void {
    const ghost = opacity < 0.99;
    if (this.material.transparent !== ghost) { this.material.transparent = ghost; this.material.needsUpdate = true; }
    this.material.opacity = opacity;
  }

  /** Which clip fits the moment (with a little hysteresis so it does not flicker at a boundary). */
  pick(d: GlbDrive): GlbClip {
    if (this.traceLeft > 0) return 'Trace';
    if (d.held) return 'Idle';
    const s = d.speed, cur = this.current, h = (clip: GlbClip, up: number) => (cur === clip ? up - 15 : up + 15);
    // Turning on the spot, or a sharp turn at walking pace (swinging round to run the other way).
    const spin = Math.abs(d.turnRate) > (cur === 'Turn' ? 1.2 : 1.6);
    if (spin && s < h('Run', 150)) return 'Turn';
    if (s < h('Walk', 20)) return 'Idle';
    if (s < h('Run', 150)) return 'Walk';
    if (s < h('Sprint', 300)) return 'Run';
    return 'Sprint';
  }

  /** Steps the animation. Locomotion clips play at the game's stride rate, so feet do not skate. */
  update(dt: number, d: GlbDrive): void {
    if (d.trace && this.actions.has('Trace')) this.traceLeft = this.actions.get('Trace')!.getClip().duration / 1.4;
    this.traceLeft = Math.max(0, this.traceLeft - dt);
    const want = this.pick(d);
    if (want !== this.current) this.fade(want, want === 'Trace' ? 0.1 : 0.2);
    const act = this.actions.get(this.current);
    if (act) {
      if (this.current === 'Walk' || this.current === 'Run' || this.current === 'Sprint') {
        // One clip = one full stride cycle (two steps); the game's stride is entityView's.
        const stride = Math.min(78, 34 + d.speed * 0.09);
        const hz = d.speed / (2 * stride);
        act.timeScale = THREE.MathUtils.clamp(hz * act.getClip().duration, 0.5, 3.2);
      } else if (this.current === 'Turn') act.timeScale = THREE.MathUtils.clamp(Math.abs(d.turnRate) / 3, 0.8, 1.8);
      else act.timeScale = this.current === 'Trace' ? 1.4 : 1;
    }
    this.mixer.update(dt);
  }

  private fade(to: GlbClip, sec: number): void {
    const from = this.actions.get(this.current), next = this.actions.get(to);
    if (!next) return;
    const loco = (c: GlbClip) => c === 'Walk' || c === 'Run' || c === 'Sprint';
    next.reset();
    // Keep the stride phase across walk / run / sprint so the feet stay in step.
    if (from && loco(this.current) && loco(to)) next.time = (from.time / from.getClip().duration) * next.getClip().duration;
    next.setEffectiveWeight(1).play();
    if (from) from.crossFadeTo(next, sec, false);
    this.current = to;
  }

  dispose(): void {
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.material.dispose();
    this.xrayMat.dispose();
  }
}

/** Parses GLB bytes (browser or tests). */
export function parseGlb(data: ArrayBuffer): Promise<GLTF> {
  return new GLTFLoader().parseAsync(data, '');
}

let pending: Promise<GLTF> | null = null;
/** Loads the bundled SOL GLB once (the file ships inside the page). */
export function loadSolGlb(): Promise<GLTF> {
  pending ??= fetch(solGlbUrl)
    .then((r) => r.arrayBuffer())
    .then(parseGlb);
  return pending;
}
