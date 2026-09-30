import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A blocky (voxel) chibi warrior, as on the key art: a big square head, black
 * armour with gold trim, and cloth in the nation's colour (sash, scarf, cape,
 * sleeves, trousers, hair tie). About 47 units tall, like before. One skinned
 * mesh per character (18 bones, rigid skinning, vertex colours): one draw call each.
 *
 * The nation's emblem is on the cape (the back is what you capture from).
 * Hair, face, skin and build vary per person; roles look the same.
 * Local +Z is the facing; the character's left is +X.
 */

export const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

type Region = 'skin' | 'hair' | 'cloth' | 'clothDark' | 'band' | 'armor' | 'plate' | 'gold' | 'boot' | 'eye' | 'shine' | 'mouth';

export interface Look {
  skin: number;
  hair: number;
  hairStyle: 'pony' | 'bun' | 'short' | 'spiky' | 'long' | 'band' | 'side';
  beard: boolean;
  /** Shoulder width factor and overall height factor (visual only). */
  build: number;
  height: number;
}

const SKINS = [0xf1c9a0, 0xe8ba8e, 0xdaa77c, 0xc79068, 0xad7a54];
const HAIRS = [0x141011, 0x1c1512, 0x261a14, 0x33231a, 0x4a3222, 0x5e5a58];

/** Deterministic look per character id (the same person every match). */
export function lookFor(id: number): Look {
  let a = (id * 2654435761) >>> 0;
  const r = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length) % arr.length];
  const styles: Look['hairStyle'][] = ['pony', 'pony', 'bun', 'short', 'spiky', 'long', 'band', 'side'];
  return { skin: pick(SKINS), hair: pick(HAIRS), hairStyle: pick(styles), beard: r() < 0.14, build: 0.95 + r() * 0.1, height: 0.97 + r() * 0.06 };
}

/** Rest-pose joint positions (absolute), before the build factor: short legs, a big head. */
function joints(w: number): Record<BoneName, [BoneName | null, number, number, number]> {
  return {
    root: [null, 0, 0, 0], hips: ['root', 0, 19, 0], spine: ['hips', 0, 22, 0], chest: ['spine', 0, 26, 0],
    neck: ['chest', 0, 30.4, 0], head: ['neck', 0, 31.4, 0],
    armL: ['chest', 8.2 * w, 29.2, 0], foreL: ['armL', 8.4 * w, 23.6, 0], handL: ['foreL', 8.5 * w, 18.6, 0],
    armR: ['chest', -8.2 * w, 29.2, 0], foreR: ['armR', -8.4 * w, 23.6, 0], handR: ['foreR', -8.5 * w, 18.6, 0],
    thighL: ['hips', 3.3, 18, 0], shinL: ['thighL', 3.3, 10, 0], footL: ['shinL', 3.3, 2.6, 0],
    thighR: ['hips', -3.3, 18, 0], shinR: ['thighR', -3.3, 10, 0], footR: ['shinR', -3.3, 2.6, 0],
  };
}

/** Blocks stay rigid: no skin is shared across joints. */
const BLEND_R: Partial<Record<BoneName, number>> = {};

type BoneFor = BoneName | ((x: number, y: number, z: number) => BoneName);

class SkinBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  bone: number[] = [];
  idx: number[] = [];
  /** Vertex ranges per region, so the nation colour can be repainted. */
  regions = new Map<Region, [number, number][]>();

  add(geo: THREE.BufferGeometry, bone: BoneFor, region: Region, color: number): void {
    const g = geo;
    const p = g.attributes.position, n = g.attributes.normal;
    const base = this.pos.length / 3;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      this.pos.push(x, y, z);
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.bone.push(BI[typeof bone === 'function' ? bone(x, y, z) : bone]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    const list = this.regions.get(region) ?? [];
    list.push([base, base + p.count]);
    this.regions.set(region, list);
  }

  /**
   * Skin weights: each vertex follows its own bone, and near a joint it is shared
   * with the bone on the other side, so limbs bend smoothly instead of creasing.
   */
  build(J: Record<BoneName, [BoneName | null, number, number, number]>): THREE.BufferGeometry {
    const si: number[] = [], sw: number[] = [];
    const children = new Map<BoneName, BoneName[]>();
    for (const b of BONES) { const par = J[b][0]; if (par) children.set(par, [...(children.get(par) ?? []), b]); }
    for (let i = 0; i < this.bone.length; i++) {
      const own = BONES[this.bone[i]];
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      const infl: [number, number][] = [];
      const near = (joint: BoneName, other: BoneName) => {
        const R = BLEND_R[joint];
        if (!R) return;
        const d = Math.hypot(x - J[joint][1], y - J[joint][2], z - J[joint][3]);
        if (d < R) infl.push([BI[other], 0.5 * (1 - d / R)]);
      };
      const parent = J[own][0];
      if (parent && parent !== 'root') near(own, parent);
      for (const c of children.get(own) ?? []) near(c, c);
      infl.sort((a, b) => b[1] - a[1]);
      const top = infl.slice(0, 3);
      const rest = Math.max(0.3, 1 - top.reduce((a, q) => a + q[1], 0));
      const total = rest + top.reduce((a, q) => a + q[1], 0);
      const ids = [this.bone[i], ...top.map((q) => q[0])], ws = [rest, ...top.map((q) => q[1])];
      while (ids.length < 4) { ids.push(0); ws.push(0); }
      si.push(...ids);
      sw.push(...ws.map((v) => v / total));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Torso blocks follow hips / spine / chest by height. */
const torsoBone = (_x: number, y: number): BoneName => (y < 21 ? 'hips' : y < 24.5 ? 'spine' : 'chest');

export interface Human {
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Rest positions of the bones (hips height is animated). */
  rest: Record<BoneName, THREE.Vector3>;
  material: THREE.MeshStandardMaterial;
  emblem: THREE.Mesh;
  look: Look;
  /** Repaints the nation's cloth (sash, scarf, cape, sleeves, trousers, hair tie) in a nation's colour (disguise). */
  setNationColor(color: number): void;
  /** Snipers only: the rifle (a child of the chest bone) and the point at its muzzle. */
  gun: THREE.Group | null;
  muzzle: THREE.Object3D | null;
}

/**
 * Scoped bolt-action rifle (≈1.25 m). Origin at the pistol grip, barrel along +Z,
 * butt at z ≈ -9.5 so it sits against the shoulder when the grip is ~9 units forward.
 */
function buildRifle(): { gun: THREE.Group; muzzle: THREE.Object3D } {
  const metal: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [];
  const bx = (list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) =>
    list.push(new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z).toNonIndexed());
  const tube = (list: THREE.BufferGeometry[], r: number, len: number, x: number, y: number, z: number) =>
    list.push(new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2).translate(x, y, z).toNonIndexed());
  bx(wood, 1.6, 2.7, 7, 0, -0.5, -6.2); // stock
  bx(wood, 1.1, 2.4, 1.3, 0, -1.6, -1.9, -0.35); // grip
  bx(wood, 1.7, 1.8, 7.5, 0, 0.1, 5.6); // fore-end
  bx(metal, 1.5, 2.0, 8.5, 0, 0.3, 0.8); // receiver
  bx(metal, 1.0, 2.6, 1.8, 0, -1.6, 1.8); // magazine
  tube(metal, 0.33, 12, 0, 0.55, 14.5); // barrel
  tube(metal, 0.5, 1.2, 0, 0.55, 20.5); // muzzle brake
  tube(metal, 0.75, 7.5, 0, 2.3, 0.8); // scope
  tube(metal, 0.95, 1.4, 0, 2.3, 4.6); // objective bell
  bx(metal, 0.8, 1.0, 0.8, 0, 1.4, -1.5); // scope mount
  bx(metal, 0.8, 1.0, 0.8, 0, 1.4, 3.0);
  const gun = new THREE.Group();
  const mk = (list: THREE.BufferGeometry[], color: number, rough: number, metalness: number) => {
    const m = new THREE.Mesh(mergeGeometries(list)!, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness }));
    m.castShadow = true;
    gun.add(m);
  };
  mk(metal, 0x2a2c30, 0.45, 0.6);
  mk(wood, 0x5a3b24, 0.7, 0);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.55, 21.3);
  gun.add(muzzle);
  return { gun, muzzle };
}

/**
 * A warm rim of dusk light round each figure's outline, so people read clearly
 * against the city (same shader for everyone: one program).
 */
function addRimLight(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
      totalEmissiveRadiance += vec3(1.0, 0.72, 0.5) * rimF * 0.42 + diffuseColor.rgb * 0.06;`);
  };
  m.customProgramCacheKey = () => 'human-rim';
}

const ARMOR = 0x1e1c22, PLATE = 0x2c2932, GOLD = 0xc9a24e, BOOT = 0x2a1d17;
const dark = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

export function buildHuman(id: number, nationColor: number, emblemMat: THREE.Material, opts: { gun?: boolean } = {}): Human {
  const look = lookFor(id);
  const w = look.build;
  const J = joints(w);
  const b = new SkinBuilder();
  const S = look.skin, H = look.hair, C = nationColor, CD = dark(nationColor, 0.55);

  // ---- legs: cloth trousers, a gold-rimmed knee guard, black greaves and boots.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const x = s * 3.3;
    b.add(box(4.6, 8.2, 4.8, x, 14, 0), `thigh${side}`, 'clothDark', CD);
    b.add(box(4.2, 6.6, 4.4, x, 6.3, 0), `shin${side}`, 'armor', ARMOR);
    b.add(box(4.5, 0.8, 4.7, x, 9.3, 0), `shin${side}`, 'gold', GOLD);
    b.add(box(4.0, 2.6, 1.0, x, 10.2, 2.6), `shin${side}`, 'plate', PLATE); // knee guard
    b.add(box(4.2, 0.5, 1.1, x, 8.9, 2.65), `shin${side}`, 'gold', GOLD);
    b.add(box(4.6, 2.8, 6.4, x, 1.4, 0.9), `foot${side}`, 'boot', BOOT);
    b.add(box(4.8, 0.6, 6.6, x, 0.3, 0.9), `foot${side}`, 'armor', ARMOR);
  }

  // ---- torso: cloth skirt under armoured tassets, the sash, the cuirass with gold lines.
  b.add(box(12.6 * w, 5.2, 7.8, 0, 17.6, 0), torsoBone, 'cloth', C); // skirt
  for (const s of [1, -1]) {
    b.add(box(5.4 * w, 5.6, 1.0, s * 3.2 * w, 17.2, 4.3), 'hips', 'armor', ARMOR); // tassets
    b.add(box(5.6 * w, 0.6, 1.1, s * 3.2 * w, 14.6, 4.35), 'hips', 'gold', GOLD);
    b.add(box(5.4 * w, 5.6, 1.0, s * 3.2 * w, 17.2, -4.3), 'hips', 'armor', ARMOR);
  }
  b.add(box(12.2 * w, 9.4, 7.6, 0, 25.4, 0), torsoBone, 'armor', ARMOR); // body
  b.add(box(13.0 * w, 2.4, 8.4, 0, 21.2, 0), 'spine', 'cloth', C); // sash
  b.add(box(2.4, 2.2, 1.2, 3.6 * w, 20.4, 4.6), 'spine', 'cloth', C); // sash knot
  b.add(box(1.6, 4.0, 0.8, 3.9 * w, 17.8, 4.7), 'hips', 'cloth', C); // knot tail
  b.add(box(10.2 * w, 5.4, 1.0, 0, 27.0, 4.1), 'chest', 'plate', PLATE); // chest plate
  for (const y of [24.2, 29.8]) b.add(box(10.8 * w, 0.6, 1.2, 0, y, 4.15), 'chest', 'gold', GOLD);
  b.add(box(0.6, 5.0, 1.2, 0, 27.0, 4.2), 'chest', 'gold', GOLD);
  b.add(box(10.6 * w, 2.6, 8.8, 0, 30.6, 0), 'chest', 'cloth', C); // scarf round the neck
  b.add(box(2.6, 6.5, 0.9, -2.8 * w, 26.2, -4.9), 'chest', 'cloth', C); // scarf tail over the cape
  // Cape down the back (the emblem is on it).
  b.add(box(11.8 * w, 14.5, 0.9, 0, 23.0, -4.5), 'chest', 'cloth', C);
  b.add(box(12.0 * w, 0.8, 1.0, 0, 15.9, -4.5), 'chest', 'gold', GOLD);

  // ---- arms: armoured shoulders, cloth sleeves, black bracers with gold cuffs, block hands.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const ax = s * 8.4 * w;
    b.add(box(5.4, 3.4, 7.2, s * 8.0 * w, 29.8, 0), `arm${side}`, 'armor', ARMOR); // pauldron
    b.add(box(5.6, 0.7, 7.4, s * 8.0 * w, 28.0, 0), `arm${side}`, 'gold', GOLD);
    b.add(box(3.9, 5.2, 3.9, ax, 25.6, 0), `arm${side}`, 'cloth', C); // sleeve
    b.add(box(4.1, 4.4, 4.1, ax, 21.2, 0), `fore${side}`, 'armor', ARMOR); // bracer
    b.add(box(4.3, 0.8, 4.3, ax, 19.2, 0), `fore${side}`, 'gold', GOLD);
    b.add(box(3.5, 3.5, 3.5, s * 8.5 * w, 16.9, 0.1), `hand${side}`, 'skin', S);
  }

  // ---- head: one big block, a block face, and hair.
  b.add(box(3.6, 1.6, 3.6, 0, 31.2, 0), 'neck', 'skin', S);
  b.add(box(13, 12.4, 12, 0, 38.2, 0.3), 'head', 'skin', S);
  for (const s of [1, -1]) {
    b.add(box(1.8, 2.8, 0.4, s * 2.7, 37.8, 6.45), 'head', 'eye', 0x17120f);
    b.add(box(0.7, 0.7, 0.2, s * 2.7 + 0.45, 38.7, 6.7), 'head', 'shine', 0xfaf6ee); // catch-light
    b.add(new THREE.BoxGeometry(3.0, 0.8, 0.4).rotateZ(s * -0.22).translate(s * 2.8, 40.3, 6.45), 'head', 'hair', H); // brow (determined)
    b.add(box(1.2, 2.2, 1.8, s * 6.9, 37.4, 0.2), 'head', 'skin', dark(S, 0.9)); // ear
  }
  b.add(box(1.8, 0.55, 0.4, 0, 34.9, 6.45), 'head', 'mouth', 0x7a3a32);
  if (look.beard) b.add(box(7.5, 2.4, 1.0, 0, 33.0, 6.5), 'head', 'hair', H);
  // Hair: a cap over the top, back and sides, with blocky bangs.
  b.add(box(13.8, 3.2, 12.8, 0, 44.9, 0.1), 'head', 'hair', H);
  b.add(box(13.8, 10.5, 2.4, 0, 39.9, -5.9), 'head', 'hair', H);
  for (const s of [1, -1]) b.add(box(1.4, 7.5, 11.5, s * 6.95, 40.8, -0.5), 'head', 'hair', H);
  for (const [bx, len] of [[-4.6, 3.6], [-1.4, 2.6], [1.8, 3.4], [4.9, 2.2]] as const) b.add(box(3.4, len, 1.6, bx, 43.5 - len / 2, 6.3), 'head', 'hair', H);
  const hs = look.hairStyle;
  if (hs === 'pony') {
    b.add(box(3.0, 2.4, 2.2, 0, 43.6, -7.7), 'head', 'band', C); // tie
    b.add(new THREE.BoxGeometry(3.2, 3.2, 5.6).rotateX(-0.55).translate(0, 45.4, -10.2), 'head', 'hair', H);
    b.add(new THREE.BoxGeometry(2.6, 2.6, 4.4).rotateX(-1.0).translate(0, 48.2, -12.6), 'head', 'hair', H);
  } else if (hs === 'bun') {
    b.add(box(2.8, 1.2, 2.8, 0, 46.9, -1.5), 'head', 'band', C);
    b.add(box(4.0, 3.6, 4.0, 0, 49.2, -1.5), 'head', 'hair', H);
  } else if (hs === 'spiky') {
    for (const [x, z, h] of [[-4, 2, 2.6], [0, 3, 3.4], [4, 1.5, 2.4], [-2, -3, 3], [3, -3.5, 2.8]] as const) b.add(box(3, h, 3, x, 46.5 + h / 2, z), 'head', 'hair', H);
  } else if (hs === 'long') {
    b.add(box(13.4, 8, 2.2, 0, 32.8, -6.4), 'head', 'hair', H);
    b.add(box(3.0, 2.0, 2.4, 0, 36.2, -7.4), 'head', 'band', C);
  } else if (hs === 'band') {
    b.add(box(14.2, 2.0, 13.2, 0, 42.3, 0.1), 'head', 'band', C); // hachimaki
    for (const s of [1, -1]) b.add(new THREE.BoxGeometry(1.2, 3.6, 0.6).rotateZ(s * 0.4).translate(s * 1.0, 40.6, -6.9), 'head', 'band', C);
  } else if (hs === 'side') {
    b.add(new THREE.BoxGeometry(6, 2.6, 7).rotateZ(0.25).translate(3.5, 47, 1.5), 'head', 'hair', H);
  }

  const geo = b.build(J);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.08, flatShading: true });
  addRimLight(material);
  const bones = {} as Record<BoneName, THREE.Bone>;
  const rest = {} as Record<BoneName, THREE.Vector3>;
  for (const name of BONES) {
    const [parent, x, y, z] = J[name];
    const bone = new THREE.Bone();
    bone.name = name;
    const p = parent ? J[parent] : null;
    bone.position.set(x - (p?.[1] ?? 0), y - (p?.[2] ?? 0), z - (p?.[3] ?? 0));
    rest[name] = bone.position.clone();
    bones[name] = bone;
    if (parent) bones[parent].add(bone);
  }
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(bones.root);
  mesh.bind(new THREE.Skeleton(BONES.map((n) => bones[n])));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // skinned bounds do not follow the pose
  // Nation emblem on the cape, riding on the chest bone.
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), emblemMat);
  emblem.position.set(0, -2.2, -5.0);
  emblem.rotation.y = Math.PI;
  emblem.castShadow = false;
  bones.chest.add(emblem);

  const colorAttr = geo.attributes.color as THREE.BufferAttribute;
  let painted = nationColor;
  const setNationColor = (color: number) => {
    if (color === painted) return;
    painted = color;
    for (const [region, k] of [['cloth', 1], ['band', 1], ['clothDark', 0.55]] as [Region, number][]) {
      const c = new THREE.Color(color).multiplyScalar(k);
      for (const [a, z] of b.regions.get(region) ?? []) for (let i = a; i < z; i++) colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    colorAttr.needsUpdate = true;
  };
  let gun: THREE.Group | null = null, muzzle: THREE.Object3D | null = null;
  if (opts.gun) {
    ({ gun, muzzle } = buildRifle());
    gun.scale.setScalar(0.85); // sized to the chibi body
    bones.chest.add(gun);
  }
  return { mesh, bones, rest, material, emblem, look, setNationColor, gun, muzzle };
}
