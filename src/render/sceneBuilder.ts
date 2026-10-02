import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BoxPrim, Prim, RampPrim } from '../config/map';
import { GROUND, KANDA, LANDMARKS, LIGHTS, LOOP, MAST_H, RIVER_WIDTH, STATIONS, STOREY, TOKYO_TOWER_H, TOWER, VIADUCT, WALK_EDGE, WORLD, geo, realHeight } from '../config/map';
import { rampHeight } from '../sim/systems/world';
import { brickFacadeTexture, detailNoise, stoneFacadeTexture, facadeTexture, groundTexture, latticeTexture, stoneTexture, viaductTexture } from './textures';
import { buildCity } from './city';
import { buildDistricts } from './districts';
import { buildBases, buildLockPoints } from './objectives';
import { NIGHT_GLOW } from './nightGlow';

export interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Flag on top of the 管制塔 radio tower; its colour shows the owner. */
  towerMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Shadow-casting sun; main moves it with the player so shadows stay sharp on a big map. */
  sun: THREE.DirectionalLight;
  /** The Yamanote train running round the loop (animated by `updateTrain`). */
  train: THREE.Group;
  /** What nightfall changes (see `setNightfall`). */
  night: { sky: Record<'top' | 'mid' | 'horizon', { value: THREE.Color }> & { glow: { value: number } }; hemi: THREE.HemisphereLight; amb: THREE.AmbientLight; k: number };
  /** Real light from the street lamps nearest the player (see `updateStreetLights`). */
  lamps: { lights: THREE.PointLight[]; near: THREE.PointLight; at: { x: number; z: number } | null };
}

/**
 * Colour management stays off (as in v6 / three r128) so hex colours read as
 * authored; light intensities use the legacy scale for the same reason.
 */
const L = Math.PI;

const COLORS = {
  // Early evening over Tokyo (v8.1: clearer and more neutral than the old violet dusk, so
  // the streets read easily): blue overhead, a warm horizon, a light grey-blue haze.
  skyTop: 0x2c4a86,
  skyMid: 0x7f95c2,
  skyHorizon: 0xf2b07e,
  fog: 0xa3a9bc,
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
  towerRed: 0xd8492e,
  yamanote: 0x9acd32,
};

function std(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => { c.castShadow = cast; c.receiveShadow = receive; });
  return o;
}

// ---------------------------------------------------------------- environment

/** Far end of the fog: the skyline fades into haze a few kilometres out. */
const FOG_NEAR = 1600, FOG_FAR = 10000;

function buildSky(scene: THREE.Scene): SceneRefs['night']['sky'] {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(15000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(COLORS.skyTop) }, mid: { value: new THREE.Color(COLORS.skyMid) },
        horizon: { value: new THREE.Color(COLORS.skyHorizon) }, sunDir: { value: SUN_DIR.clone() }, glow: { value: 1 },
      },
      vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      // Three-band dusk gradient, a warm glow round the setting sun and a faint band of cloud.
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; uniform float glow; varying vec3 vPos;' +
        'void main(){ vec3 d = normalize(vPos); float h = clamp(d.y, 0.0, 1.0);' +
        ' vec3 c = h < 0.18 ? mix(horizon, mid, smoothstep(0.0, 0.18, h)) : mix(mid, top, smoothstep(0.18, 0.75, h));' +
        ' float s = max(dot(d, normalize(sunDir)), 0.0);' +
        ' c += vec3(1.0, 0.55, 0.25) * (pow(s, 24.0) * 0.9 + pow(s, 4.0) * 0.25) * glow;' +
        ' float band = smoothstep(0.05, 0.1, h) * (1.0 - smoothstep(0.1, 0.2, h)) * (0.5 + 0.5 * sin(d.x * 9.0 + d.z * 5.0));' +
        ' c = mix(c, vec3(0.42, 0.28, 0.38), band * 0.35);' +
        ' gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.onBeforeRender = (_r, _s, cam) => sky.position.copy(cam.position);
  scene.add(sky);
  return (sky.material as THREE.ShaderMaterial).uniforms as SceneRefs['night']['sky'];
}

/** Direction to the sun (late afternoon, ~40° up) and how far the shadow camera sits. */
const SUN_DIR = new THREE.Vector3(-0.62, 0.36, 0.55).normalize();
const SUN_DIST = 5000;

function buildLights(scene: THREE.Scene): { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; amb: THREE.AmbientLight } {
  // Dusk: a cool blue sky fill, warm low sun (long shadows).
  const hemi = new THREE.HemisphereLight(0xc4cfee, 0x6a6458, 0.92 * L);
  const amb = new THREE.AmbientLight(0x8a90a8, 0.16 * L);
  scene.add(hemi, amb);
  const sun = new THREE.DirectionalLight(0xffe0c2, 1.05 * L);
  sun.position.copy(SUN_DIR).multiplyScalar(SUN_DIST);
  sun.castShadow = true;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  sun.shadow.mapSize.setScalar(coarse ? 1024 : 2048);
  const cam = sun.shadow.camera;
  cam.left = -1400; cam.right = 1400; cam.top = 1400; cam.bottom = -1400; cam.near = 100; cam.far = SUN_DIST + 6000;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 2;
  scene.add(sun, sun.target);
  return { sun, hemi, amb };
}

const waterMat = () => new THREE.MeshStandardMaterial({ color: COLORS.water, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.9 });

function buildGround(scene: THREE.Scene): void {
  const bump = detailNoise();
  bump.repeat.set(GROUND.w / 30, GROUND.d / 30);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND.w + 30000, GROUND.d + 30000),
    std(0xffffff, { map: groundTexture(), bumpMap: bump, bumpScale: 0.4, roughness: 0.95 }),
  );
  // The painted texture covers GROUND; the plane extends far beyond (to the fog) with its edge colour.
  const t = ground.material.map!;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set((GROUND.w + 30000) / GROUND.w, (GROUND.d + 30000) / GROUND.d);
  t.offset.set(-15000 / GROUND.w, -15000 / GROUND.d);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(GROUND.cx, 0, GROUND.cz);
  ground.receiveShadow = true;
  scene.add(ground);
  // Moat and ponds: flat water on their tiles.
  const mat = waterMat();
  for (const p of WORLD) {
    if (p.mat !== 'water' || p.group === 'river') continue;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), mat);
    w.rotation.x = -Math.PI / 2;
    w.position.set(p.x, 3, p.z);
    scene.add(w);
  }
  // Kanda river: one smooth strip along its course, with railings on both banks.
  const pts: THREE.Vector3[] = [];
  const idx: number[] = [];
  const banks: [THREE.Vector2[], THREE.Vector2[]] = [[], []];
  KANDA.forEach((p, i) => {
    const a = KANDA[Math.max(0, i - 1)], b = KANDA[Math.min(KANDA.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * (RIVER_WIDTH / 2 + 2), nz = dx / l * (RIVER_WIDTH / 2 + 2);
    pts.push(new THREE.Vector3(p.x + nx, 3, p.z + nz), new THREE.Vector3(p.x - nx, 3, p.z - nz));
    if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    const k = (RIVER_WIDTH / 2 + 6) / (RIVER_WIDTH / 2 + 2);
    banks[0].push(new THREE.Vector2(p.x + nx * k, p.z + nz * k));
    banks[1].push(new THREE.Vector2(p.x - nx * k, p.z - nz * k));
  });
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  g.setIndex(idx);
  g.computeVertexNormals();
  const river = new THREE.Mesh(g, mat);
  river.material.side = THREE.DoubleSide;
  scene.add(river);
  scene.add(...riverRailings(banks));
}

/**
 * Riverside railings (posts with a top and a middle bar) along both banks, broken off
 * where a bridge crosses so they never cut across a deck. Two instanced meshes.
 */
function riverRailings(banks: THREE.Vector2[][]): THREE.Object3D[] {
  const bridges = WORLD.filter((p) => p.group === 'bridge');
  const onBridge = (x: number, z: number) => bridges.some((b) => Math.abs(x - b.x) < b.w / 2 + 14 && Math.abs(z - b.z) < b.d / 2 + 14);
  const posts: THREE.Matrix4[] = [], bars: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const STEP = 40;
  for (const line of banks) {
    // Even samples along the bank.
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1], n = Math.max(1, Math.round(a.distanceTo(b) / STEP));
      for (let k = 0; k < n; k++) pts.push(a.clone().lerp(b, k / n));
    }
    pts.push(line[line.length - 1].clone());
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      if (onBridge(a.x, a.y)) continue;
      posts.push(new THREE.Matrix4().makeTranslation(a.x, 14, a.y));
      const b = pts[i + 1];
      if (!b || onBridge(b.x, b.y)) continue;
      const len = a.distanceTo(b), yaw = Math.atan2(b.x - a.x, b.y - a.y);
      q.setFromAxisAngle(up, yaw);
      for (const y of [26, 15]) {
        bars.push(new THREE.Matrix4().compose(new THREE.Vector3((a.x + b.x) / 2, y, (a.y + b.y) / 2), q, new THREE.Vector3(1, 1, len)));
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x5f6b66, roughness: 0.5, metalness: 0.4 });
  const mk = (geo: THREE.BufferGeometry, ms: THREE.Matrix4[]) => {
    const m = new THREE.InstancedMesh(geo, mat, ms.length);
    ms.forEach((x, i) => m.setMatrixAt(i, x));
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    return m;
  };
  return [mk(new THREE.BoxGeometry(2.4, 28, 2.4), posts), mk(new THREE.BoxGeometry(1.6, 1.6, 1), bars)];
}

// ---------------------------------------------------------------- world primitives

function rampGeometry(p: RampPrim): THREE.BufferGeometry {
  if (p.style === 'stairs') {
    const len = p.axis === 'x' ? p.w : p.d;
    // Real stair treads: a riser of ~17 cm (4.5 units).
    const n = Math.max(3, Math.round((p.hHigh - p.hLow) / 4.5));
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const t1 = (i + 1) / n;
      const h = p.hLow + (p.hHigh - p.hLow) * t1;
      const sliceLen = len / n;
      const u = (i + 0.5) / n;
      const off = (p.dir === 1 ? u - 0.5 : 0.5 - u) * len;
      const g = new THREE.BoxGeometry(p.axis === 'x' ? sliceLen : p.w, h, p.axis === 'z' ? sliceLen : p.d);
      g.translate(p.axis === 'x' ? p.x + off : p.x, h / 2, p.axis === 'z' ? p.z + off : p.z);
      parts.push(worldUv(g, 80).toNonIndexed());
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
  return worldUv(g, 120).toNonIndexed();
}

/** Material key for a primitive; boxes sharing a key are merged into one mesh. */
function matKey(p: Prim): string {
  if (p.group === 'expressway' || p.group === 'stadium') return 'concretePlain';
  if (p.kind === 'box' && (p.group === 'diet' || p.group === 'dietTower' || p.group === 'palaceHall' || p.group === 'museum')) return 'stoneFacade';
  if (p.kind === 'ramp') return p.mat === 'earth' ? 'grass' : p.mat === 'wood' ? 'woodLight' : p.mat === 'concrete' ? 'concretePlain' : p.mat;
  return p.mat;
}

/** Rewrites a geometry's UVs in world units (1 tile per `tileU` across, `tileV` up) so textures never stretch. */
function worldUv(geo: THREE.BufferGeometry, tileU: number, tileV = tileU): THREE.BufferGeometry {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    if (ny > 0.5) uv.setXY(i, x / tileU, z / tileU);
    else if (nx > 0.5) uv.setXY(i, z / tileU, y / tileV);
    else uv.setXY(i, x / tileU, y / tileV);
  }
  return geo;
}

/** Streets, buildings and furniture are drawn by city.ts; these are its primitives. */
const CITY_MATS = new Set(['bldg', 'sidewalk', 'car', 'vending', 'pole', 'tree', 'water']);

/**
 * Turns the landmark primitives into meshes (grouped by material and merged).
 */
function buildWorld(scene: THREE.Scene): void {
  const stoneTex = stoneTexture();
  const facadeConcrete = facadeTexture('concrete'), facadeGlass = facadeTexture('glass');
  const mats: Record<string, THREE.Material | THREE.Material[]> = {
    stone: std(COLORS.stone, { map: stoneTex, roughness: 0.9 }),
    plaster: std(COLORS.plaster, { roughness: 0.95 }),
    wood: std(COLORS.wood),
    woodLight: std(COLORS.woodLight),
    grass: std(COLORS.grass),
    hedge: std(COLORS.hedge, { roughness: 1 }),
    concrete: std(0xffffff, { map: facadeConcrete, roughness: 0.8 }),
    concretePlain: std(0xb3afa6, { map: detailNoise(), roughness: 0.95 }),
    glass: std(0xffffff, { map: facadeGlass, roughness: 0.3, metalness: 0.3 }),
    brick: std(0xffffff, { map: brickFacadeTexture(), roughness: 0.9 }),
    stoneFacade: std(0xffffff, { map: stoneFacadeTexture(), roughness: 0.85 }),
    steel: std(COLORS.towerRed, { roughness: 0.6 }),
    metal: std(0x6f8796, { roughness: 0.5, metalness: 0.3 }),
    earth: [std(0x9a8f7a, { map: stoneTex }), std(0x9a8f7a, { map: stoneTex }), std(COLORS.grass), std(0x9a8f7a), std(0x9a8f7a, { map: stoneTex }), std(0x9a8f7a, { map: stoneTex })],
  };
  const tiles: Record<string, [number, number]> = { concrete: [200, 4 * STOREY], glass: [200, 4 * STOREY], brick: [200, 200], stone: [120, 120], concretePlain: [160, 160], stoneFacade: [240, 2 * 110] };
  const buckets = new Map<string, THREE.BufferGeometry[]>();
  const add = (key: string, g: THREE.BufferGeometry) => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key)!.push(g); };
  for (const p of WORLD) {
    if (CITY_MATS.has(p.mat)) continue;
    // Drawn as custom landmarks instead.
    if (p.group === 'radioTower' || p.group === 'tokyoTowerSpire' || p.group === 'tokyoTowerLeg' || p.group === 'dome') continue;
    if (p.kind === 'ramp') { add(matKey(p), rampGeometry(p)); continue; }
    const b = p as BoxPrim;
    const h = b.y1 - b.y0, key = matKey(b);
    const [tu, tv] = tiles[key] ?? [64, 64];
    const g = new THREE.BoxGeometry(b.w, h, b.d);
    g.translate(b.x, b.y0 + h / 2, b.z);
    worldUv(g, tu, tv);
    if (b.mat === 'earth') {
      const m = new THREE.Mesh(g, mats.earth);
      scene.add(shadowed(m));
      continue;
    }
    add(key, g.toNonIndexed());
  }
  for (const [key, list] of buckets) {
    const merged = mergeGeometries(list.map((g) => { g.deleteAttribute('uv1'); return g; }));
    if (!merged) continue;
    scene.add(shadowed(new THREE.Mesh(merged, mats[key] ?? mats.concrete)));
  }
}

// ---------------------------------------------------------------- landmarks

/** A lattice frustum (square in plan, `r` = half width) as open sides with see-through bracing. */
function lattice(y0: number, y1: number, r0: number, r1: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1 * Math.SQRT2, r0 * Math.SQRT2, y1 - y0, 4, Math.max(1, Math.round((y1 - y0) / Math.max(40, r0))), true);
  g.rotateY(Math.PI / 4);
  g.translate(0, (y0 + y1) / 2, 0);
  // One bracing panel per ~panel-size square: 4 faces around, rows up the height.
  const panel = Math.max(30, (r0 + r1) / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4 * Math.round((r0 + r1) / panel), uv.getY(i) * Math.max(1, Math.round((y1 - y0) / panel)));
  return new THREE.Mesh(g, mat);
}

/** 管制塔: a red-and-white lattice radio mast in 日比谷公園, with the owner's flag on top. */
function buildRadioTower(scene: THREE.Scene): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const g = new THREE.Group();
  g.position.set(TOWER.x, 0, TOWER.z);
  const lat = latticeTexture();
  const red = std(COLORS.towerRed, { map: lat, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  const white = std(0xf1ede4, { map: lat, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  const segs = 6, h = MAST_H / segs;
  for (let i = 0; i < segs; i++) g.add(lattice(i * h, (i + 1) * h, 40 - i * 5, 40 - (i + 1) * 5, i % 2 ? white : red));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 110, 6), std(COLORS.gold, { metalness: 0.6, roughness: 0.35 }));
  pole.position.y = MAST_H + 50;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(110, 66), std(0x777777, { side: THREE.DoubleSide }));
  flag.position.set(55, MAST_H + 70, 0);
  g.add(flag);
  scene.add(shadowed(g));
  return flag;
}

/** Tokyo Tower, Tokyo Station's domes, the Diet's pyramid, Tokyo Dome, and landmarks beyond the tracks. */
function buildLandmarks(scene: THREE.Scene): void {
  const lat = latticeTexture();
  const orange = std(0xe0501f, { map: lat, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
  const white = std(0xf3efe6, { map: lat, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
  const solidWhite = std(0xf1ede4, { roughness: 0.5 }), solidOrange = std(0xe0501f, { roughness: 0.5 });
  const t = LANDMARKS.tokyoTower, H = TOKYO_TOWER_H;
  const tower = new THREE.Group();
  tower.position.set(t.x, 0, t.z);
  // Legs spread to the four corners (±200), then the body tapers to the antenna.
  const stages: [number, number, number, number][] = [
    [0, 1100, 225, 115], [1100, 1900, 115, 80], [1900, 2700, 80, 55], [2700, 3000, 55, 50],
    [3130, 3700, 44, 30], [3700, 4100, 30, 22], [4160, 4600, 16, 8],
  ];
  stages.forEach(([y0, y1, r0, r1], i) => tower.add(lattice(y0, y1, r0, r1, i % 2 ? white : orange)));
  for (const [y0, y1, w] of [[3000, 3130, 170], [4100, 4160, 80]] as const) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, y1 - y0, w), solidWhite);
    deck.position.y = (y0 + y1) / 2;
    tower.add(deck);
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 4, 30, w + 4), std(0x3a4652, { roughness: 0.2, metalness: 0.4 }));
    band.position.y = (y0 + y1) / 2 + 10;
    tower.add(band);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(3, 8, H - 4600, 6), solidOrange);
  antenna.position.y = 4600 + (H - 4600) / 2;
  tower.add(antenna);
  scene.add(shadowed(tower, true, false));

  const st = LANDMARKS.tokyoStation;
  const domeMat = std(0x4c5358, { roughness: 0.45, metalness: 0.35 });
  for (const dz of [-st.d / 2 + 90, st.d / 2 - 90]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(78, 78, 60, 8), std(0xffffff, { map: brickFacadeTexture() }));
    base.position.set(st.x, st.h + 30, st.z + dz);
    const d = new THREE.Mesh(new THREE.SphereGeometry(78, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    d.scale.set(1, 1.1, 1);
    d.position.set(st.x, st.h + 60, st.z + dz);
    scene.add(shadowed(base), shadowed(d));
  }
  const roofTop = new THREE.Mesh(new THREE.BoxGeometry(st.w + 8, 16, st.d + 8), std(0x3b3f4a));
  roofTop.position.set(st.x, st.h + 8, st.z);
  scene.add(shadowed(roofTop));

  const dt = LANDMARKS.diet;
  const pyr = new THREE.Mesh(new THREE.ConeGeometry(115, 260, 4), std(0x9a9486, { map: stoneTexture() }));
  pyr.rotation.y = Math.PI / 4;
  pyr.position.set(dt.x, realHeight(55) + 130, dt.z);
  scene.add(shadowed(pyr));

  const dm = LANDMARKS.dome;
  const wallRing = new THREE.Mesh(new THREE.CylinderGeometry(dm.r * 1.05, dm.r * 1.1, 180, 40), std(0xe8e6e0, { roughness: 0.6 }));
  wallRing.position.set(dm.x, 90, dm.z);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(dm.r * 1.05, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0xf6f5f1, { roughness: 0.4 }));
  cap.scale.set(1, 0.4, 1);
  cap.position.set(dm.x, 180, dm.z);
  scene.add(shadowed(wallRing), shadowed(cap));

  // Beyond the tracks: 都庁 and the 西新宿 skyscrapers, and Tokyo Skytree far to the east.
  const glass = std(0xffffff, { map: facadeTexture('glass'), roughness: 0.3, metalness: 0.3 });
  const tall = (lat: number, lon: number, h: number, w: number, d: number, twin = false) => {
    const p = geo(lat, lon), hh = realHeight(h);
    for (const off of twin ? [-w * 0.3, w * 0.3] : [0]) {
      const g = worldUv(new THREE.BoxGeometry(twin ? w * 0.4 : w, hh, d), 200, 4 * STOREY);
      const m = new THREE.Mesh(g, glass);
      m.position.set(p.x + off, hh / 2, p.z);
      scene.add(m);
    }
    if (twin) {
      const base = new THREE.Mesh(worldUv(new THREE.BoxGeometry(w, hh * 0.6, d), 200, 4 * STOREY), glass);
      base.position.set(p.x, hh * 0.3, p.z);
      scene.add(base);
    }
  };
  tall(35.6896, 139.6917, 243, 560, 320, true); // 都庁
  tall(35.6921, 139.6953, 223, 300, 260); // 新宿センタービル
  tall(35.6925, 139.6978, 210, 280, 280); // 住友ビル
  tall(35.6908, 139.6966, 204, 300, 240); // 損保ジャパン
  tall(35.6937, 139.6926, 200, 260, 260); // 新宿パークタワー
  tall(35.6601, 139.7009, 230, 300, 300); // 渋谷スクランブルスクエア
  tall(35.6717, 139.7727, 230, 320, 320); // 汐留
  const sky = new THREE.Group();
  const sp = geo(35.7101, 139.8107), SH = realHeight(634);
  sky.position.set(sp.x, 0, sp.z);
  const skyMat = std(0xe9eef3, { map: lat, alphaTest: 0.5, side: THREE.DoubleSide });
  sky.add(lattice(0, SH * 0.55, 230, 70, skyMat));
  sky.add(lattice(SH * 0.55, SH * 0.85, 70, 40, skyMat));
  for (const [y, r] of [[SH * 0.55, 150], [SH * 0.78, 110]] as const) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 90, 24), std(0xdfe5ea, { roughness: 0.3, metalness: 0.4 }));
    disc.position.y = y;
    sky.add(disc);
  }
  const needle = new THREE.Mesh(new THREE.CylinderGeometry(6, 20, SH * 0.15, 8), std(0xe9eef3));
  needle.position.y = SH * 0.925;
  sky.add(needle);
  scene.add(sky);
}

// ---------------------------------------------------------------- the Yamanote line

/** Track viaduct along the loop (≈7.5 m up, with arches), station buildings and name boards, and the train. */
function buildRailway(scene: THREE.Scene): THREE.Group {
  const vt = viaductTexture();
  const side = std(0xffffff, { map: vt, roughness: 0.9 });
  const deck = std(0x8a857b, { roughness: 0.95 }), rail = std(0x4a4a4a, { metalness: 0.6, roughness: 0.4 });
  const ballast = std(0x6d675e, { map: detailNoise(), roughness: 1 });
  const fence = std(0x33413a, { roughness: 0.8 });
  const catenary = std(0x7c8388, { metalness: 0.4, roughness: 0.5 });
  const H = VIADUCT.h, W = VIADUCT.w;
  // Everything static is merged per material (one draw call each).
  const parts: Record<string, THREE.BufferGeometry[]> = { side: [], deck: [], ballast: [], rail: [], fence: [], catenary: [], roof: [], hall: [] };
  const put = (key: string, g: THREE.BufferGeometry, m: THREE.Matrix4) => parts[key].push(g.applyMatrix4(m).toNonIndexed());
  const frame = (x: number, z: number, ang: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(1, 1, 1));
  const local = (m: THREE.Matrix4, x: number, y: number, z: number) => m.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
  for (let i = 0; i < LOOP.length; i++) {
    const a = LOOP[i], b = LOOP[(i + 1) % LOOP.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z), ang = Math.atan2(b.x - a.x, b.z - a.z);
    const F = frame((a.x + b.x) / 2, (a.z + b.z) / 2, ang), L2 = len + W * 0.6;
    const bodyG = new THREE.BoxGeometry(W, H, L2);
    const uv = bodyG.attributes.uv;
    // Arches repeat every 10 m along the viaduct.
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (L2 / 260));
    put('side', bodyG, local(F, 0, H / 2, 0));
    put('ballast', new THREE.BoxGeometry(W - 40, 8, L2), local(F, 0, H + 4, 0));
    for (const off of [-72, -44, 44, 72]) put('rail', new THREE.BoxGeometry(4, 5, L2), local(F, off, H + 10, 0));
    for (const sd of [-1, 1]) put('deck', new THREE.BoxGeometry(10, 36, L2), local(F, sd * (W / 2 - 5), H + 18, 0));
    // Fence at the edge of the walkable city (inside the loop is to the right of travel).
    put('fence', new THREE.BoxGeometry(3, 80, len), local(F, WALK_EDGE - 6, 40, 0));
    // Overhead line poles every ~50 m.
    const n = Math.floor(len / 1300);
    for (let k = 0; k <= n; k++) {
      const along = (n ? k / n - 0.5 : 0) * len;
      for (const sd of [-1, 1]) put('catenary', new THREE.CylinderGeometry(5, 6, 200, 6), local(F, sd * (W / 2 - 16), H + 100, along));
      put('catenary', new THREE.BoxGeometry(W - 20, 8, 8), local(F, 0, H + 190, along));
    }
  }
  // Station buildings under the tracks, platform roofs on top, and name boards.
  STATIONS.forEach((s, i) => {
    const a = LOOP[(i + LOOP.length - 1) % LOOP.length], b = LOOP[(i + 1) % LOOP.length];
    const F = frame(s.x, s.z, Math.atan2(b.x - a.x, b.z - a.z));
    put('roof', new THREE.BoxGeometry(W + 30, 10, 700), local(F, 0, H + 130, 0));
    for (const z of [-300, -100, 100, 300]) put('roof', new THREE.BoxGeometry(10, 130, 10), local(F, 0, H + 65, z));
    put('hall', new THREE.BoxGeometry(W + 20, H - 20, 500), local(F, 0, (H - 20) / 2, 0));
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 72;
    const cg = c.getContext('2d')!;
    cg.fillStyle = '#f7f5ef';
    cg.fillRect(0, 0, 256, 72);
    cg.fillStyle = '#' + COLORS.yamanote.toString(16);
    cg.fillRect(0, 58, 256, 14);
    cg.fillStyle = '#1b1b1b';
    cg.font = 'bold 40px sans-serif';
    cg.textAlign = 'center';
    cg.textBaseline = 'middle';
    cg.fillText(s.name, 128, 30);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: true }));
    sp.scale.set(380, 107, 1);
    sp.position.set(s.x, H + 260, s.z);
    scene.add(sp);
  });
  const roof = std(0x5d6670, { roughness: 0.5, metalness: 0.3 });
  const mats: Record<string, THREE.Material> = { side, deck, ballast, rail, fence, catenary, roof, hall: std(0xd8d2c6, { map: vt, roughness: 0.8 }) };
  for (const [k, list] of Object.entries(parts)) {
    const merged = mergeGeometries(list);
    if (merged) scene.add(shadowed(new THREE.Mesh(merged, mats[k]), k !== 'fence' && k !== 'rail', true));
  }
  // The train: six silver E235 cars with the green stripe (20 m each).
  const train = new THREE.Group();
  const body = std(0xd9dde2, { metalness: 0.45, roughness: 0.3 }), stripe = std(COLORS.yamanote), glass = std(0x1f2a33, { roughness: 0.15, metalness: 0.3 });
  for (let i = 0; i < 6; i++) {
    const car = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(76, 94, 510), body);
    b.position.y = 57;
    const s = new THREE.Mesh(new THREE.BoxGeometry(77, 10, 511), stripe);
    s.position.y = 40;
    const w = new THREE.Mesh(new THREE.BoxGeometry(78, 26, 470), glass);
    w.position.y = 72;
    const band = new THREE.Mesh(new THREE.BoxGeometry(77.5, 6, 511), stripe);
    band.position.y = 90;
    car.add(b, s, w, band);
    car.userData.index = i;
    train.add(car);
  }
  scene.add(shadowed(train));
  return train;
}

const LOOP_LEN: number[] = [];
{
  let acc = 0;
  for (let i = 0; i < LOOP.length; i++) {
    LOOP_LEN.push(acc);
    const a = LOOP[i], b = LOOP[(i + 1) % LOOP.length];
    acc += Math.hypot(b.x - a.x, b.z - a.z);
  }
  LOOP_LEN.push(acc);
}

function pointOnLoop(s: number): { x: number; z: number; ang: number } {
  const total = LOOP_LEN[LOOP_LEN.length - 1];
  s = ((s % total) + total) % total;
  let i = 0;
  while (LOOP_LEN[i + 1] < s) i++;
  const a = LOOP[i], b = LOOP[(i + 1) % LOOP.length];
  const t = (s - LOOP_LEN[i]) / (LOOP_LEN[i + 1] - LOOP_LEN[i]);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, ang: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** Moves the train round the loop (outer track, ≈ 60 km/h at street scale). Purely visual. */
export function updateTrain(refs: SceneRefs, timeSec: number): void {
  const head = timeSec * 450;
  for (const car of refs.train.children) {
    const p = pointOnLoop(head - (car.userData.index as number) * 520);
    car.position.set(p.x - Math.cos(p.ang) * 58, VIADUCT.h + 12, p.z + Math.sin(p.ang) * 58);
    car.rotation.y = p.ang;
  }
}
export function buildScene(canvas: HTMLCanvasElement): SceneRefs {
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.fog);
  scene.fog = new THREE.Fog(COLORS.fog, FOG_NEAR, FOG_FAR);
  const camera = new THREE.PerspectiveCamera(65, 1, 2, 30000);

  const sky = buildSky(scene);
  const { sun, hemi, amb } = buildLights(scene);
  buildGround(scene);
  buildWorld(scene);
  buildCity(scene);
  buildLandmarks(scene);
  const towerMesh = buildRadioTower(scene);
  buildBases(scene);
  buildLockPoints(scene);
  buildDistricts(scene);
  const train = buildRailway(scene);
  // A fixed handful of lamp lights (never more or fewer: that would recompile every material).
  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < LAMP_LIGHTS; i++) {
    const l = new THREE.PointLight(0xffd9a0, 0, LAMP_REACH, 1);
    l.position.set(0, -1000, 0);
    scene.add(l);
    lights.push(l);
  }
  // A soft light over the player's head at night (the way ahead is never pitch dark, even in a park).
  const near = new THREE.PointLight(0xdfe4ff, 0, 650, 1);
  scene.add(near);
  return { renderer, scene, camera, towerMesh, sun, train, night: { sky, hemi, amb, k: -1 }, lamps: { lights, near, at: null } };
}

/** How many street lamps near the player actually light the street (the rest only glow). */
const LAMP_LIGHTS = 5;
/** How far a lamp's light reaches (≈31 m). */
const LAMP_REACH = 800;

/**
 * Street lamps near the player light the street after dark: the nearest few get a real
 * warm light (the far ones keep their glow and pool). Re-picked when the player has moved.
 */
export function updateStreetLights(refs: SceneRefs, x: number, z: number, y = 0): void {
  const k = Math.max(0, refs.night.k);
  const lamps = refs.lamps;
  const on = 0.25 + 0.75 * k;
  for (const l of lamps.lights) l.intensity = l.position.y > 0 ? 4 * L * on : 0;
  lamps.near.position.set(x, y + 160, z);
  lamps.near.intensity = 1.6 * L * k;
  if (lamps.at && Math.hypot(lamps.at.x - x, lamps.at.z - z) < 60) return;
  lamps.at = { x, z };
  const near: { d: number; hx: number; hz: number }[] = [];
  for (const l of LIGHTS) {
    const hx = l.x + Math.cos(l.ang) * 62, hz = l.z + Math.sin(l.ang) * 62;
    const d = Math.hypot(hx - x, hz - z);
    if (d > LAMP_REACH * 1.3) continue;
    near.push({ d, hx, hz });
  }
  near.sort((a, b) => a.d - b.d);
  lamps.lights.forEach((l, i) => {
    const n = near[i];
    if (n) l.position.set(n.hx, 210, n.hz);
    else l.position.set(0, -1000, 0);
  });
}

interface Palette {
  top: THREE.Color; mid: THREE.Color; horizon: THREE.Color; fog: THREE.Color; sun: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color;
  sunI: number; hemiI: number; ambI: number; glow: number; elev: number;
}
const pal = (o: Record<'top' | 'mid' | 'horizon' | 'fog' | 'sun' | 'hemiSky' | 'hemiGround', number> & Pick<Palette, 'sunI' | 'hemiI' | 'ambI' | 'glow' | 'elev'>): Palette => ({
  top: new THREE.Color(o.top), mid: new THREE.Color(o.mid), horizon: new THREE.Color(o.horizon), fog: new THREE.Color(o.fog), sun: new THREE.Color(o.sun),
  hemiSky: new THREE.Color(o.hemiSky), hemiGround: new THREE.Color(o.hemiGround), sunI: o.sunI, hemiI: o.hemiI, ambI: o.ambI, glow: o.glow, elev: o.elev,
});
/** Day: a clear neutral afternoon (the city's true colours, crisp shadows from a high sun). */
const DAY = pal({ top: 0x3a6cc2, mid: 0x93b6e2, horizon: 0xdce6ee, fog: 0xb7c3d3, sun: 0xfff4e6, hemiSky: 0xd2def2, hemiGround: 0x6a665e, sunI: 0.86, hemiI: 0.74, ambI: 0.1, glow: 0.35, elev: 0.95 });
/** Sunset: a warm orange low sun, long shadows, a pink-violet sky. */
const SUNSET = pal({ top: 0x2e4886, mid: 0xb79aa4, horizon: 0xffa25a, fog: 0xbcaaa4, sun: 0xffc286, hemiSky: 0xc8c8de, hemiGround: 0x6a5c52, sunI: 1.05, hemiI: 0.88, ambI: 0.15, glow: 1.2, elev: 0.32 });
/** Night: deep navy over a lit city — moonlight, the windows, signs and lamps carry it. */
const NIGHT = pal({ top: 0x050a22, mid: 0x111c48, horizon: 0x2c2858, fog: 0x1a2240, sun: 0xb4bad6, hemiSky: 0x7a80a0, hemiGround: 0x33313c, sunI: 0.5, hemiI: 0.8, ambI: 0.3, glow: 0.1, elev: 0.7 });

const BLEND = pal({ top: 0, mid: 0, horizon: 0, fog: 0, sun: 0, hemiSky: 0, hemiGround: 0, sunI: 0, hemiI: 0, ambI: 0, glow: 0, elev: 0 });
const KEYS = ['top', 'mid', 'horizon', 'fog', 'sun', 'hemiSky', 'hemiGround'] as const;
const NUMS = ['sunI', 'hemiI', 'ambI', 'glow', 'elev'] as const;
const smooth01 = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The palette for a moment of the match: f = share of the match played, k = nightfall (gameplay's, 0 … 1). */
export function skyPalette(f: number, k: number): Palette {
  const w = smooth01(0.12, 0.42, f); // day → sunset
  for (const c of KEYS) BLEND[c].copy(DAY[c]).lerp(SUNSET[c], w).lerp(NIGHT[c], k);
  for (const c of NUMS) BLEND[c] = (DAY[c] + (SUNSET[c] - DAY[c]) * w) * (1 - k) + NIGHT[c] * k;
  return BLEND;
}

/** Where the sun (or the moon) is: low in the west at sunset, higher by day and at night. */
let sunDir = SUN_DIR.clone();

/**
 * Time of day (v9.0): a neutral day, a warm orange sunset, then a deep navy night as the
 * match goes on. `f` is the share of the match played (visual only); `k` is the gameplay
 * nightfall, which also drives the city lights (windows, signs, lamps) brightening.
 */
export function setTimeOfDay(refs: SceneRefs, f: number, k: number): void {
  const key = f * 0.5 + k * 3;
  if (Math.abs(key - lastKey) < 0.003) return;
  lastKey = key;
  refs.night.k = k;
  const p = skyPalette(f, k), n = refs.night;
  n.sky.top.value.copy(p.top);
  n.sky.mid.value.copy(p.mid);
  n.sky.horizon.value.copy(p.horizon);
  n.sky.glow.value = p.glow;
  const fog = refs.scene.fog as THREE.Fog;
  fog.color.copy(p.fog);
  (refs.scene.background as THREE.Color).copy(fog.color);
  fog.far = FOG_FAR - 1400 * k;
  refs.sun.color.copy(p.sun);
  refs.sun.intensity = p.sunI * L;
  n.hemi.color.copy(p.hemiSky);
  n.hemi.groundColor.copy(p.hemiGround);
  n.hemi.intensity = p.hemiI * L;
  n.amb.intensity = p.ambI * L;
  // Sun elevation: same bearing, lower toward sunset (long shadows), the moon a little higher.
  const flat = Math.hypot(SUN_DIR.x, SUN_DIR.z);
  sunDir = new THREE.Vector3(SUN_DIR.x / flat * Math.cos(p.elev), Math.sin(p.elev), SUN_DIR.z / flat * Math.cos(p.elev));
  (n.sky as unknown as { sunDir?: { value: THREE.Vector3 } }).sunDir?.value.copy(sunDir);
  for (const g of NIGHT_GLOW) g.set(k);
}
let lastKey = -1;

/** Older entry point: nightfall only (the match's share played follows from it). */
export function setNightfall(refs: SceneRefs, k: number): void {
  setTimeOfDay(refs, k > 0 ? 0.35 + 0.65 * k : 0.42, k);
}

/** Keeps the shadow frustum centred on the player so a big map still gets crisp shadows. */
export function followSun(refs: SceneRefs, x: number, y: number, z: number): void {
  refs.sun.position.set(x + sunDir.x * SUN_DIST, y + sunDir.y * SUN_DIST, z + sunDir.z * SUN_DIST);
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

export function renderPixelRatio(devicePixelRatio: number, cap = MAX_PIXEL_RATIO): number {
  return Math.min(Math.max(devicePixelRatio || 1, 1), cap);
}

/** Lowered by the quality governor when the game runs slowly. */
let ratioCap = MAX_PIXEL_RATIO;
export function setPixelRatioCap(cap: number): void {
  ratioCap = Math.min(MAX_PIXEL_RATIO, cap);
}

/** Matches the drawing buffer and camera aspect to the canvas's CSS size and the screen's pixel ratio. */
export function resizeRenderer(refs: SceneRefs, canvas: HTMLCanvasElement): void {
  const r = canvas.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return;
  refs.renderer.setPixelRatio(renderPixelRatio(window.devicePixelRatio, ratioCap));
  refs.renderer.setSize(r.width, r.height, false);
  refs.camera.aspect = r.width / r.height;
  refs.camera.fov = fovForAspect(refs.camera.aspect);
  refs.camera.updateProjectionMatrix();
}
