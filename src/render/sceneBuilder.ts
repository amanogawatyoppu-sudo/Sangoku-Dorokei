import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NATION_IDS, NATIONS } from '../config/nations';
import type { BoxPrim, Prim, RampPrim } from '../config/map';
import { GROUND, KANDA, LANDMARKS, LOOP, RIVER_WIDTH, STATIONS, TOWER, WORLD, insideLoop } from '../config/map';
import { rampHeight } from '../sim/systems/world';
import { detailNoise, emblemTexture, groundTexture, stoneTexture, windowTexture } from './textures';

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

/** Rewrites a geometry's UVs in world units (1 tile per `tile`) so textures never stretch. */
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
    new THREE.SphereGeometry(9000, 32, 16),
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
  sky.frustumCulled = false;
  sky.onBeforeRender = (_r, _s, cam) => sky.position.copy(cam.position);
  scene.add(sky);
}

function buildLights(scene: THREE.Scene): THREE.DirectionalLight {
  scene.add(new THREE.HemisphereLight(0xc9d6f0, 0x3d4a2c, 0.55 * L));
  scene.add(new THREE.AmbientLight(0x8899aa, 0.12 * L));
  const sun = new THREE.DirectionalLight(0xffe0b8, 0.95 * L);
  sun.position.set(-700, 900, 500);
  sun.castShadow = true;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  sun.shadow.mapSize.setScalar(coarse ? 1024 : 2048);
  const cam = sun.shadow.camera;
  cam.left = -900; cam.right = 900; cam.top = 900; cam.bottom = -900; cam.near = 100; cam.far = 3000;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 1.5;
  scene.add(sun, sun.target);
  return sun;
}

const waterMat = () => new THREE.MeshStandardMaterial({ color: COLORS.water, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9 });

function buildGround(scene: THREE.Scene): void {
  const bump = detailNoise();
  bump.repeat.set(GROUND.w / 18, GROUND.d / 18);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND.w, GROUND.d),
    std(0xffffff, { map: groundTexture(), bumpMap: bump, bumpScale: 0.5, roughness: 0.95 }),
  );
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
    w.position.set(p.x, 5, p.z);
    scene.add(w);
  }
  // Kanda river: one smooth strip along its course.
  const pts: THREE.Vector3[] = [];
  const idx: number[] = [];
  KANDA.forEach((p, i) => {
    const a = KANDA[Math.max(0, i - 1)], b = KANDA[Math.min(KANDA.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * (RIVER_WIDTH / 2 + 2), nz = dx / l * (RIVER_WIDTH / 2 + 2);
    pts.push(new THREE.Vector3(p.x + nx, 5, p.z + nz), new THREE.Vector3(p.x - nx, 5, p.z - nz));
    if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  });
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  g.setIndex(idx);
  g.computeVertexNormals();
  const river = new THREE.Mesh(g, mat);
  river.material.side = THREE.DoubleSide;
  scene.add(river);
}

// ---------------------------------------------------------------- world primitives

function rampGeometry(p: RampPrim): THREE.BufferGeometry {
  if (p.style === 'stairs') {
    const len = p.axis === 'x' ? p.w : p.d;
    const n = Math.max(3, Math.round(len / 11));
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const t1 = (i + 1) / n;
      const h = p.hLow + (p.hHigh - p.hLow) * t1;
      const sliceLen = len / n;
      const u = (i + 0.5) / n;
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
  return g.toNonIndexed();
}

/** Material key for a primitive; boxes sharing a key are merged into one mesh. */
function matKey(p: Prim): string {
  if (p.kind === 'ramp') return p.mat === 'earth' ? 'grass' : p.mat === 'wood' ? 'woodLight' : p.mat;
  return p.mat;
}

/**
 * Turns every world primitive into meshes. Primitives are grouped by material
 * and merged, so a city of hundreds of buildings is a handful of draw calls.
 */
function buildWorld(scene: THREE.Scene): void {
  const stoneTex = stoneTexture();
  const mats: Record<string, THREE.Material | THREE.Material[]> = {
    stone: std(COLORS.stone, { map: stoneTex, roughness: 0.9 }),
    plaster: std(COLORS.plaster, { roughness: 0.95 }),
    wood: std(COLORS.wood),
    woodLight: std(COLORS.woodLight),
    grass: std(COLORS.grass),
    hedge: std(COLORS.hedge, { roughness: 1 }),
    concrete: std(0xffffff, { map: windowTexture('#a7a397', '#3d4a58'), roughness: 0.8 }),
    glass: std(0xffffff, { map: windowTexture('#7f93a6', '#2b4257'), roughness: 0.35, metalness: 0.2 }),
    brick: std(0xb5543a, { map: stoneTex, roughness: 0.9 }),
    steel: std(COLORS.towerRed, { roughness: 0.6 }),
    earth: [std(0x9a7d5a, { map: stoneTex }), std(0x9a7d5a, { map: stoneTex }), std(COLORS.grass), std(0x9a7d5a), std(0x9a7d5a, { map: stoneTex }), std(0x9a7d5a, { map: stoneTex })],
  };
  const buckets = new Map<string, THREE.BufferGeometry[]>();
  const add = (key: string, g: THREE.BufferGeometry) => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key)!.push(g); };
  const trunks: THREE.Matrix4[] = [], crowns: THREE.Matrix4[] = [];
  for (const p of WORLD) {
    if (p.mat === 'water') continue;
    // Drawn as custom landmarks instead.
    if (p.group === 'radioTower' || p.group === 'tokyoTowerSpire' || p.group === 'dome') continue;
    if (p.mat === 'tree') {
      const b = p as BoxPrim;
      trunks.push(new THREE.Matrix4().makeTranslation(b.x, b.y1 / 2 - 8, b.z));
      crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.y1, b.z), new THREE.Quaternion(), new THREE.Vector3(1, 0.9, 1)));
      continue;
    }
    if (p.kind === 'ramp') { add(matKey(p), rampGeometry(p)); continue; }
    const b = p as BoxPrim;
    const h = b.y1 - b.y0;
    const g = worldUv(new THREE.BoxGeometry(b.w, h, b.d), b.mat === 'concrete' || b.mat === 'glass' ? 48 : 64);
    g.translate(b.x, b.y0 + h / 2, b.z);
    if (b.mat === 'earth') {
      const m = new THREE.Mesh(g, mats.earth);
      scene.add(shadowed(m));
      continue;
    }
    add(matKey(b), g.toNonIndexed());
  }
  for (const [key, list] of buckets) {
    const merged = mergeGeometries(list.map((g) => { g.deleteAttribute('uv1'); return g; }));
    if (!merged) continue;
    scene.add(shadowed(new THREE.Mesh(merged, mats[key] ?? mats.concrete)));
  }
  if (trunks.length) {
    const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(3, 4, 34, 6), std(COLORS.woodDark), trunks.length);
    trunks.forEach((m, i) => tm.setMatrixAt(i, m));
    const cm = new THREE.InstancedMesh(new THREE.SphereGeometry(22, 8, 6), std(COLORS.leaf, { flatShading: true }), crowns.length);
    crowns.forEach((m, i) => cm.setMatrixAt(i, m));
    scene.add(shadowed(tm), shadowed(cm));
  }
}

// ---------------------------------------------------------------- landmarks

/** 管制塔: a red-and-white lattice radio tower in 日比谷公園, with the owner's flag on top. */
function buildRadioTower(scene: THREE.Scene): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const g = new THREE.Group();
  g.position.set(TOWER.x, 0, TOWER.z);
  const red = std(COLORS.towerRed, { roughness: 0.6 }), white = std(0xf1ede4, { roughness: 0.6 });
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const h = 25, r0 = 22 - i * 3, r1 = 22 - (i + 1) * 3;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 4, 1, true), i % 2 ? white : red);
    m.material.side = THREE.DoubleSide;
    m.rotation.y = Math.PI / 4;
    m.position.y = i * h + h / 2;
    g.add(m);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 34, 6), std(COLORS.gold, { metalness: 0.6, roughness: 0.35 }));
  pole.position.y = segs * 25 + 14;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(30, 18), std(0x777777, { side: THREE.DoubleSide }));
  flag.position.set(15, segs * 25 + 22, 0);
  g.add(flag);
  scene.add(shadowed(g));
  return flag;
}

/** Tokyo Tower's upper lattice, Tokyo Station's domes, the Diet's pyramid, Tokyo Dome's roof. */
function buildLandmarks(scene: THREE.Scene): void {
  const red = std(COLORS.towerRed, { roughness: 0.6 }), white = std(0xf1ede4, { roughness: 0.6 });
  const t = LANDMARKS.tokyoTower;
  const spire = new THREE.Group();
  spire.position.set(t.x, 80, t.z);
  let y = 0;
  for (let i = 0; i < 9; i++) {
    const h = 30 - i, r0 = 18 - i * 1.7, r1 = 18 - (i + 1) * 1.7;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(1, r1), Math.max(1.5, r0), h, 4, 1, true), i % 2 ? white : red);
    m.material.side = THREE.DoubleSide;
    m.rotation.y = Math.PI / 4;
    m.position.y = y + h / 2;
    spire.add(m);
    y += h;
  }
  const deckRoof = new THREE.Mesh(new THREE.BoxGeometry(40, 14, 40), white);
  deckRoof.position.y = 150;
  spire.add(deckRoof);
  scene.add(shadowed(spire));

  const st = LANDMARKS.tokyoStation;
  const domeMat = std(0x5b6067, { roughness: 0.5, metalness: 0.3 });
  for (const dz of [-60, 60]) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    d.position.set(st.x, 44, st.z + dz);
    scene.add(shadowed(d));
  }
  const roofTop = new THREE.Mesh(new THREE.BoxGeometry(42, 4, 162), std(0x3b3f4a));
  roofTop.position.set(st.x, 46, st.z);
  scene.add(shadowed(roofTop));

  const dt = LANDMARKS.diet;
  const pyr = new THREE.Mesh(new THREE.ConeGeometry(22, 34, 4), std(0x9a9486, { map: stoneTexture() }));
  pyr.rotation.y = Math.PI / 4;
  pyr.position.set(dt.x, 96 + 17, dt.z);
  scene.add(shadowed(pyr));

  const dm = LANDMARKS.dome;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(92, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0xf2f0ea, { roughness: 0.5 }));
  dome.scale.set(1, 0.62, 1);
  dome.position.set(dm.x, 0, dm.z);
  scene.add(shadowed(dome));
}

// ---------------------------------------------------------------- the Yamanote line

/** Track viaduct along the loop, station name boards, and a skyline beyond. */
function buildRailway(scene: THREE.Scene): THREE.Group {
  const bed = std(0x77736a), rail = std(0x444444, { metalness: 0.6, roughness: 0.4 }), fence = std(0x3d4a3d);
  for (let i = 0; i < LOOP.length; i++) {
    const a = LOOP[i], b = LOOP[(i + 1) % LOOP.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z), ang = Math.atan2(b.x - a.x, b.z - a.z);
    const seg = new THREE.Group();
    seg.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    seg.rotation.y = ang;
    const v = new THREE.Mesh(new THREE.BoxGeometry(46, 18, len + 46), bed);
    v.position.y = 9;
    seg.add(v);
    for (const off of [-10, 10]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(2, 2, len + 40), rail);
      r.position.set(off, 19, 0);
      seg.add(r);
    }
    const f = new THREE.Mesh(new THREE.BoxGeometry(2, 30, len + 40), fence);
    f.position.set(0, 15, 0);
    // Fence on the inner side of the track (inside = to the right of travel for a clockwise loop).
    f.position.x = 24;
    seg.add(f);
    scene.add(shadowed(seg));
  }
  // Station boards.
  for (const s of STATIONS) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 72;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f7f5ef';
    g.fillRect(0, 0, 256, 72);
    g.fillStyle = '#' + COLORS.yamanote.toString(16);
    g.fillRect(0, 58, 256, 14);
    g.fillStyle = '#1b1b1b';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s.name, 128, 30);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: true }));
    sp.scale.set(90, 25, 1);
    sp.position.set(s.x, 62, s.z);
    scene.add(sp);
  }
  // Skyline beyond the tracks (visual only; nobody can go there).
  const rnd = (() => { let a = 1234; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const mats: THREE.Matrix4[] = [];
  let guard = 0;
  while (mats.length < 520 && guard++ < 20000) {
    const x = GROUND.cx + (rnd() - 0.5) * (GROUND.w + 1400), z = GROUND.cz + (rnd() - 0.5) * (GROUND.d + 1400);
    if (insideLoop(x, z, -140)) continue;
    const h = 30 + rnd() * rnd() * 220, w = 50 + rnd() * 90;
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, 40 + rnd() * 90)));
  }
  const sky = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0xffffff, { map: windowTexture('#8e8a80', '#39434f') }), mats.length);
  mats.forEach((m, i) => sky.setMatrixAt(i, m));
  scene.add(sky);
  // The train: six silver cars with the green stripe.
  const train = new THREE.Group();
  const body = std(0xd9dde2, { metalness: 0.4, roughness: 0.35 }), stripe = std(COLORS.yamanote), glass = std(0x223040, { roughness: 0.2 });
  for (let i = 0; i < 6; i++) {
    const car = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(12, 13, 56), body);
    b.position.y = 7;
    const s = new THREE.Mesh(new THREE.BoxGeometry(12.4, 2.4, 56.2), stripe);
    s.position.y = 5;
    const w = new THREE.Mesh(new THREE.BoxGeometry(12.6, 3.4, 48), glass);
    w.position.y = 9.5;
    car.add(b, s, w);
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

/** Moves the train round the loop (one lap ≈ 100 s). Purely visual. */
export function updateTrain(refs: SceneRefs, timeSec: number): void {
  const head = timeSec * 150;
  for (const car of refs.train.children) {
    const p = pointOnLoop(head - (car.userData.index as number) * 60);
    car.position.set(p.x, 20, p.z);
    car.rotation.y = p.ang;
  }
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

export function buildScene(canvas: HTMLCanvasElement): SceneRefs {
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.fog);
  scene.fog = new THREE.Fog(COLORS.fog, 900, 3400);
  const camera = new THREE.PerspectiveCamera(65, 1, 1, 12000);

  buildSky(scene);
  const sun = buildLights(scene);
  buildGround(scene);
  buildWorld(scene);
  buildLandmarks(scene);
  const towerMesh = buildRadioTower(scene);
  buildBases(scene);
  buildJails(scene);
  const train = buildRailway(scene);
  return { renderer, scene, camera, towerMesh, sun, train };
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
