import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A blocky (voxel) chibi operator of near-future Tokyo (v8.1): a big square head
 * with a headset, a fitted tactical jacket and vest, cargo trousers with knee pads,
 * sneakers, and light strips, armband and trims in the faction's colour (they glow
 * softly at night). About 47 units tall. One skinned mesh per character (18 bones,
 * rigid skinning, vertex colours): one draw call each.
 *
 * The faction's emblem is on the battery pack on the back (the back is what you TRACE from).
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

type Region = 'skin' | 'hair' | 'cloth' | 'clothDark' | 'band' | 'armor' | 'plate' | 'gold' | 'boot' | 'eye' | 'shine' | 'mouth' | 'light';

export interface Look {
  skin: number;
  hair: number;
  hairStyle: 'pony' | 'bun' | 'short' | 'spiky' | 'long' | 'band' | 'side' | 'undercut';
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
  const styles: Look['hairStyle'][] = ['pony', 'bun', 'short', 'short', 'spiky', 'long', 'band', 'side', 'undercut'];
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
  /** 1 for the faction light strips (they glow), else 0. */
  glow: number[] = [];
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
      this.glow.push(region === 'light' ? 1 : 0);
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
    g.setAttribute('glow', new THREE.Float32BufferAttribute(this.glow, 1));
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
  /** Repaints the faction colour (armband, trims, light strips, hair band) in a faction's colour (disguise). */
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
  mk(wood, 0x3b414c, 0.55, 0.15); // polymer furniture
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
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
      totalEmissiveRadiance += vec3(1.0, 0.72, 0.5) * rimF * 0.42 + diffuseColor.rgb * (0.06 + vGlow * 0.85);`);
  };
  m.customProgramCacheKey = () => 'human-rim-glow';
}

/** Jacket, vest and trousers (dark graphite), pads and pack (gunmetal), trims (light steel), sneakers. */
const ARMOR = 0x2a2e37, PLATE = 0x3a404b, GOLD = 0x9aa3b2, BOOT = 0x2b2e35, SOLE = 0xd9dce2, PANTS = 0x30333a;
const dark = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
const light = (c: number) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.18).getHex();

export function buildHuman(id: number, nationColor: number, emblemMat: THREE.Material, opts: { gun?: boolean } = {}): Human {
  const look = lookFor(id);
  const w = look.build;
  const J = joints(w);
  const b = new SkinBuilder();
  const S = look.skin, H = look.hair, C = nationColor, CD = dark(nationColor, 0.55), L = light(nationColor);

  // ---- legs: cargo trousers with a side pocket and a light strip, knee pads, high-top sneakers.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const x = s * 3.3;
    b.add(box(4.6, 8.2, 4.8, x, 14, 0), `thigh${side}`, 'armor', PANTS);
    b.add(box(1.0, 3.6, 3.2, x + s * 2.6, 13.6, 0.2), `thigh${side}`, 'plate', PLATE); // cargo pocket
    b.add(box(0.5, 7.4, 0.8, x + s * 2.35, 14.2, -1.6), `thigh${side}`, 'light', L); // light strip
    b.add(box(4.2, 6.6, 4.4, x, 6.3, 0), `shin${side}`, 'armor', PANTS);
    b.add(box(4.0, 3.0, 1.2, x, 9.9, 2.5), `shin${side}`, 'plate', PLATE); // knee pad
    b.add(box(3.0, 0.5, 1.3, x, 10.2, 2.6), `shin${side}`, 'gold', GOLD);
    b.add(box(4.6, 3.4, 6.2, x, 1.9, 0.9), `foot${side}`, 'boot', BOOT); // high-top sneaker
    b.add(box(4.8, 1.0, 6.6, x, 0.5, 0.9), `foot${side}`, 'boot', SOLE); // white sole
    b.add(box(4.7, 0.6, 1.2, x, 3.0, 3.6), `foot${side}`, 'cloth', C); // toe stripe
  }

  // ---- torso: belt with a buckle and pouches, a fitted jacket, a tactical vest, a high collar.
  b.add(box(12.4 * w, 4.4, 7.4, 0, 17.8, 0), torsoBone, 'armor', PANTS); // hips
  b.add(box(12.8 * w, 1.4, 7.8, 0, 19.6, 0), 'hips', 'plate', PLATE); // belt
  b.add(box(2.0, 1.2, 0.6, 0, 19.6, 4.0), 'hips', 'gold', GOLD); // buckle
  for (const s of [1, -1]) b.add(box(2.6, 2.6, 2.0, s * 4.6 * w, 18.2, 3.6), 'hips', 'plate', PLATE); // hip pouches
  b.add(box(12.0 * w, 9.6, 7.4, 0, 25.2, 0), torsoBone, 'armor', ARMOR); // jacket
  b.add(box(0.5, 9.0, 0.6, 0, 25.0, 3.85), 'chest', 'gold', GOLD); // zip
  b.add(box(10.6 * w, 6.2, 1.0, 0, 26.2, 4.1), 'chest', 'plate', PLATE); // vest front
  for (const s of [1, -1]) {
    b.add(box(3.0, 2.4, 1.0, s * 2.8 * w, 24.6, 4.8), 'chest', 'plate', dark(PLATE, 0.85)); // mag pouches
    b.add(box(0.6, 6.0, 1.1, s * 4.9 * w, 26.2, 4.2), 'chest', 'light', L); // vest light strips
  }
  b.add(box(10.6 * w, 0.8, 1.1, 0, 22.8, 4.1), 'chest', 'cloth', C); // vest hem in the faction colour
  b.add(box(3.4, 1.6, 0.4, -2.6 * w, 28.2, 4.65), 'chest', 'clothDark', CD); // name patch
  b.add(box(10.0 * w, 2.6, 8.4, 0, 30.6, 0), 'chest', 'clothDark', CD); // high collar in the faction's dark tone
  b.add(box(10.4 * w, 0.6, 8.6, 0, 29.4, 0), 'chest', 'light', L); // collar light trim
  // Back: a battery pack carrying the faction emblem, with a glowing status bar.
  b.add(box(9.6 * w, 11.0, 2.6, 0, 25.0, -5.0), 'chest', 'plate', PLATE);
  b.add(box(8.0 * w, 0.8, 2.8, 0, 19.9, -5.0), 'chest', 'light', L);
  for (const s of [1, -1]) b.add(box(1.2, 9.0, 0.8, s * 3.6 * w, 26.4, 4.4), 'chest', 'armor', dark(ARMOR, 0.8)); // straps

  // ---- arms: jacket sleeves, a faction armband, gloves, a wrist device.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const ax = s * 8.4 * w;
    b.add(box(5.0, 3.0, 6.4, s * 8.0 * w, 29.6, 0), `arm${side}`, 'cloth', C); // shoulder panel in the faction colour
    b.add(box(3.9, 5.2, 3.9, ax, 25.6, 0), `arm${side}`, 'armor', ARMOR); // sleeve
    b.add(box(4.1, 1.6, 4.1, ax, 26.0, 0), `arm${side}`, 'cloth', C); // armband
    b.add(box(3.9, 4.4, 3.9, ax, 21.2, 0), `fore${side}`, 'armor', ARMOR); // forearm
    if (s === 1) {
      b.add(box(2.6, 1.4, 2.6, ax, 19.9, 1.0), `fore${side}`, 'plate', PLATE); // wrist device
      b.add(box(1.8, 0.4, 1.8, ax, 20.7, 1.2), `fore${side}`, 'light', 0x7fe6ff); // its screen
    }
    b.add(box(3.6, 3.6, 3.6, s * 8.5 * w, 16.9, 0.1), `hand${side}`, 'boot', 0x1f2126); // glove
  }

  // ---- head: one big block, a block face, hair and a headset.
  b.add(box(3.6, 1.6, 3.6, 0, 31.2, 0), 'neck', 'skin', S);
  b.add(box(13, 12.4, 12, 0, 38.2, 0.3), 'head', 'skin', S);
  for (const s of [1, -1]) {
    b.add(box(1.8, 2.8, 0.4, s * 2.7, 37.8, 6.45), 'head', 'eye', 0x17120f);
    b.add(box(0.7, 0.7, 0.2, s * 2.7 + 0.45, 38.7, 6.7), 'head', 'shine', 0xfaf6ee); // catch-light
    b.add(new THREE.BoxGeometry(3.0, 0.8, 0.4).rotateZ(s * -0.22).translate(s * 2.8, 40.3, 6.45), 'head', 'hair', H); // brow
    b.add(box(1.2, 2.2, 1.8, s * 6.9, 37.4, 0.2), 'head', 'skin', dark(S, 0.9)); // ear
  }
  b.add(box(1.8, 0.55, 0.4, 0, 34.9, 6.45), 'head', 'mouth', 0x7a3a32);
  if (look.beard) b.add(box(7.5, 2.4, 1.0, 0, 33.0, 6.5), 'head', 'hair', H);
  // Hair: a cap over the top, back and sides, with blocky bangs.
  b.add(box(13.8, 3.2, 12.8, 0, 44.9, 0.1), 'head', 'hair', H);
  b.add(box(13.8, 10.5, 2.4, 0, 39.9, -5.9), 'head', 'hair', H);
  for (const s of [1, -1]) b.add(box(1.4, 7.5, 11.5, s * 6.95, 40.8, -0.5), 'head', 'hair', H);
  for (const [bx, len] of [[-4.6, 3.6], [-1.4, 2.6], [1.8, 3.4], [4.9, 2.2]] as const) b.add(box(3.4, len, 1.6, bx, 43.5 - len / 2, 6.3), 'head', 'hair', H);
  // Headset: an ear cup on the left with a light, a mic boom to the mouth.
  b.add(box(1.6, 3.6, 3.6, 7.5, 38.0, 0.2), 'head', 'plate', PLATE);
  b.add(box(0.4, 1.6, 1.6, 8.4, 38.0, 0.2), 'head', 'light', L);
  b.add(new THREE.BoxGeometry(0.7, 0.7, 6.0).rotateY(0.5).translate(5.6, 35.6, 4.2), 'head', 'plate', PLATE);
  const hs = look.hairStyle;
  if (hs === 'pony') {
    // A short modern ponytail at the nape, tied with a faction band.
    b.add(box(2.6, 1.8, 1.8, 0, 38.6, -7.5), 'head', 'band', C);
    b.add(new THREE.BoxGeometry(2.8, 6.0, 2.4).rotateX(0.25).translate(0, 35.4, -8.0), 'head', 'hair', H);
  } else if (hs === 'bun') {
    b.add(box(4.0, 3.6, 4.0, 0, 44.6, -6.4), 'head', 'hair', H); // low bun at the back
  } else if (hs === 'spiky') {
    for (const [x, z, h] of [[-4, 2, 2.6], [0, 3, 3.4], [4, 1.5, 2.4], [-2, -3, 3], [3, -3.5, 2.8]] as const) b.add(box(3, h, 3, x, 46.5 + h / 2, z), 'head', 'hair', H);
  } else if (hs === 'long') {
    b.add(box(13.4, 8, 2.2, 0, 32.8, -6.4), 'head', 'hair', H);
  } else if (hs === 'band') {
    // Tactical goggles pushed up on the forehead.
    b.add(box(13.4, 1.6, 12.6, 0, 43.2, 0.3), 'head', 'armor', ARMOR);
    for (const s of [1, -1]) b.add(box(4.2, 2.6, 1.4, s * 2.8, 43.4, 6.8), 'head', 'light', L);
  } else if (hs === 'side') {
    b.add(new THREE.BoxGeometry(6, 2.6, 7).rotateZ(0.25).translate(3.5, 47, 1.5), 'head', 'hair', H);
  } else if (hs === 'undercut') {
    b.add(box(9.0, 2.6, 11.0, 0, 47.5, 0.6), 'head', 'hair', H); // top volume
    for (const s of [1, -1]) b.add(box(1.5, 4.0, 10.0, s * 7.0, 39.0, -0.5), 'head', 'hair', dark(H, 0.6)); // faded sides
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
  // Faction emblem on the battery pack, riding on the chest bone.
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 6.8), emblemMat);
  emblem.position.set(0, -1.0, -6.4);
  emblem.rotation.y = Math.PI;
  emblem.castShadow = false;
  bones.chest.add(emblem);

  const colorAttr = geo.attributes.color as THREE.BufferAttribute;
  let painted = nationColor;
  const setNationColor = (color: number) => {
    if (color === painted) return;
    painted = color;
    for (const [region, k] of [['cloth', 1], ['band', 1], ['clothDark', 0.55], ['light', -1]] as [Region, number][]) {
      const c = k < 0 ? new THREE.Color(light(color)) : new THREE.Color(color).multiplyScalar(k);
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
