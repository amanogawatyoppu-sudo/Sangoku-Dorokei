import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

type Region = 'skin' | 'hair' | 'jacket' | 'trim' | 'pants' | 'shoe' | 'sole' | 'eye' | 'iris' | 'mouth' | 'band' | 'cap' | 'shirt' | 'belt' | 'gear';

export interface Look {
  skin: number;
  hair: number;
  hairStyle: 'short' | 'long' | 'bun' | 'cap' | 'crop' | 'spiky' | 'pony' | 'side';
  cap: number;
  pants: number;
  shoe: number;
  sole: number;
  trim: number;
  shirt: number;
  /** Extras that make people tell apart at a glance. */
  glasses: boolean;
  beard: boolean;
  bag: number | null;
  /** Shoulder width factor and overall height factor (visual only). */
  build: number;
  height: number;
}

const SKINS = [0xf2cfae, 0xe8bf98, 0xdcae86, 0xc99873, 0xb07e58];
const HAIRS = [0x151210, 0x1f1712, 0x2b1f17, 0x3d2a1c, 0x5b3d26, 0x7a5a3a, 0x8c8a86, 0x6b4a8a];
const PANTS = [0x23262d, 0x2f3b52, 0x3b3f4a, 0x1d1d1f, 0x4a4338, 0x5c6470, 0x2b3a2f];
const SHOES = [0x111111, 0xf1f1ee, 0x5a3a22, 0x2a2a2e, 0xd9d2c4, 0x7a1f22];
const CAPS = [0x1f2a3a, 0x2b2b2b, 0xe8e4da, 0x7a2a22];
const SHIRTS = [0xf0eee8, 0x1e1e22, 0x8a8d92, 0x2c3a55, 0xe6dcc4];
const BAGS = [0x2a2a2e, 0x5a3a22, 0x3b4a3a];

/** Deterministic look per character id (the same person every match). */
export function lookFor(id: number): Look {
  let a = (id * 2654435761) >>> 0;
  const r = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length) % arr.length];
  const styles: Look['hairStyle'][] = ['short', 'short', 'crop', 'long', 'bun', 'cap', 'spiky', 'pony', 'side'];
  const shoe = pick(SHOES);
  return {
    skin: pick(SKINS), hair: pick(HAIRS), hairStyle: pick(styles), cap: pick(CAPS),
    pants: pick(PANTS), shoe, sole: shoe === 0xf1f1ee || shoe === 0xd9d2c4 ? 0xcfcac0 : 0xf2f0ea, trim: r() < 0.6 ? 0xf3efe6 : 0x1c1c20,
    shirt: pick(SHIRTS), glasses: r() < 0.16, beard: r() < 0.14, bag: r() < 0.22 ? pick(BAGS) : null,
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

/** How far from each joint the skin is shared between the two bones it links (soft elbows, knees, shoulders). */
const BLEND_R: Partial<Record<BoneName, number>> = {
  spine: 3.5, chest: 3.5, neck: 1.6, head: 1.2,
  armL: 3.2, foreL: 2.3, handL: 1.1, armR: 3.2, foreR: 2.3, handR: 1.1,
  thighL: 3.4, shinL: 2.6, footL: 1.2, thighR: 3.4, shinR: 2.6, footR: 1.2,
};

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

const cyl = (rTop: number, rBot: number, y0: number, y1: number, zs: number, seg = 12, hSeg = 1) =>
  new THREE.CylinderGeometry(rTop, rBot, y1 - y0, seg, hSeg).translate(0, (y0 + y1) / 2, 0).scale(1, 1, zs);
const capsule = (r: number, len: number, x: number, y: number, z = 0) => new THREE.CapsuleGeometry(r, len, 3, 8).translate(x, y, z);
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const ellipsoid = (r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, ws = 12, hs = 9, phi0 = 0, phiL = Math.PI * 2, th0 = 0, thL = Math.PI) =>
  new THREE.SphereGeometry(r, ws, hs, phi0, phiL, th0, thL).scale(sx, sy, sz).translate(x, y, z);
/** A turned shape from a [radius, height] profile (bottom to top), flattened front to back by `zs`. */
const lathe = (profile: [number, number][], x: number, z: number, zs: number, seg = 14, phi0 = 0, phiL = Math.PI * 2) =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg, phi0, phiL).scale(1, 1, zs).translate(x, 0, z);
/** The head: an egg narrowing below the cheekbones to the jaw and a slightly forward chin. */
function headShape(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(3.05, 20, 16);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 0.92, y = p.getY(i) * 1.14, z = p.getZ(i) * 1.04;
    const t = Math.max(0, -y / 3.4); // 0 at the middle, 1 at the chin
    x *= 1 - 0.32 * t * t;
    z = z * (1 - 0.18 * t) + (z > 0 ? 0.5 * t : 0);
    p.setXYZ(i, x, y + 43.3, z + 0.15);
  }
  g.computeVertexNormals();
  return g;
}

/** Torso vertices follow hips / spine / chest by height. */
const torsoBone = (_x: number, y: number): BoneName => (y < 26 ? 'hips' : y < 31.5 ? 'spine' : 'chest');

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

export function buildHuman(id: number, nationColor: number, emblemMat: THREE.Material, opts: { gun?: boolean } = {}): Human {
  const look = lookFor(id);
  const w = look.build;
  const J = joints(w);
  const b = new SkinBuilder();
  const S = look.skin;
  const skinDark = new THREE.Color(S).multiplyScalar(0.82).getHex();

  // ---- legs: shaped thighs and calves, trouser cuffs, trainers with a sole.
  b.add(lathe([[5.3 * w, 19.4], [6.1 * w, 20.8], [6.3 * w, 23.2], [6.0 * w, 25.2]], 0, 0, 0.62), torsoBone, 'pants', look.pants);
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const x = s * 3.4;
    b.add(lathe([[2.25, 13.2], [2.55, 15.5], [2.85, 19], [2.95, 21.6], [2.6, 23.4]], x, 0.15, 1, 12), `thigh${side}`, 'pants', look.pants);
    b.add(ellipsoid(2.2, 1, 1, 1, x, 12.9, 0.1, 10, 7), `shin${side}`, 'pants', look.pants); // knee
    b.add(lathe([[1.75, 3.6], [1.7, 5], [2.05, 8.6], [2.25, 10.4], [2.15, 12.9]], x, -0.1, 1, 12), `shin${side}`, 'pants', look.pants);
    b.add(cyl(1.95, 2.0, 3.0, 4.2, 1, 12), `shin${side}`, 'pants', new THREE.Color(look.pants).multiplyScalar(0.8).getHex()); // cuff
    b.add(box(3.5, 0.9, 7.2, x, 0.45, 1.3), `foot${side}`, 'sole', look.sole);
    b.add(ellipsoid(1.75, 1, 0.75, 2.05, x, 1.45, 1.35, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.6), `foot${side}`, 'shoe', look.shoe);
    b.add(box(3.1, 1.6, 2.2, x, 1.9, -1.2), `foot${side}`, 'shoe', look.shoe); // heel counter
    b.add(box(0.5, 0.25, 2.6, x, 2.9, 1.6), `foot${side}`, 'sole', look.sole); // laces
  }

  // ---- torso: shirt underneath, a belt, and the happi coat open down the front.
  b.add(lathe([[5.6 * w, 22.6], [5.6 * w, 26], [5.9 * w, 31], [6.4 * w, 35.5], [5.0 * w, 37.8], [2.2, 38.6]], 0, 0, 0.64, 16), torsoBone, 'shirt', look.shirt);
  b.add(cyl(5.9 * w, 6.05 * w, 23.5, 24.9, 0.66, 16), 'hips', 'belt', 0x2a2420);
  b.add(box(1.4, 1.1, 0.4, 0, 24.2, 4.05), 'hips', 'gear', 0xb8a47a); // buckle
  const OPEN = 0.42; // half-width of the front opening (radians)
  const coat: [number, number][] = [[7.0 * w, 21.2], [6.9 * w, 23.5], [6.5 * w, 27], [6.4 * w, 30.5], [6.9 * w, 34], [7.05 * w, 36.3], [5.7 * w, 38.1], [3.6, 39.0]];
  b.add(lathe(coat, 0, 0, 0.64, 20, OPEN, Math.PI * 2 - 2 * OPEN), torsoBone, 'jacket', nationColor);
  // Inside of the coat (seen through the opening), a shade darker.
  b.add(lathe(coat.map(([r, y]) => [r - 0.3, y] as [number, number]).reverse(), 0, 0, 0.64, 20, OPEN, Math.PI * 2 - 2 * OPEN), torsoBone, 'jacket', nationColor);
  for (const s of [1, -1]) {
    // Lapels (collar bands) down both front edges, and the shoulders.
    for (let k = 0; k < coat.length - 1; k++) {
      const [r0, y0] = coat[k], [r1, y1] = coat[k + 1];
      const x0 = s * Math.sin(OPEN) * r0, z0 = Math.cos(OPEN) * r0 * 0.64, x1 = s * Math.sin(OPEN) * r1, z1 = Math.cos(OPEN) * r1 * 0.64;
      const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      if (y0 >= 38) continue;
      b.add(new THREE.BoxGeometry(1.0, d.length() + 0.1, 0.4).applyQuaternion(q).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2 + 0.1), torsoBone, 'trim', look.trim);
    }
    b.add(ellipsoid(2.0, 1, 0.85, 0.95, s * 6.4 * w, 37.0, 0, 12, 8), 'chest', 'jacket', nationColor);
  }
  // Collar round the back of the neck.
  b.add(new THREE.TorusGeometry(3.3, 0.55, 6, 14, Math.PI * 1.2).rotateX(Math.PI / 2).rotateY(Math.PI * 0.4).scale(1, 1, 0.72).translate(0, 38.6, -0.2), 'chest', 'trim', look.trim);

  // ---- arms: wide happi sleeves to the elbow with a cuff; forearms; hands with fingers.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const ax = s * 7.55 * w;
    b.add(cyl(1.7, 2.65, 28.4, 36.4, 1, 12, 3).translate(ax, 0, 0), `arm${side}`, 'jacket', nationColor);
    b.add(cyl(2.65, 2.7, 27.9, 28.9, 1, 12).translate(ax, 0, 0), `arm${side}`, 'trim', look.trim);
    b.add(ellipsoid(1.55, 1, 1, 1, s * 7.7 * w, 27.3, 0, 10, 7), `fore${side}`, 'skin', S); // elbow
    b.add(lathe([[1.05, 20.0], [1.2, 21.4], [1.55, 24.6], [1.5, 26.6], [1.4, 27.6]], s * 7.85 * w, 0, 0.9, 10), `fore${side}`, 'skin', S);
    const hx = s * 8.0 * w;
    b.add(ellipsoid(1.25, 0.62, 1.2, 1.0, hx, 18.6, 0.1, 10, 7), `hand${side}`, 'skin', S); // palm
    for (let f = 0; f < 4; f++) {
      b.add(capsule(0.27, 1.35 - Math.abs(f - 1.5) * 0.2, hx - s * 0.05, 16.6 + Math.abs(f - 1.5) * 0.15, -0.72 + f * 0.48), `hand${side}`, 'skin', S);
    }
    b.add(capsule(0.32, 1.0, hx - s * 0.35, 18.0, 1.15).rotateX(0), `hand${side}`, 'skin', skinDark); // thumb
  }

  // ---- neck, head and face.
  b.add(cyl(1.7, 1.95, 37.2, 41, 1, 12), 'neck', 'skin', S);
  b.add(headShape(), 'head', 'skin', S); // one sculpted head: cranium narrowing to the jaw and chin
  for (const s of [1, -1]) {
    b.add(ellipsoid(0.7, 0.55, 1, 0.85, s * 2.85, 43.1, 0.1, 8, 6), 'head', 'skin', S); // ear
    b.add(ellipsoid(0.5, 1.05, 0.72, 0.45, s * 1.12, 43.55, 2.72, 10, 7), 'head', 'eye', 0xf4f1ea); // eye white
    b.add(ellipsoid(0.3, 1, 1, 0.5, s * 1.08, 43.55, 2.93, 8, 6), 'head', 'iris', 0x1f1712); // iris
    b.add(box(1.2, 0.26, 0.3, s * 1.15, 44.25, 2.72).rotateZ(0), 'head', 'hair', look.hair); // brow
  }
  b.add(ellipsoid(0.42, 0.85, 1.35, 1.0, 0, 42.75, 2.95, 8, 6), 'head', 'skin', skinDark); // nose
  b.add(box(1.25, 0.26, 0.25, 0, 41.3, 2.72), 'head', 'mouth', 0x8a4a42);
  if (look.beard) b.add(ellipsoid(2.2, 0.95, 0.75, 0.95, 0, 40.9, 0.9, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), 'head', 'hair', look.hair);
  if (look.glasses) {
    for (const s of [1, -1]) b.add(new THREE.TorusGeometry(0.72, 0.1, 4, 14).translate(s * 1.15, 43.55, 3.05), 'head', 'gear', 0x1a1a1a);
    b.add(box(0.7, 0.14, 0.14, 0, 43.65, 3.1), 'head', 'gear', 0x1a1a1a);
  }

  // ---- hair (or a cap), and the headband in the nation's colour with its knot at the back.
  const H = look.hair;
  if (look.hairStyle === 'cap') {
    b.add(ellipsoid(3.4, 0.96, 1.0, 1.06, 0, 44.1, -0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.46), 'head', 'cap', look.cap);
    b.add(ellipsoid(2.6, 1, 0.12, 1.1, 0, 44.6, 3.1, 12, 4), 'head', 'cap', look.cap); // brim
    b.add(ellipsoid(3.3, 0.95, 1.1, 1.05, 0, 43.1, -0.3, 12, 8, Math.PI, Math.PI, 0.45 * Math.PI, 0.3 * Math.PI), 'head', 'hair', H);
  } else {
    const top = look.hairStyle === 'crop' ? 0.38 : 0.47;
    b.add(ellipsoid(3.3, 0.95, 1.12, 1.07, 0, 43.65, -0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI * top), 'head', 'hair', H);
    b.add(ellipsoid(3.32, 0.96, 1.12, 1.07, 0, 43.4, -0.3, 14, 9, Math.PI, Math.PI, 0, Math.PI * 0.76), 'head', 'hair', H); // back
    if (look.hairStyle === 'spiky') {
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        b.add(new THREE.ConeGeometry(0.75, 2.1, 5).rotateX(Math.sin(a) * 0.5).rotateZ(-Math.cos(a) * 0.5).translate(Math.cos(a) * 1.4, 47.0, Math.sin(a) * 1.2 - 0.4), 'head', 'hair', H);
      }
    }
    if (look.hairStyle === 'long') b.add(ellipsoid(3.0, 0.98, 1.6, 0.5, 0, 40.6, -2.45, 12, 8), 'head', 'hair', H);
    if (look.hairStyle === 'bun') b.add(ellipsoid(1.4, 1, 1, 1, 0, 46.4, -2.2, 10, 7), 'head', 'hair', H);
    if (look.hairStyle === 'pony') b.add(capsule(0.85, 3.4, 0, 42.2, -3.5), 'head', 'hair', H);
    if (look.hairStyle === 'side') b.add(ellipsoid(1.6, 1.3, 0.6, 1, 1.6, 45.9, 1.2, 10, 6), 'head', 'hair', H);
    b.add(new THREE.CylinderGeometry(3.28, 3.3, 1.0, 20, 1, true).scale(0.97, 1, 1.08).translate(0, 45.15, -0.2), 'head', 'band', nationColor);
    for (const s of [1, -1]) b.add(box(0.6, 2.2, 0.25, 0, -1.1, 0).rotateZ(s * 0.35).translate(s * 0.4, 44.9, -3.72), 'head', 'band', nationColor); // knot tails
  }

  // ---- a shoulder bag for some.
  if (look.bag !== null) {
    b.add(box(0.7, 15, 0.35, 0, 31, 0).rotateZ(0.62).translate(0, 0, 4.15), 'chest', 'gear', 0x1c1c1e); // strap (front)
    b.add(box(0.7, 15, 0.35, 0, 31, 0).rotateZ(0.62).translate(0, 0, -4.2), 'chest', 'gear', 0x1c1c1e); // strap (back)
    b.add(box(4.6, 3.4, 1.8, -5.3 * w, 23.4, 0.4), 'hips', 'gear', look.bag);
  }

  const geo = b.build(J);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
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
  let gun: THREE.Group | null = null, muzzle: THREE.Object3D | null = null;
  if (opts.gun) {
    ({ gun, muzzle } = buildRifle());
    bones.chest.add(gun);
  }
  return { mesh, bones, rest, material, emblem, look, setNationColor, gun, muzzle };
}
