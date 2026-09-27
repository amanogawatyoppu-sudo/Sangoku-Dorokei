import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NATION_IDS, NATIONS } from '../config/nations';
import type { BoxPrim, Prim, RampPrim } from '../config/map';
import { BOUNDS, GROUND, RIVER, TOWER, WORLD } from '../config/map';
import { rampHeight } from '../sim/systems/world';
import { detailNoise, emblemTexture, groundTexture, stoneTexture } from './textures';

export interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Banner on top of the watchtower; its colour shows the tower's owner. */
  towerMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Shadow-casting sun; main moves it with the player so shadows stay sharp on a big map. */
  sun: THREE.DirectionalLight;
}

/**
 * Colour management stays off (as in v6 / three r128) so hex colours read as
 * authored; light intensities use the legacy scale for the same reason.
 */
const L = Math.PI;

const COLORS = {
  skyTop: 0x2a3d63,
  skyHorizon: 0xd9a37a,
  fog: 0x8e8a86,
  stone: 0xb5ab98,
  stoneCap: 0x5f574b,
  plaster: 0xe4d8c0,
  wood: 0x6b4a2f,
  woodLight: 0x9a7048,
  woodDark: 0x3e2a1b,
  lacquer: 0xa8322a,
  roofTile: 0x3b3f4a,
  gold: 0xd8b25a,
  earth: 0x7a6245,
  grass: 0x5d7a3e,
  hedge: 0x3f5e30,
  leaf: 0x2f4f2a,
  water: 0x3f7590,
};

function std(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => { c.castShadow = cast; c.receiveShadow = receive; });
  return o;
}

/** Rewrites a box geometry's UVs in world units (1 tile per `tile`) so textures never stretch. */
function worldUv(geo: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  return geo;
}

// ---------------------------------------------------------------- environment

function buildSky(scene: THREE.Scene): void {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(5200, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(COLORS.skyTop) }, horizon: { value: new THREE.Color(COLORS.skyHorizon) } },
      vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;' +
        'void main(){ float h = clamp(normalize(vPos).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }',
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);
}

function buildLights(scene: THREE.Scene): THREE.DirectionalLight {
  scene.add(new THREE.HemisphereLight(0xc9d6f0, 0x3d4a2c, 0.55 * L));
  scene.add(new THREE.AmbientLight(0x8899aa, 0.12 * L));
  const sun = new THREE.DirectionalLight(0xffe0b8, 0.95 * L);
  sun.position.set(-700, 900, 500);
  sun.castShadow = true;
  // Phones get a lighter shadow map.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  sun.shadow.mapSize.setScalar(coarse ? 1024 : 2048);
  const cam = sun.shadow.camera;
  cam.left = -900; cam.right = 900; cam.top = 900; cam.bottom = -900; cam.near = 100; cam.far = 2600;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 1.5;
  scene.add(sun, sun.target);
  return sun;
}

function buildGround(scene: THREE.Scene): void {
  const bump = detailNoise();
  bump.repeat.set(GROUND.w / 18, GROUND.d / 18);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND.w, GROUND.d),
    std(0xffffff, { map: groundTexture(), bumpMap: bump, bumpScale: 0.6, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(RIVER.maxX - RIVER.minX, RIVER.d),
    new THREE.MeshStandardMaterial({ color: COLORS.water, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.88 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((RIVER.minX + RIVER.maxX) / 2, 5, RIVER.z);
  water.receiveShadow = true;
  scene.add(water);
}

// ---------------------------------------------------------------- world primitives

function rampGeometry(p: RampPrim): THREE.BufferGeometry {
  if (p.style === 'stairs') {
    const len = p.axis === 'x' ? p.w : p.d;
    const n = Math.max(3, Math.round(len / 11));
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      // Step i covers the slice [i/n, (i+1)/n] from the low end; its tread is the slice's top height.
      const t1 = (i + 1) / n;
      const h = p.hLow + (p.hHigh - p.hLow) * t1;
      const sliceLen = len / n;
      const u = (i + 0.5) / n; // from the low end
      const off = (p.dir === 1 ? u - 0.5 : 0.5 - u) * len;
      const g = new THREE.BoxGeometry(p.axis === 'x' ? sliceLen : p.w, h, p.axis === 'z' ? sliceLen : p.d);
      g.translate(p.axis === 'x' ? p.x + off : p.x, h / 2, p.axis === 'z' ? p.z + off : p.z);
      parts.push(g.toNonIndexed());
    }
    return mergeGeometries(parts)!;
  }
  const g = new THREE.BoxGeometry(p.w, 1, p.d, p.axis === 'x' ? 8 : 1, 1, p.axis === 'z' ? 8 : 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + p.x, z = pos.getZ(i) + p.z;
    pos.setY(i, pos.getY(i) > 0 ? rampHeight(p, x, z) : 0);
  }
  g.translate(p.x, 0, p.z);
  g.computeVertexNormals();
  return g;
}

interface Mats {
  stone: THREE.Material;
  cap: THREE.Material;
  plaster: THREE.Material;
  wood: THREE.Material;
  woodLight: THREE.Material;
  earthSide: THREE.Material;
  grass: THREE.Material;
  hedge: THREE.Material;
}

function materialsFor(p: Prim, m: Mats): THREE.Material | THREE.Material[] {
  switch (p.mat) {
    case 'stone': return m.stone;
    case 'plaster': return m.plaster;
    case 'wood': return p.kind === 'ramp' ? m.woodLight : m.wood;
    case 'hedge': return m.hedge;
    case 'earth': return p.kind === 'ramp' ? m.grass : [m.earthSide, m.earthSide, m.grass, m.earthSide, m.earthSide, m.earthSide];
    default: return m.stone;
  }
}

/** Turns every world primitive (walls, halls, floors, stairs, slopes, hills, bridges) into meshes. */
function buildWorld(scene: THREE.Scene): void {
  const stoneTex = stoneTexture();
  const m: Mats = {
    stone: std(COLORS.stone, { map: stoneTex, roughness: 0.9 }),
    cap: std(COLORS.stoneCap),
    plaster: std(COLORS.plaster, { roughness: 0.95 }),
    wood: std(COLORS.wood),
    woodLight: std(COLORS.woodLight),
    earthSide: std(COLORS.earth, { map: stoneTex, color: 0x9a7d5a }),
    grass: std(COLORS.grass),
    hedge: std(COLORS.hedge, { roughness: 1 }),
  };
  const merlons: THREE.Matrix4[] = [];
  for (const p of WORLD) {
    if (p.mat === 'water') continue;
    if (p.group === 'tower') continue; // drawn as the pagoda
    if (p.kind === 'ramp') {
      scene.add(shadowed(new THREE.Mesh(rampGeometry(p), materialsFor(p, m))));
      continue;
    }
    const b = p as BoxPrim;
    const h = b.y1 - b.y0;
    const geo = worldUv(new THREE.BoxGeometry(b.w, h, b.d), 64);
    const mesh = new THREE.Mesh(geo, materialsFor(b, m));
    mesh.position.set(b.x, b.y0 + h / 2, b.z);
    scene.add(shadowed(mesh));
    // Free-standing stone walls get a cap and battlements.
    if (b.mat === 'stone' && b.y0 === 0 && !b.group && h >= 50) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + 6, 4, b.d + 6), m.cap);
      cap.position.set(b.x, b.y1 + 2, b.z);
      scene.add(shadowed(cap));
      const alongX = b.w >= b.d, len = alongX ? b.w : b.d, n = Math.floor(len / 26);
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (i + 0.5) * (len / n);
        for (const side of [-1, 1]) {
          const off = side * ((alongX ? b.d : b.w) / 2 - 3);
          merlons.push(new THREE.Matrix4().makeTranslation(b.x + (alongX ? t : off), b.y1 + 9, b.z + (alongX ? off : t)));
        }
      }
    }
    // Houses get a decorative tiled roof (their tops are out of reach anyway).
    if (b.group === 'house') {
      const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.78, 30, 4), std(COLORS.roofTile, { roughness: 0.7 }));
      r.rotation.y = Math.PI / 4;
      r.scale.set(b.w / Math.max(b.w, b.d), 1, b.d / Math.max(b.w, b.d));
      r.position.set(b.x, b.y1 + 15, b.z);
      scene.add(shadowed(r));
    }
  }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 10, 6), m.cap, merlons.length);
  merlons.forEach((mat, i) => im.setMatrixAt(i, mat));
  scene.add(shadowed(im));
}

function roof(size: number, height: number, mat: THREE.Material): THREE.Mesh {
  const r = new THREE.Mesh(new THREE.ConeGeometry(size, height, 4, 1), mat);
  r.rotation.y = Math.PI / 4;
  return r;
}

/** Central watchtower: a three-tier pagoda (collision is the 46×46 core) with the owner's banner. */
function buildTower(scene: THREE.Scene): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const g = new THREE.Group();
  g.position.set(TOWER.x, 0, TOWER.z);
  const lacquer = std(COLORS.lacquer, { roughness: 0.6 });
  const tile = std(COLORS.roofTile, { roughness: 0.7 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(52, 8, 52), std(COLORS.stone, { map: stoneTexture() }));
  plinth.position.y = 4;
  g.add(plinth);
  let y = 8;
  for (const [w, h] of [[46, 40], [36, 32], [26, 26]]) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), lacquer);
    body.position.y = y + h / 2;
    g.add(body);
    const rf = roof(w * 1.05, 16, tile);
    rf.position.y = y + h + 6;
    g.add(rf);
    y += h + 10;
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 34, 6), std(COLORS.gold, { metalness: 0.6, roughness: 0.35 }));
  pole.position.y = y + 14;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), std(0x777777, { side: THREE.DoubleSide }));
  flag.position.set(13, y + 22, 0);
  g.add(flag);
  scene.add(shadowed(g));
  return flag;
}

function banner(glyph: string, color: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, height, 6), std(COLORS.woodDark));
  pole.position.y = height / 2;
  g.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(18, 27), std(0xffffff, { map: emblemTexture(glyph, color), side: THREE.DoubleSide }));
  cloth.position.set(0, height - 16, 1.8);
  g.add(cloth);
  return shadowed(g);
}

/** Kingdom bases: coloured ring, banners, and the meeting drum at the terminal. */
function buildBases(scene: THREE.Scene): void {
  for (const n of NATION_IDS) {
    const { base: b, color, emblem } = NATIONS[n];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(60, 74, 48),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.x, 0.5, b.z);
    scene.add(ring);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const f = banner(emblem, color, 64);
      f.position.set(b.x + Math.cos(a) * 82, 0, b.z + Math.sin(a) * 82);
      f.lookAt(b.x, 0, b.z);
      scene.add(f);
    }
    const drum = new THREE.Group();
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 10, 8), std(COLORS.woodDark));
    stand.position.y = 5;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 12, 16), std(COLORS.lacquer, { roughness: 0.55 }));
    barrel.rotation.z = Math.PI / 2;
    barrel.position.y = 18;
    drum.add(stand, barrel);
    drum.position.set(b.x + 40, 0, b.z + 40);
    scene.add(shadowed(drum));
  }
}

/** Jails: translucent floor in the captor's colour inside a low wooden cage. */
function buildJails(scene: THREE.Scene): void {
  const wood = std(COLORS.wood);
  const posts: THREE.Matrix4[] = [];
  for (const n of NATION_IDS) {
    const j = NATIONS[n].jail;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(j.w, 2, j.d),
      new THREE.MeshStandardMaterial({ color: NATIONS[n].color, transparent: true, opacity: 0.35 }),
    );
    floor.position.set(j.x, 1, j.z);
    floor.receiveShadow = true;
    scene.add(floor);
    const H = 24;
    const addPost = (x: number, z: number) => posts.push(new THREE.Matrix4().makeTranslation(x, H / 2, z));
    for (let x = -j.w / 2; x <= j.w / 2 + 0.1; x += j.w / 10) { addPost(j.x + x, j.z - j.d / 2); addPost(j.x + x, j.z + j.d / 2); }
    for (let z = -j.d / 2 + j.d / 3; z < j.d / 2 - 1; z += j.d / 3) { addPost(j.x - j.w / 2, j.z + z); addPost(j.x + j.w / 2, j.z + z); }
    for (const [w, d, x, z] of [[j.w + 4, 3, 0, -j.d / 2], [j.w + 4, 3, 0, j.d / 2], [3, j.d, -j.w / 2, 0], [3, j.d, j.w / 2, 0]]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), wood);
      beam.position.set(j.x + x, H, j.z + z);
      scene.add(shadowed(beam));
    }
  }
  const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.4, 1.4, 24, 6), wood, posts.length);
  posts.forEach((mm, i) => pm.setMatrixAt(i, mm));
  scene.add(shadowed(pm));
}

/** Palisade along the play boundary and a forest beyond it. */
function buildBorder(scene: THREE.Scene): void {
  const rnd = (() => { let a = 99; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const fence: THREE.Matrix4[] = [];
  const ex = BOUNDS.maxX + 30, ez = BOUNDS.maxZ + 30;
  const q = new THREE.Quaternion();
  const place = (x: number, z: number) => {
    const h = 26 + rnd() * 8;
    fence.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(1, h / 30, 1)));
  };
  for (let x = -ex; x <= ex; x += 10) { place(x, -ez); place(x, ez); }
  for (let z = -ez; z <= ez; z += 10) { place(-ex, z); place(ex, z); }
  const fm = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.6, 3, 30, 5), std(COLORS.wood), fence.length);
  fence.forEach((mm, i) => fm.setMatrixAt(i, mm));
  scene.add(shadowed(fm));

  const trees: THREE.Matrix4[] = [], trunks: THREE.Matrix4[] = [];
  let guard = 0;
  while (trees.length < 520 && guard++ < 8000) {
    const x = (rnd() * 2 - 1) * (GROUND.w / 2 - 20), z = (rnd() * 2 - 1) * (GROUND.d / 2 - 20);
    if (Math.abs(x) < ex + 40 && Math.abs(z) < ez + 40) continue;
    const k = 0.8 + rnd() * 0.9;
    trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 22 + 34 * k, z), q, new THREE.Vector3(k, k, k)));
    trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 12 * k, z), q, new THREE.Vector3(k, k, k)));
  }
  const tm = new THREE.InstancedMesh(new THREE.ConeGeometry(22, 70, 7), std(COLORS.leaf, { flatShading: true }), trees.length);
  trees.forEach((mm, i) => tm.setMatrixAt(i, mm));
  const km = new THREE.InstancedMesh(new THREE.CylinderGeometry(3, 4, 24, 5), std(COLORS.woodDark), trunks.length);
  trunks.forEach((mm, i) => km.setMatrixAt(i, mm));
  scene.add(shadowed(tm), shadowed(km));
}

export function buildScene(canvas: HTMLCanvasElement): SceneRefs {
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.fog);
  scene.fog = new THREE.Fog(COLORS.fog, 800, 2600);
  const camera = new THREE.PerspectiveCamera(65, 1, 1, 12000);

  buildSky(scene);
  const sun = buildLights(scene);
  buildGround(scene);
  buildWorld(scene);
  const towerMesh = buildTower(scene);
  buildBases(scene);
  buildJails(scene);
  buildBorder(scene);
  return { renderer, scene, camera, towerMesh, sun };
}

/** Keeps the shadow frustum centred on the player so a big map still gets crisp shadows. */
export function followSun(refs: SceneRefs, x: number, y: number, z: number): void {
  refs.sun.position.set(x - 700, y + 900, z + 500);
  refs.sun.target.position.set(x, y, z);
}

/** Upper bound on the render pixel ratio: sharp on high-DPI screens without 3x/4x fill cost. */
export const MAX_PIXEL_RATIO = 2;

/** Vertical FOV used on landscape screens (v6 value). */
export const BASE_FOV = 65;
const MIN_HORIZONTAL_FOV = 62;
const MAX_FOV = 90;

/**
 * Vertical FOV for an aspect ratio. Landscape keeps v6's 65°; on portrait
 * phones the vertical FOV grows so the horizontal view does not collapse.
 */
export function fovForAspect(aspect: number): number {
  const hNeeded = (MIN_HORIZONTAL_FOV * Math.PI) / 180;
  const vForH = (2 * Math.atan(Math.tan(hNeeded / 2) / aspect) * 180) / Math.PI;
  return Math.min(MAX_FOV, Math.max(BASE_FOV, vForH));
}

export function renderPixelRatio(devicePixelRatio: number): number {
  return Math.min(Math.max(devicePixelRatio || 1, 1), MAX_PIXEL_RATIO);
}

/** Matches the drawing buffer and camera aspect to the canvas's CSS size and the screen's pixel ratio. */
export function resizeRenderer(refs: SceneRefs, canvas: HTMLCanvasElement): void {
  const r = canvas.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return;
  refs.renderer.setPixelRatio(renderPixelRatio(window.devicePixelRatio));
  refs.renderer.setSize(r.width, r.height, false);
  refs.camera.aspect = r.width / r.height;
  refs.camera.fov = fovForAspect(refs.camera.aspect);
  refs.camera.updateProjectionMatrix();
}
