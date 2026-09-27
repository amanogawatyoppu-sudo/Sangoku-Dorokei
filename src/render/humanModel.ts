import * as THREE from 'three';

/**
 * A person at real proportions (≈7.7 heads tall, ~46.5 units ≈ 1.7 m) built as
 * one skinned mesh per character: 18 bones, rigid skinning, colours in vertex
 * colours, so a character is a single draw call however many there are.
 *
 * Everyone wears a happi-style jacket and a headband in their nation's colour,
 * with the nation's emblem on the back (the back is what you capture from).
 * Faces, hair, build, trousers and shoes vary per person; roles look the same.
 * Local +Z is the facing; the character's left is +X.
 */

export const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

type Region = 'skin' | 'hair' | 'jacket' | 'trim' | 'pants' | 'shoe' | 'eye' | 'mouth' | 'band' | 'cap';

export interface Look {
  skin: number;
  hair: number;
  hairStyle: 'short' | 'long' | 'bun' | 'cap' | 'crop';
  cap: number;
  pants: number;
  shoe: number;
  trim: number;
  /** Shoulder width factor and overall height factor (visual only). */
  build: number;
  height: number;
}

const SKINS = [0xf2cfae, 0xe8bf98, 0xdcae86, 0xc99873, 0xb07e58];
const HAIRS = [0x151210, 0x1f1712, 0x2b1f17, 0x3d2a1c, 0x5b3d26, 0x7a5a3a, 0x8c8a86, 0x6b4a8a];
const PANTS = [0x23262d, 0x2f3b52, 0x3b3f4a, 0x1d1d1f, 0x4a4338, 0x5c6470, 0x2b3a2f];
const SHOES = [0x111111, 0xf1f1ee, 0x5a3a22, 0x2a2a2e, 0xd9d2c4];
const CAPS = [0x1f2a3a, 0x2b2b2b, 0xe8e4da, 0x7a2a22];

/** Deterministic look per character id (the same person every match). */
export function lookFor(id: number): Look {
  let a = (id * 2654435761) >>> 0;
  const r = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length) % arr.length];
  const styles: Look['hairStyle'][] = ['short', 'short', 'crop', 'long', 'bun', 'cap'];
  return {
    skin: pick(SKINS), hair: pick(HAIRS), hairStyle: pick(styles), cap: pick(CAPS),
    pants: pick(PANTS), shoe: pick(SHOES), trim: r() < 0.6 ? 0xf3efe6 : 0x1c1c20,
    build: 0.93 + r() * 0.14, height: 0.95 + r() * 0.09,
  };
}

/** Rest-pose joint positions (absolute), before the build factor. */
function joints(w: number): Record<BoneName, [BoneName | null, number, number, number]> {
  return {
    root: [null, 0, 0, 0], hips: ['root', 0, 24, 0], spine: ['hips', 0, 28, 0], chest: ['spine', 0, 33, 0],
    neck: ['chest', 0, 39, 0], head: ['neck', 0, 40.5, 0],
    armL: ['chest', 7.3 * w, 37, 0], foreL: ['armL', 7.7 * w, 27.2, 0], handL: ['foreL', 7.9 * w, 19.4, 0],
    armR: ['chest', -7.3 * w, 37, 0], foreR: ['armR', -7.7 * w, 27.2, 0], handR: ['foreR', -7.9 * w, 19.4, 0],
    thighL: ['hips', 3.4, 23, 0], shinL: ['thighL', 3.4, 12.8, 0], footL: ['shinL', 3.4, 2.4, 0],
    thighR: ['hips', -3.4, 23, 0], shinR: ['thighR', -3.4, 12.8, 0], footR: ['shinR', -3.4, 2.4, 0],
  };
}

class SkinBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  /** Vertex ranges per region, so the nation colour can be repainted. */
  regions = new Map<Region, [number, number][]>();

  add(geo: THREE.BufferGeometry, bone: BoneName, region: Region, color: number): void {
    const g = geo;
    const p = g.attributes.position, n = g.attributes.normal;
    const base = this.pos.length / 3;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.si.push(BI[bone], 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    const list = this.regions.get(region) ?? [];
    list.push([base, base + p.count]);
    this.regions.set(region, list);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const cyl = (rTop: number, rBot: number, y0: number, y1: number, zs: number, seg = 12) =>
  new THREE.CylinderGeometry(rTop, rBot, y1 - y0, seg).translate(0, (y0 + y1) / 2, 0).scale(1, 1, zs);
const capsule = (r: number, len: number, x: number, y: number, z = 0) => new THREE.CapsuleGeometry(r, len, 3, 8).translate(x, y, z);
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const ellipsoid = (r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, ws = 12, hs = 9, phi0 = 0, phiL = Math.PI * 2, th0 = 0, thL = Math.PI) =>
  new THREE.SphereGeometry(r, ws, hs, phi0, phiL, th0, thL).scale(sx, sy, sz).translate(x, y, z);

export interface Human {
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Rest positions of the bones (hips height is animated). */
  rest: Record<BoneName, THREE.Vector3>;
  material: THREE.MeshStandardMaterial;
  emblem: THREE.Mesh;
  look: Look;
  /** Repaints the jacket and headband in a nation's colour (disguise). */
  setNationColor(color: number): void;
}

export function buildHuman(id: number, nationColor: number, emblemMat: THREE.Material): Human {
  const look = lookFor(id);
  const w = look.build;
  const J = joints(w);
  const b = new SkinBuilder();
  const S = look.skin;
  // Legs and hips.
  b.add(cyl(6.1 * w, 6.3 * w, 20.2, 24.2, 0.7), 'hips', 'pants', look.pants);
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    b.add(capsule(2.55, 6.4, s * 3.4, 18.0), `thigh${side}`, 'pants', look.pants);
    b.add(ellipsoid(2.05, 1, 1, 1, s * 3.4, 12.9, 0, 10, 7), `shin${side}`, 'pants', look.pants); // knee
    b.add(capsule(1.95, 6.8, s * 3.4, 7.8), `shin${side}`, 'pants', look.pants);
    b.add(box(3.3, 2.5, 6.8, s * 3.4, 1.25, 1.3), `foot${side}`, 'shoe', look.shoe);
  }
  // Jacket (happi): hem, body, shoulders, sleeves; contrasting lapels down the front.
  b.add(cyl(6.5 * w, 6.8 * w, 23.2, 26.4, 0.72), 'hips', 'jacket', nationColor);
  b.add(cyl(6.0 * w, 6.35 * w, 25.8, 31.2, 0.66), 'spine', 'jacket', nationColor);
  b.add(cyl(6.7 * w, 6.1 * w, 30.5, 37.8, 0.6), 'chest', 'jacket', nationColor);
  b.add(cyl(3.2, 6.6 * w, 37.7, 38.9, 0.6), 'chest', 'jacket', nationColor); // shoulder line
  for (const s of [1, -1]) {
    b.add(ellipsoid(2.05, 1, 0.95, 1, s * 6.5 * w, 36.9, 0, 10, 7), 'chest', 'jacket', nationColor);
    b.add(box(0.95, 9, 0.5, s * 1.25, 33.3, 4.15), 'chest', 'trim', look.trim);
  }
  b.add(capsule(1.85, 6.4, 7.5 * w, 32.2), 'armL', 'jacket', nationColor);
  b.add(capsule(1.85, 6.4, -7.5 * w, 32.2), 'armR', 'jacket', nationColor);
  // Forearms and hands.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    b.add(ellipsoid(1.45, 1, 1, 1, s * 7.7 * w, 27.3, 0, 8, 6), `fore${side}`, 'skin', S); // elbow
    b.add(capsule(1.35, 5.8, s * 7.85 * w, 23.0), `fore${side}`, 'skin', S);
    b.add(ellipsoid(1.3, 0.72, 1.3, 0.95, s * 8.0 * w, 17.6, 0.2, 8, 6), `hand${side}`, 'skin', S);
  }
  // Neck, head and face.
  b.add(cyl(1.75, 1.9, 37.2, 41, 1, 10), 'neck', 'skin', S);
  b.add(ellipsoid(3.1, 0.93, 1.18, 1.02, 0, 43.1, 0.15, 14, 11), 'head', 'skin', S);
  for (const s of [1, -1]) {
    b.add(ellipsoid(0.65, 0.6, 1, 0.9, s * 2.85, 43, 0, 6, 5), 'head', 'skin', S);
    b.add(box(0.75, 0.42, 0.25, s * 1.08, 43.6, 3.02), 'head', 'eye', 0x161616);
    b.add(box(1.1, 0.28, 0.3, s * 1.1, 44.35, 2.95), 'head', 'hair', look.hair);
  }
  b.add(box(0.55, 1.1, 0.7, 0, 42.8, 3.25), 'head', 'skin', S);
  b.add(box(1.1, 0.25, 0.2, 0, 41.55, 3.05), 'head', 'mouth', 0x8a4a42);
  // Hair (or a cap), and the headband in the nation's colour.
  if (look.hairStyle === 'cap') {
    b.add(ellipsoid(3.4, 0.96, 1.0, 1.06, 0, 43.9, -0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.46), 'head', 'cap', look.cap);
    b.add(box(4.4, 0.35, 2.6, 0, 44.45, 3.55), 'head', 'cap', look.cap);
    b.add(ellipsoid(3.3, 0.95, 1.1, 1.05, 0, 43.1, -0.3, 12, 8, Math.PI, Math.PI, 0.45 * Math.PI, 0.3 * Math.PI), 'head', 'hair', look.hair);
  } else {
    b.add(ellipsoid(3.28, 0.95, 1.12, 1.06, 0, 43.55, -0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI * (look.hairStyle === 'crop' ? 0.4 : 0.45)), 'head', 'hair', look.hair);
    b.add(ellipsoid(3.3, 0.96, 1.12, 1.06, 0, 43.4, -0.3, 12, 8, Math.PI, Math.PI, 0, Math.PI * 0.74), 'head', 'hair', look.hair);
    if (look.hairStyle === 'long') b.add(ellipsoid(3.0, 0.95, 1.5, 0.45, 0, 40.8, -2.4, 10, 7), 'head', 'hair', look.hair);
    if (look.hairStyle === 'bun') b.add(ellipsoid(1.3, 1, 1, 1, 0, 46.3, -2.2, 8, 6), 'head', 'hair', look.hair);
    b.add(new THREE.CylinderGeometry(3.28, 3.28, 1.0, 16, 1, true).scale(0.97, 1, 1.07).translate(0, 44.55, -0.15), 'head', 'band', nationColor);
  }

  const geo = b.build();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
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
  // Nation emblem on the back of the jacket, riding on the chest bone.
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 7.2), emblemMat);
  emblem.position.set(0, 1.2, -4.35 * 1.0);
  emblem.rotation.y = Math.PI;
  emblem.castShadow = false;
  bones.chest.add(emblem);

  const colorAttr = geo.attributes.color as THREE.BufferAttribute;
  let painted = nationColor;
  const setNationColor = (color: number) => {
    if (color === painted) return;
    painted = color;
    const c = new THREE.Color(color);
    for (const region of ['jacket', 'band'] as Region[]) {
      for (const [a, z] of b.regions.get(region) ?? []) for (let i = a; i < z; i++) colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    colorAttr.needsUpdate = true;
  };
  return { mesh, bones, rest, material, emblem, look, setNationColor };
}
