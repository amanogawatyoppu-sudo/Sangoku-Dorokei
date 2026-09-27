import * as THREE from 'three';
import { NATION_IDS, NATIONS } from '../config/nations';
import { BOUNDS, OBST, SNIPE, TOWER } from '../config/map';
import { HILL_HEIGHT, HILL_TOP } from './terrain';
import { GROUND_EXTENT, detailNoise, emblemTexture, groundTexture, stoneTexture } from './textures';

export interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Banner on top of the watchtower; its colour shows the tower's owner. */
  towerMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
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
  wood: 0x6b4a2f,
  woodDark: 0x3e2a1b,
  lacquer: 0xa8322a,
  roofTile: 0x3b3f4a,
  gold: 0xd8b25a,
  earth: 0x7a6245,
  hillGrass: 0x5d7a3e,
  leaf: 0x2f4f2a,
};

function std(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => { c.castShadow = cast; c.receiveShadow = receive; });
  return o;
}

/** Box with UVs projected in world units (1 texture tile per `tile` units) so stone never stretches. */
function worldUvBox(w: number, h: number, d: number, tile: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + w / 2, y = pos.getY(i) + h / 2, z = pos.getZ(i) + d / 2;
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  return geo;
}

function buildSky(scene: THREE.Scene): void {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3600, 32, 16),
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

function buildLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xc9d6f0, 0x3d4a2c, 0.55 * L));
  scene.add(new THREE.AmbientLight(0x8899aa, 0.12 * L));
  const sun = new THREE.DirectionalLight(0xffe0b8, 0.95 * L);
  sun.position.set(-700, 900, 500);
  sun.castShadow = true;
  // Phones get a lighter shadow map; the field is large so 2048 is used where GPUs allow.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  sun.shadow.mapSize.setScalar(coarse ? 1024 : 2048);
  const cam = sun.shadow.camera;
  cam.left = -1350; cam.right = 1350; cam.top = 900; cam.bottom = -900; cam.near = 100; cam.far = 2600;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 1.5;
  scene.add(sun);
}

function buildGround(scene: THREE.Scene): void {
  const bump = detailNoise();
  bump.repeat.set(GROUND_EXTENT.w / 18, GROUND_EXTENT.d / 18);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_EXTENT.w, GROUND_EXTENT.d),
    std(0xffffff, { map: groundTexture(), bumpMap: bump, bumpScale: 0.6, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

/** Obstacles become stone walls with a dark cap and battlements on the tall ones. */
function buildWalls(scene: THREE.Scene): void {
  const stone = std(COLORS.stone, { map: stoneTexture(), roughness: 0.9 });
  const cap = std(COLORS.stoneCap);
  const merlons: THREE.Matrix4[] = [];
  for (const o of OBST) {
    const wall = new THREE.Mesh(worldUvBox(o.w, o.h, o.d, 64), stone);
    wall.position.set(o.x, o.h / 2, o.z);
    scene.add(shadowed(wall));
    const top = new THREE.Mesh(new THREE.BoxGeometry(o.w + 6, 4, o.d + 6), cap);
    top.position.set(o.x, o.h + 2, o.z);
    scene.add(shadowed(top));
    if (o.h < 45) continue;
    // Battlements along the long axis.
    const alongX = o.w >= o.d, len = alongX ? o.w : o.d, n = Math.floor(len / 26);
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + (i + 0.5) * (len / n);
      for (const side of [-1, 1]) {
        const off = side * ((alongX ? o.d : o.w) / 2 - 3);
        merlons.push(new THREE.Matrix4().makeTranslation(o.x + (alongX ? t : off), o.h + 4 + 5, o.z + (alongX ? off : t)));
      }
    }
  }
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 10, 6), cap, merlons.length);
  merlons.forEach((mat, i) => m.setMatrixAt(i, mat));
  scene.add(shadowed(m));
}

/** Sniper hills: grassy mounds with a lookout post (height matches terrain.heightAt). */
function buildHills(scene: THREE.Scene): void {
  for (const h of SNIPE) {
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(h.r * HILL_TOP, h.r, HILL_HEIGHT, 40), [
      std(COLORS.earth), std(COLORS.hillGrass), std(COLORS.earth),
    ]);
    mound.position.set(h.x, HILL_HEIGHT / 2, h.z);
    scene.add(shadowed(mound));
    // Four posts and a rail around the top edge.
    const postMat = std(COLORS.wood);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = h.r * HILL_TOP - 6;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 16, 6), postMat);
      post.position.set(h.x + Math.cos(a) * r, HILL_HEIGHT + 8, h.z + Math.sin(a) * r);
      scene.add(shadowed(post));
    }
  }
}

function roof(size: number, height: number, mat: THREE.Material): THREE.Mesh {
  const r = new THREE.Mesh(new THREE.ConeGeometry(size, height, 4, 1), mat);
  r.rotation.y = Math.PI / 4;
  return r;
}

/** Central watchtower: a three-tier pagoda with a banner showing the owner. */
function buildTower(scene: THREE.Scene): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const g = new THREE.Group();
  g.position.set(TOWER.x, 0, TOWER.z);
  const stone = std(COLORS.stone, { map: stoneTexture() });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(TOWER.r * 0.62, TOWER.r * 0.7, 10, 8), stone);
  plinth.position.y = 5;
  g.add(plinth);
  const lacquer = std(COLORS.lacquer, { roughness: 0.6 });
  const tile = std(COLORS.roofTile, { roughness: 0.7 });
  let y = 10;
  const tiers: [number, number][] = [[46, 38], [36, 32], [26, 26]];
  for (const [w, h] of tiers) {
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

/** Kingdom bases: coloured ring, banners, and the meeting drum by the terminal. */
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
    // Meeting terminal (v6: box at +40,+40) as a war drum on a stand.
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

/** Jails: translucent floor in the captor's colour inside a wooden cage. */
function buildJails(scene: THREE.Scene): void {
  const wood = std(COLORS.wood);
  const posts: THREE.Matrix4[] = [];
  const beams: THREE.Mesh[] = [];
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
      beams.push(beam);
    }
  }
  const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.4, 1.4, 24, 6), wood, posts.length);
  posts.forEach((m, i) => pm.setMatrixAt(i, m));
  scene.add(shadowed(pm));
  for (const b of beams) scene.add(shadowed(b));
}

/** Palisade along the play boundary and a forest beyond it. */
function buildBorder(scene: THREE.Scene): void {
  const rnd = (() => { let a = 99; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const fence: THREE.Matrix4[] = [];
  const ex = BOUNDS.maxX + 30, ez = BOUNDS.maxZ + 30;
  const q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  const place = (x: number, z: number) => {
    const h = 26 + rnd() * 8;
    fence.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2, z), q, s.clone().set(1, h / 30, 1)));
  };
  for (let x = -ex; x <= ex; x += 9) { place(x, -ez); place(x, ez); }
  for (let z = -ez; z <= ez; z += 9) { place(-ex, z); place(ex, z); }
  const fm = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.6, 3, 30, 5), std(COLORS.wood), fence.length);
  fence.forEach((m, i) => fm.setMatrixAt(i, m));
  scene.add(shadowed(fm));

  const trees: THREE.Matrix4[] = [], trunks: THREE.Matrix4[] = [];
  let guard = 0;
  while (trees.length < 420 && guard++ < 5000) {
    const x = (rnd() * 2 - 1) * (GROUND_EXTENT.w / 2 - 20), z = (rnd() * 2 - 1) * (GROUND_EXTENT.d / 2 - 20);
    if (Math.abs(x) < ex + 40 && Math.abs(z) < ez + 40) continue;
    const k = 0.8 + rnd() * 0.9;
    trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 22 + 34 * k, z), q, new THREE.Vector3(k, k, k)));
    trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 12 * k, z), q, new THREE.Vector3(k, k, k)));
  }
  const tm = new THREE.InstancedMesh(new THREE.ConeGeometry(22, 70, 7), std(COLORS.leaf, { flatShading: true }), trees.length);
  trees.forEach((m, i) => tm.setMatrixAt(i, m));
  const km = new THREE.InstancedMesh(new THREE.CylinderGeometry(3, 4, 24, 5), std(COLORS.woodDark), trunks.length);
  trunks.forEach((m, i) => km.setMatrixAt(i, m));
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
  scene.fog = new THREE.Fog(COLORS.fog, 700, 2300);
  const camera = new THREE.PerspectiveCamera(65, 1, 1, 8000);

  buildSky(scene);
  buildLights(scene);
  buildGround(scene);
  buildWalls(scene);
  buildHills(scene);
  const towerMesh = buildTower(scene);
  buildBases(scene);
  buildJails(scene);
  buildBorder(scene);
  return { renderer, scene, camera, towerMesh };
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
