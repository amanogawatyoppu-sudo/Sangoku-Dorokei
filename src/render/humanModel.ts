import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoleId } from '../config/roles';

/**
 * TRI//TRACE operator (v9.0): a stylized near-future Tokyo chaser, about 5.7 heads
 * tall (≈47 units). Low-poly tapered limbs and torso, a rounded head with a small
 * readable face (eyes, brows, nose, mouth) whose expression blends through morph
 * targets, modular low-poly hair, and a charcoal operator kit with the faction
 * colour on the collar, shoulders, belt, shoes, light strips and the back unit.
 *
 * Every operator wears a TRACE DEVICE on the left wrist (it lights up when a TRACE is
 * possible), an earpiece and a utility belt. Roles read from their gear, not their
 * build or colours: VANGUARD heavy shoulders and arm guards, SPOTTER a monocular and
 * a handheld marker, RELAY an antenna module, BREAKER an unlock tool, RUNNER the
 * lightest kit. ANCHOR has no gear of its own: it wears a VANGUARD's or a RUNNER's.
 *
 * One skinned mesh per character (18 bones, rigid skinning, vertex colours): one draw
 * call each. Local +Z is the facing; the character's left is +X. The back carries the
 * emblem and the brightest faction light, because the back is what you TRACE.
 */

export const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

type Region = 'skin' | 'hair' | 'cloth' | 'clothDark' | 'band' | 'armor' | 'plate' | 'gold' | 'boot' | 'eye' | 'shine' | 'mouth' | 'light' | 'trace'
  | 'browL' | 'browR' | 'eyeL' | 'eyeR' | 'lidL' | 'lidR';

export type HairStyle = 'short' | 'undercut' | 'pony' | 'bob' | 'spiky' | 'long' | 'buzz' | 'sidepart';
export type Expression = 'neutral' | 'focused' | 'alert' | 'surprised' | 'confident';
/** Morph targets, in this order (neutral = all off). */
export const EXPRESSIONS: readonly Exclude<Expression, 'neutral'>[] = ['focused', 'alert', 'surprised', 'confident'];
/** Which kit a character wears (ANCHOR borrows another role's). */
export type Gear = 'vanguard' | 'spotter' | 'relay' | 'breaker' | 'runner';

export interface Look {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  /** Iris colour. */
  eye: number;
  /** 0 soft round … 1 sharp narrow jaw. */
  jaw: number;
  /** Brow thickness factor. */
  brow: number;
  /** Shoulder width factor and overall height factor (visual only). */
  build: number;
  height: number;
}

const SKINS = [0xf3d2b3, 0xebc19c, 0xdcab83, 0xc8946b, 0xa97753, 0x8a5d40];
const HAIRS = [0x16141a, 0x1f1a18, 0x2f2220, 0x463026, 0x6a4a32, 0x8c8a90, 0x2a2f3c, 0xb79b74];
const EYES = [0x2a1d16, 0x3a2a1e, 0x4a3a28, 0x3a4048, 0x24303c];

/** Deterministic look per character id (the same person every match). */
export function lookFor(id: number): Look {
  let a = (id * 2654435761) >>> 0;
  const r = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length) % arr.length];
  const styles: HairStyle[] = ['short', 'short', 'undercut', 'pony', 'bob', 'spiky', 'long', 'buzz', 'sidepart'];
  return {
    skin: pick(SKINS), hair: pick(HAIRS), hairStyle: pick(styles), eye: pick(EYES),
    jaw: r(), brow: 0.8 + r() * 0.5, build: 0.93 + r() * 0.15, height: 0.95 + r() * 0.1,
  };
}

/** ANCHOR has no gear of its own: it wears a VANGUARD's or a RUNNER's (by id), so the kit never gives it away. */
export function gearFor(role: RoleId, id: number): Gear {
  switch (role) {
    case 'soldier': return 'vanguard';
    case 'sniper': return 'spotter';
    case 'communicator': return 'relay';
    case 'keyholder': return 'breaker';
    case 'ranger': return 'runner';
    default: return id % 2 ? 'vanguard' : 'runner';
  }
}

/** Head centre (absolute, rest pose): the face and hair are built around it. */
const HC = { y: 42.5, z: 0.2, rx: 3.9, ry: 4.3, rz: 4.0 };

/** Rest-pose joint positions (absolute): long legs, a compact torso, a head about 1/5.7 of the height. */
function joints(w: number): Record<BoneName, [BoneName | null, number, number, number]> {
  return {
    root: [null, 0, 0, 0], hips: ['root', 0, 23, 0], spine: ['hips', 0, 25.2, 0], chest: ['spine', 0, 29, 0],
    neck: ['chest', 0, 35.6, 0], head: ['neck', 0, 38.4, 0],
    armL: ['chest', 6.4 * w, 34.4, -0.2], foreL: ['armL', 6.75 * w, 28.4, -0.2], handL: ['foreL', 6.95 * w, 23.0, 0],
    armR: ['chest', -6.4 * w, 34.4, -0.2], foreR: ['armR', -6.75 * w, 28.4, -0.2], handR: ['foreR', -6.95 * w, 23.0, 0],
    thighL: ['hips', 2.3, 22.4, 0], shinL: ['thighL', 2.3, 12.6, 0.2], footL: ['shinL', 2.3, 2.6, 0],
    thighR: ['hips', -2.3, 22.4, 0], shinR: ['thighR', -2.3, 12.6, 0.2], footR: ['shinR', -2.3, 2.6, 0],
  };
}

class SkinBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  bone: number[] = [];
  /** 1 for the faction light strips, 2 for the TRACE device (driven by uTrace), else 0. */
  glow: number[] = [];
  idx: number[] = [];
  /** Vertex ranges per region, so the faction colour can be repainted and the face can move. */
  regions = new Map<Region, [number, number][]>();
  /** Centre of each face part (for the expression morphs). */
  centers = new Map<Region, THREE.Vector3>();

  add(geo: THREE.BufferGeometry, bone: BoneName, region: Region, color: number): void {
    const g = geo;
    const p = g.attributes.position, n = g.attributes.normal;
    const base = this.pos.length / 3;
    const c = new THREE.Color(color);
    const bi = BI[bone], gl = region === 'light' ? 1 : region === 'trace' ? 2 : 0;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.bone.push(bi);
      this.glow.push(gl);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    const list = this.regions.get(region) ?? [];
    list.push([base, base + p.count]);
    this.regions.set(region, list);
    if (!this.centers.has(region)) {
      g.computeBoundingBox();
      this.centers.set(region, g.boundingBox!.getCenter(new THREE.Vector3()));
    }
    g.dispose();
  }

  /** A morph target: an offset for every vertex of the given face parts. */
  morph(parts: [Region, (x: number, y: number, z: number, c: THREE.Vector3) => [number, number, number]][]): THREE.Float32BufferAttribute {
    const d = new Float32Array(this.pos.length);
    for (const [region, fn] of parts) {
      const c = this.centers.get(region);
      if (!c) continue;
      for (const [a, z] of this.regions.get(region) ?? []) {
        for (let i = a; i < z; i++) {
          const [dx, dy, dz] = fn(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], c);
          d[i * 3] = dx; d[i * 3 + 1] = dy; d[i * 3 + 2] = dz;
        }
      }
    }
    return new THREE.Float32BufferAttribute(d, 3);
  }

  build(): THREE.BufferGeometry {
    const n = this.bone.length;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = this.bone[i]; sw[i * 4] = 1; }
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

// ---- shape helpers -------------------------------------------------------------------------

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/**
 * A tapered box: bottom w0×d0, top w1×d1, from y0 to y1, centred on (x, z), with an
 * optional forward shift of the top (dz). Flat-shaded faces (eight corners, six quads).
 */
function tbox(w0: number, d0: number, w1: number, d1: number, y0: number, y1: number, x = 0, z = 0, dz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    const w = top ? w1 : w0, d = top ? d1 : d0;
    p.setXYZ(i, x + p.getX(i) * w, top ? y1 : y0, z + p.getZ(i) * d + (top ? dz : 0));
  }
  g.computeVertexNormals();
  return g;
}

/** A tapered limb segment (a low-poly cylinder) from y0 (radius r0) to y1 (radius r1). */
function limb(r0: number, r1: number, y0: number, y1: number, x: number, z: number, seg: number, sx = 1, sz = 1): THREE.BufferGeometry {
  // Open-ended: both ends always sit inside a joint cap, a cuff or a shoe.
  return new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, true).scale(sx, 1, sz).translate(x, (y0 + y1) / 2, z);
}

/** A low-poly ellipsoid (joint caps, the head, pads). */
function blob(rx: number, ry: number, rz: number, x: number, y: number, z: number, ws: number, hs: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz).translate(x, y, z);
}

/** Part of an ellipsoid shell around the head (hair caps): theta from the crown down, phi round the head. */
function shell(grow: number, t0: number, t1: number, p0: number, p1: number, ws: number, hs: number, squash = 1): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, ws, hs, p0, p1, t0, t1)
    .scale(HC.rx + grow, (HC.ry + grow) * squash, HC.rz + grow).translate(0, HC.y, HC.z);
}

/** Where the head's surface is at (x, y), in front (for placing face parts flush). */
function faceZ(x: number, y: number, jaw: number): number {
  const ny = (y - HC.y) / HC.ry;
  const taper = ny < 0 ? 1 - (0.1 + 0.16 * jaw) * ny * ny * 1.6 : 1;
  const nx = x / (HC.rx * taper);
  return HC.z + HC.rz * Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
}

/** The head: a rounded block, narrowing into the jaw and chin by face shape. */
function headGeo(jaw: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 3));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0) {
      const k = 1 - (0.1 + 0.16 * jaw) * y * y * 1.6; // jaw taper
      x *= k;
      if (z < 0) z *= 1 - 0.25 * y * y; // the back of the skull rounds into the neck
      z += 0.06 * y * y; // the chin sits forward a little
    } else {
      x *= 1 + 0.03 * y; // a slightly wider crown
    }
    p.setXYZ(i, x * HC.rx, y * HC.ry, z * HC.rz);
  }
  g.computeVertexNormals();
  return g.translate(0, HC.y, HC.z);
}

// ---- palette --------------------------------------------------------------------------------

/** Operator kit: charcoal jacket and trousers (≈70%), gunmetal gear, light-steel trims, white soles. */
const JACKET = 0x23272e, JACKET2 = 0x323844, PANTS = 0x262a31, PLATE = 0x3b414c, STEEL = 0xa9b1bf, BOOT = 0x1c1f24, SOLE = 0xe4e6ea, GLOVE = 0x17191d;
const dark = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
const light = (c: number, k = 0.12) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k).getHex();

/** Three hard tones for the cel shading (shared). */
let gradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const t = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 196, 196, 196, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  gradient = t;
  return t;
}

/**
 * Cel shading with a thin cool rim (so figures separate from the city without an outline),
 * the faction light strips glowing softly, and the TRACE device lighting up with uTrace.
 */
function makeMaterial(trace: { value: number }): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTrace = trace;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uTrace;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
      float strip = step(0.5, vGlow) * step(vGlow, 1.5);
      float dev = step(1.5, vGlow);
      totalEmissiveRadiance += vec3(0.78, 0.86, 1.0) * rimF * 0.32
        + diffuseColor.rgb * (0.05 + strip * 0.6 + dev * (0.25 + uTrace * 1.9));`);
  };
  m.customProgramCacheKey = () => 'tt-operator';
  return m;
}

export interface Human {
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Rest positions of the bones (hips height is animated). */
  rest: Record<BoneName, THREE.Vector3>;
  material: THREE.MeshToonMaterial;
  emblem: THREE.Mesh;
  look: Look;
  gear: Gear;
  /** Repaints the faction colour (collar, shoulders, trims, light strips, device) in a faction's colour (disguise). */
  setNationColor(color: number): void;
  /** Sets the face: each expression's weight 0…1 (the others are left as they are). */
  setExpression(e: Exclude<Expression, 'neutral'>, k: number): void;
  /** 0 … 1: how brightly the TRACE device on the wrist glows. */
  setTrace(k: number): void;
  /** SPOTTERs only: the handheld marker (a child of the chest bone) and the point at its tip. */
  gun: THREE.Group | null;
  muzzle: THREE.Object3D | null;
}

/**
 * SPOTTER's marker: a compact handheld optic that fires a stun tag — not a rifle. Origin at
 * the grip, emitter along +Z, a glowing lens at the tip and a sight on top.
 */
function buildMarker(color: number): { gun: THREE.Group; muzzle: THREE.Object3D } {
  const body: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
  const bx = (list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) =>
    list.push(new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z).toNonIndexed());
  bx(body, 1.3, 2.4, 1.5, 0, -1.3, -0.4, -0.3); // grip
  bx(body, 1.8, 2.0, 7.0, 0, 0.6, 1.8); // body
  bx(body, 1.4, 1.5, 2.2, 0, 0.5, 6.2); // emitter
  body.push(new THREE.CylinderGeometry(0.55, 0.55, 2.6, 8).rotateX(Math.PI / 2).translate(0, 2.2, 1.6).toNonIndexed()); // sight
  bx(glow, 1.0, 1.0, 0.3, 0, 0.5, 7.35); // lens
  bx(glow, 0.3, 0.4, 5.0, 0.95, 0.9, 1.8); // side strip
  const gun = new THREE.Group();
  const a = new THREE.Mesh(mergeGeometries(body)!, new THREE.MeshToonMaterial({ color: 0x2a2e36, gradientMap: toonGradient() }));
  a.castShadow = true;
  const b = new THREE.Mesh(mergeGeometries(glow)!, new THREE.MeshBasicMaterial({ color: light(color, 0.35) }));
  gun.add(a, b);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.5, 7.6);
  gun.add(muzzle);
  return { gun, muzzle };
}

export interface BuildOpts {
  /** Older call sites: a SPOTTER's marker without naming the role. */
  gun?: boolean;
  /** The role (decides the gear; ANCHOR borrows another's). */
  role?: RoleId;
  /** Mesh detail: 2 high (default), 1 medium, 0 low (fewer segments on the round parts). */
  detail?: number;
}

export function buildHuman(id: number, nationColor: number, emblemMat: THREE.Material, opts: BuildOpts = {}): Human {
  const look = lookFor(id);
  const gear: Gear = opts.role ? gearFor(opts.role, id) : opts.gun ? 'spotter' : id % 2 ? 'vanguard' : 'runner';
  const det = opts.detail ?? 2;
  const SEG = det >= 2 ? 7 : det === 1 ? 6 : 5, HS = det >= 2 ? 11 : det === 1 ? 9 : 7, JS = det >= 1 ? 6 : 5;
  const w = look.build;
  const J = joints(w);
  const b = new SkinBuilder();
  const S = look.skin, H = look.hair, C = nationColor, CD = dark(nationColor, 0.55), L = light(nationColor), TR = light(nationColor, 0.45);
  const heavy = gear === 'vanguard', lite = gear === 'runner';

  // ---- legs: slim tapered trousers, knee caps, high-top sneakers with white soles and a faction toe.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const x = s * 2.3;
    b.add(limb(1.75, 2.35, 12.4, 23.4, x, 0, SEG), `thigh${side}`, 'armor', PANTS);
    b.add(blob(1.8, 1.7, 1.85, x, 12.6, 0.25, JS, 4), `shin${side}`, 'armor', PANTS); // knee
    b.add(tbox(2.2, 0.8, 2.4, 0.9, 11.4, 13.8, x, 1.85), `shin${side}`, 'plate', JACKET2); // knee pad
    b.add(limb(1.25, 1.7, 3.2, 12.6, x, 0.15, SEG), `shin${side}`, 'armor', PANTS);
    b.add(tbox(2.7, 3.0, 2.5, 2.6, 1.0, 4.0, x, 0.1), `shin${side}`, 'boot', BOOT); // sneaker collar
    b.add(tbox(3.0, 6.0, 2.8, 5.0, 0.9, 2.9, x, 1.0, 0.3), `foot${side}`, 'boot', BOOT); // shoe
    b.add(tbox(3.2, 6.4, 3.1, 6.3, 0, 1.0, x, 1.0), `foot${side}`, 'boot', SOLE); // sole
    b.add(tbox(2.9, 1.4, 2.4, 1.0, 0.9, 2.5, x, 3.6), `foot${side}`, 'cloth', C); // toe cap
    // Light strip down the outside of the thigh (RUNNERs also on the shin).
    b.add(box(0.35, 7.0, 0.6, x + s * 2.05, 18.0, -0.6), `thigh${side}`, 'light', L);
    if (lite) b.add(box(0.35, 6.0, 0.5, x + s * 1.5, 8.0, -0.6), `shin${side}`, 'light', L);
  }

  // ---- torso: pelvis, a fitted waist, a broader chest, a utility belt and a faction collar.
  b.add(tbox(8.4 * w, 5.4, 8.4 * w, 5.6, 20.4, 25.4), 'hips', 'armor', PANTS);
  b.add(tbox(8.9 * w, 6.0, 8.9 * w, 6.1, 22.3, 23.7), 'hips', 'cloth', C); // belt (faction)
  b.add(box(1.6, 1.2, 0.5, 0, 23.1, 3.1), 'hips', 'gold', STEEL); // buckle
  for (const sx of [1, -1]) b.add(tbox(2.2, 1.6, 2.2, 1.6, 20.6, 23.4, sx * 3.7 * w, 2.0), 'hips', 'plate', PLATE); // pouches
  b.add(tbox(3.4, 1.2, 3.4, 1.2, 20.8, 23.6, 0, -3.3), 'hips', 'plate', PLATE); // rear pouch
  b.add(tbox(8.2 * w, 5.4, 8.6 * w, 5.8, 24.8, 29.4), 'spine', 'armor', JACKET); // waist
  b.add(tbox(8.8 * w, 5.8, 9.8 * w, 6.0, 29.0, 34.8, 0, 0, 0.1), 'chest', 'armor', JACKET); // chest
  b.add(tbox(9.8 * w, 5.6, 6.2 * w, 4.4, 34.6, 36.4, 0, -0.1), 'chest', 'armor', JACKET); // shoulder line
  b.add(box(0.35, 10.2, 0.4, 0, 30.0, 3.05), 'chest', 'gold', STEEL); // zip
  b.add(tbox(5.4, 4.6, 4.6, 4.0, 35.4, 37.8, 0, -0.3), 'chest', 'clothDark', CD); // high collar
  b.add(tbox(5.6, 4.8, 5.4, 4.6, 35.2, 36.2, 0, -0.3), 'chest', 'cloth', C); // collar band
  b.add(limb(1.3, 1.2, 35.6, 39.4, 0, 0.1, SEG), 'neck', 'skin', S);
  if (!lite) {
    // Light vest: a front panel with a chest light strip either side.
    b.add(tbox(8.4 * w, 0.8, 9.2 * w, 0.8, 28.0, 33.8, 0, 3.1), 'chest', 'plate', JACKET2);
    for (const sx of [1, -1]) b.add(box(0.4, 4.6, 0.5, sx * 3.6 * w, 31.0, 3.6), 'chest', 'light', L);
  } else {
    // RUNNER: an open jacket and a faction neck gaiter.
    b.add(tbox(6.0, 5.2, 5.2, 4.6, 35.2, 38.0, 0, -0.1), 'chest', 'cloth', C);
  }
  // Jacket hem in the faction's dark tone, a side seam light strip.
  b.add(tbox(8.6 * w, 5.9, 8.6 * w, 5.9, 24.6, 25.4), 'spine', 'clothDark', CD);
  for (const sx of [1, -1]) b.add(box(0.4, 5.0, 0.6, sx * 4.7 * w, 31.0, -0.6), 'chest', 'light', L);

  // ---- back unit: the most important view. A compact battery module with the emblem, a
  // glowing status bar, side light rails and harness straps.
  const unitH = lite ? 6.0 : 7.4, unitY = lite ? 31.8 : 31.2, unitD = lite ? 1.8 : 2.4;
  b.add(tbox(6.6 * w, unitD, 7.0 * w, unitD, unitY - unitH / 2, unitY + unitH / 2, 0, -3.0 - unitD / 2), 'chest', 'cloth', C);
  b.add(tbox(5.4 * w, 0.5, 5.6 * w, 0.5, unitY - unitH / 2 + 0.7, unitY + unitH / 2 - 0.6, 0, -3.0 - unitD - 0.1), 'chest', 'plate', PLATE);
  b.add(box(5.2 * w, 0.7, 0.5, 0, unitY - unitH / 2 - 0.2, -3.2 - unitD), 'chest', 'light', L); // status bar
  for (const sx of [1, -1]) b.add(box(0.6, unitH - 1.2, 0.6, sx * 3.5 * w, unitY, -3.1 - unitD), 'chest', 'light', L);
  b.add(tbox(6.4 * w, 0.6, 6.0 * w, 0.6, 33.6, 34.6, 0, -3.0), 'chest', 'cloth', C); // shoulder yoke (faction)
  for (const sx of [1, -1]) b.add(box(1.0, 8.4, 0.5, sx * 2.9 * w, 30.4, 3.25), 'chest', 'armor', dark(JACKET, 0.7)); // straps
  if (gear === 'relay') {
    // RELAY: an antenna module on top of the unit, two whips and a dish.
    b.add(tbox(4.0, 2.0, 3.4, 1.8, unitY + unitH / 2, unitY + unitH / 2 + 2.2, 0, -4.2), 'chest', 'plate', PLATE);
    b.add(limb(0.22, 0.12, unitY + 3, unitY + 17, 2.2, -4.4, 4), 'chest', 'gold', STEEL);
    b.add(limb(0.22, 0.12, unitY + 3, unitY + 11, -1.6, -4.4, 4), 'chest', 'gold', STEEL);
    b.add(box(0.6, 0.6, 0.6, 2.2, unitY + 17.2, -4.4), 'chest', 'light', L);
    b.add(blob(1.6, 1.6, 0.5, -2.6, unitY + 2.6, -5.2, 6, 4), 'chest', 'gold', STEEL);
  }

  // ---- arms: jacket sleeves with faction shoulder panels, gloves, the TRACE device on the left wrist.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const ax = s * 6.4 * w, fx = s * 6.75 * w, hx = s * 6.95 * w;
    b.add(blob(1.95, 1.9, 2.05, ax, 34.2, -0.2, JS, 5), `arm${side}`, 'armor', JACKET2); // shoulder
    b.add(tbox(3.4, 4.4, 3.0, 3.6, 34.2, 36.6, ax + s * 0.2, -0.2), `arm${side}`, 'cloth', C); // shoulder panel
    b.add(limb(1.35, 1.6, 28.4, 34.4, ax, -0.2, SEG), `arm${side}`, 'armor', JACKET2); // upper arm
    b.add(blob(1.4, 1.4, 1.4, fx, 28.4, -0.2, JS, 4), `fore${side}`, 'armor', JACKET2); // elbow
    b.add(limb(1.15, 1.4, 23.4, 28.4, fx, -0.1, SEG), `fore${side}`, 'armor', JACKET2); // forearm
    b.add(tbox(2.5, 1.8, 2.5, 2.0, 23.2, 24.4, fx, -0.05), `fore${side}`, 'clothDark', CD); // cuff
    b.add(tbox(1.9, 2.2, 2.1, 2.4, 19.8, 23.2, hx, 0.3), `hand${side}`, 'boot', GLOVE); // glove
    b.add(tbox(0.8, 1.0, 0.9, 1.0, 21.0, 23.0, hx - s * 0.1, 1.6), `hand${side}`, 'boot', GLOVE); // thumb
    if (heavy) {
      // VANGUARD: layered shoulder plates and forearm guards.
      b.add(tbox(4.4, 5.0, 3.6, 4.4, 33.4, 37.4, ax + s * 0.6, -0.2), `arm${side}`, 'plate', PLATE);
      b.add(tbox(4.6, 5.2, 4.4, 5.0, 33.2, 33.9, ax + s * 0.6, -0.2), `arm${side}`, 'cloth', C);
      b.add(tbox(3.1, 3.2, 3.0, 3.2, 24.4, 27.6, fx, 0.15), `fore${side}`, 'plate', PLATE);
    }
  }
  // TRACE DEVICE (left wrist, outer side): housing and a screen that lights up.
  b.add(tbox(2.0, 2.6, 2.0, 2.6, 24.4, 26.6, 6.75 * w + 0.9, 0.2), 'foreL', 'plate', PLATE);
  b.add(box(0.3, 1.6, 2.0, 6.75 * w + 1.95, 25.5, 0.2), 'foreL', 'trace', TR);
  b.add(box(1.6, 0.3, 0.4, 6.75 * w + 0.9, 26.7, 1.4), 'foreL', 'trace', TR);
  if (gear === 'breaker') {
    // BREAKER: an unlock tool on the right hip and a decoder on the right forearm.
    b.add(tbox(1.6, 2.4, 1.4, 2.2, 17.4, 23.0, -5.0 * w, 0.6), 'hips', 'plate', PLATE);
    b.add(box(0.4, 4.4, 0.4, -5.85 * w, 20.0, 0.6), 'hips', 'light', L);
    b.add(tbox(2.6, 2.8, 2.4, 2.6, 24.6, 27.4, -6.75 * w - 0.4, 0.3), 'foreR', 'plate', PLATE);
    b.add(box(0.3, 1.8, 1.6, -6.75 * w - 1.7, 26.0, 0.3), 'foreR', 'light', L);
  }

  // ---- head: rounded skull, a small face, hair, earpiece.
  const jaw = look.jaw;
  b.add(headGeo(jaw, HS), 'head', 'skin', S);
  const eyeY = 42.2, eyeX = 1.45;
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const ex = s * eyeX;
    const ez = faceZ(ex, eyeY, jaw);
    const yaw = s * 0.32;
    // Eye: a dark iris, a white catch-light, an upper lid line.
    b.add(new THREE.BoxGeometry(0.95, 1.3, 0.3).rotateY(yaw).translate(ex, eyeY, ez - 0.05), 'head', `eye${side}`, look.eye);
    b.add(new THREE.BoxGeometry(0.34, 0.34, 0.2).rotateY(yaw).translate(ex + s * 0.18, eyeY + 0.32, ez + 0.1), 'head', `eye${side}`, 0xf8f4ec);
    b.add(new THREE.BoxGeometry(1.35, 0.32, 0.34).rotateZ(s * -0.12).rotateY(yaw).translate(ex + s * 0.05, eyeY + 0.72, ez), 'head', `lid${side}`, 0x15110f);
    // Brow.
    const by = eyeY + 1.45;
    b.add(new THREE.BoxGeometry(1.55, 0.3 * look.brow, 0.35).rotateZ(s * -0.1).rotateY(yaw).translate(ex + s * 0.08, by, faceZ(ex, by, jaw) - 0.05), 'head', `brow${side}`, dark(H, 0.8));
  }
  // Nose: a small wedge; mouth: a short line.
  b.add(tbox(0.5, 0.3, 0.3, 0.2, 40.6, 41.7, 0, faceZ(0, 41.1, jaw) + 0.1), 'head', 'skin', dark(S, 0.9));
  const my = 39.7;
  b.add(new THREE.BoxGeometry(1.3, 0.28, 0.3).translate(0, my, faceZ(0, my, jaw) - 0.05), 'head', 'mouth', 0x6b3530);
  // Ears.
  for (const s of [1, -1]) b.add(blob(0.45, 0.9, 0.7, s * 3.85, 41.8, 0.1, 5, 4), 'head', 'skin', dark(S, 0.92));
  // Earpiece (right ear) with a status light.
  b.add(blob(0.75, 1.0, 0.9, -4.25, 41.6, 0.2, 6, 4), 'head', 'plate', PLATE);
  b.add(box(0.25, 0.5, 0.5, -5.0, 41.6, 0.2), 'head', 'light', L);
  b.add(new THREE.BoxGeometry(0.3, 0.3, 3.0).rotateY(-0.35).translate(-3.6, 40.2, 2.0), 'head', 'plate', PLATE); // mic
  if (gear === 'spotter') {
    // SPOTTER: a monocular over the right eye.
    b.add(new THREE.CylinderGeometry(0.75, 0.85, 1.6, 8).rotateX(Math.PI / 2).translate(-eyeX, eyeY, faceZ(-eyeX, eyeY, jaw) + 0.7), 'head', 'plate', PLATE);
    b.add(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 8).rotateX(Math.PI / 2).translate(-eyeX, eyeY, faceZ(-eyeX, eyeY, jaw) + 1.55), 'head', 'light', L);
    b.add(box(0.4, 0.4, 3.4, -3.4, 43.3, 1.6), 'head', 'plate', PLATE);
  }
  addHair(b, look, H, C, HS);

  const geo = b.build();
  // Expressions as morph targets (relative offsets of the face parts).
  const browR = (s: number, up: number, tilt: number) => (x: number, _y: number, _z: number, c: THREE.Vector3): [number, number, number] =>
    [0, up + tilt * (x - c.x) * s, 0];
  const eyeS = (k: number) => (_x: number, y: number, _z: number, c: THREE.Vector3): [number, number, number] => [0, (y - c.y) * (k - 1), 0];
  const lid = (dy: number, tilt = 0, s = 1) => (x: number, _y: number, _z: number, c: THREE.Vector3): [number, number, number] => [0, dy + tilt * (x - c.x) * s, 0];
  const mouth = (open: number, smirk: number, wide: number) => (x: number, y: number, _z: number, c: THREE.Vector3): [number, number, number] =>
    [(x - c.x) * (wide - 1), (y - c.y) * (open - 1) + smirk * (x - c.x), 0];
  geo.morphAttributes.position = [
    // focused: brows down and in, eyes narrowed.
    b.morph([['browL', browR(1, -0.35, 0.22)], ['browR', browR(-1, -0.35, 0.22)], ['eyeL', eyeS(0.72)], ['eyeR', eyeS(0.72)],
      ['lidL', lid(-0.22, 0.08, 1)], ['lidR', lid(-0.22, 0.08, -1)], ['mouth', mouth(1, 0, 0.85)]]),
    // alert: brows up, eyes wide.
    b.morph([['browL', browR(1, 0.38, -0.08)], ['browR', browR(-1, 0.38, -0.08)], ['eyeL', eyeS(1.18)], ['eyeR', eyeS(1.18)],
      ['lidL', lid(0.15)], ['lidR', lid(0.15)], ['mouth', mouth(1.6, 0, 0.9)]]),
    // surprised: brows high, round eyes, an open mouth.
    b.morph([['browL', browR(1, 0.7, -0.05)], ['browR', browR(-1, 0.7, -0.05)], ['eyeL', eyeS(1.3)], ['eyeR', eyeS(1.3)],
      ['lidL', lid(0.3)], ['lidR', lid(0.3)], ['mouth', mouth(3.6, 0, 0.7)]]),
    // confident: one brow up, a slight squint, a smirk.
    b.morph([['browL', browR(1, 0.3, 0.05)], ['browR', browR(-1, -0.12, 0.1)], ['eyeL', eyeS(0.9)], ['eyeR', eyeS(0.82)],
      ['lidL', lid(-0.06)], ['lidR', lid(-0.12)], ['mouth', mouth(1, 0.22, 1.12)]]),
  ];
  geo.morphTargetsRelative = true;

  const trace = { value: 0 };
  const material = makeMaterial(trace);
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
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // skinned bounds do not follow the pose
  // Faction emblem on the back unit, riding on the chest bone.
  const emblem = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), emblemMat);
  emblem.position.set(0, unitY - J.chest[2] + 0.2, -3.0 - unitD - 0.4);
  emblem.rotation.y = Math.PI;
  emblem.castShadow = false;
  bones.chest.add(emblem);

  const colorAttr = geo.attributes.color as THREE.BufferAttribute;
  let painted = nationColor;
  const setNationColor = (color: number) => {
    if (color === painted) return;
    painted = color;
    for (const [region, c] of [['cloth', color], ['band', color], ['clothDark', dark(color, 0.55)], ['light', light(color)], ['trace', light(color, 0.45)]] as [Region, number][]) {
      const col = new THREE.Color(c);
      for (const [a, z] of b.regions.get(region) ?? []) for (let i = a; i < z; i++) colorAttr.setXYZ(i, col.r, col.g, col.b);
    }
    colorAttr.needsUpdate = true;
  };
  const infl = mesh.morphTargetInfluences!;
  const setExpression = (e: Exclude<Expression, 'neutral'>, k: number) => { infl[EXPRESSIONS.indexOf(e)] = k; };
  const setTrace = (k: number) => { trace.value = k; };
  let gun: THREE.Group | null = null, muzzle: THREE.Object3D | null = null;
  if (gear === 'spotter') {
    ({ gun, muzzle } = buildMarker(nationColor));
    bones.chest.add(gun);
  }
  return { mesh, bones, rest, material, emblem, look, gear, setNationColor, setExpression, setTrace, gun, muzzle };
}

/** Modular low-poly hair: a crown cap, a back/sides shell, bangs, and the style's own pieces. */
function addHair(b: SkinBuilder, look: Look, H: number, C: number, seg: number): void {
  const hs = look.hairStyle;
  const PI = Math.PI;
  const ws = Math.max(8, seg + 2), hseg = Math.max(4, Math.round(seg / 2));
  const cap = (grow: number, t1: number, color = H) => b.add(shell(grow, 0, t1, 0, 2 * PI, ws, hseg), 'head', 'hair', color);
  /** Back and sides down to the nape (phi π±… is the back of the head). */
  const back = (grow: number, t1: number, spread = 0.35, color = H) => b.add(shell(grow, 0.25 * PI, t1, PI - spread, PI + 2 * spread, ws, hseg), 'head', 'hair', color);
  /** A low-poly strand pointing down over the forehead. */
  const bang = (x: number, len: number, wid: number, tilt: number) => {
    const y = HC.y + 2.9, z = faceZ(x, y, 0) + 0.2;
    b.add(new THREE.ConeGeometry(wid, len, 4, 1).rotateY(PI / 4).scale(1, 1, 0.45).rotateX(PI).rotateZ(tilt).rotateX(-0.25).translate(x, y - len / 2 + 0.9, z), 'head', 'hair', H);
  };
  const fringe = (xs: [number, number, number, number][]) => { for (const [x, len, wd, t] of xs) bang(x, len, wd, t); };
  switch (hs) {
    case 'buzz':
      cap(0.18, 0.46 * PI);
      back(0.18, 0.42 * PI, 0.6);
      break;
    case 'short':
      cap(0.45, 0.43 * PI);
      back(0.4, 0.45 * PI, 0.5);
      fringe([[-1.9, 2.0, 1.1, 0.15], [-0.4, 2.4, 1.2, 0.05], [1.2, 2.2, 1.1, -0.1], [2.6, 1.6, 0.9, -0.2]]);
      break;
    case 'undercut': {
      cap(0.15, 0.48 * PI, dark(H, 0.65)); // faded sides
      b.add(shell(0.7, 0, 0.3 * PI, 0, 2 * PI, ws, hseg, 1.08), 'head', 'hair', H); // top volume
      fringe([[-1.0, 2.0, 1.3, 0.35], [0.8, 2.2, 1.3, 0.25]]);
      break;
    }
    case 'pony':
      cap(0.4, 0.43 * PI);
      back(0.35, 0.42 * PI, 0.55);
      fringe([[-2.2, 2.4, 1.1, 0.2], [-0.6, 2.0, 1.2, 0.05], [1.4, 2.6, 1.2, -0.12]]);
      b.add(box(1.6, 1.2, 1.2, 0, HC.y + 0.4, HC.z - HC.rz - 0.4), 'head', 'band', C);
      b.add(new THREE.ConeGeometry(1.3, 6.5, 5, 1).rotateX(PI).rotateX(-0.35).translate(0, HC.y - 2.6, HC.z - HC.rz - 1.4), 'head', 'hair', H);
      break;
    case 'bob':
      cap(0.55, 0.45 * PI);
      back(0.55, 0.62 * PI, 0.75);
      fringe([[-2.4, 2.3, 1.1, 0.12], [-1.0, 2.5, 1.2, 0.04], [0.5, 2.5, 1.2, -0.03], [1.9, 2.3, 1.1, -0.1], [3.0, 2.8, 0.9, -0.2]]);
      break;
    case 'spiky':
      cap(0.35, 0.44 * PI);
      back(0.3, 0.42 * PI, 0.5);
      for (const [x, z, h, rx, rz] of [[-2.2, 1.6, 3.2, 0.5, 0.5], [0.2, 2.2, 3.6, 0.7, 0], [2.4, 1.4, 3.0, 0.5, -0.5], [-1.6, -1.8, 3.2, -0.6, 0.4], [1.6, -2.0, 3.0, -0.7, -0.4], [0, -0.2, 3.4, 0, 0]] as const) {
        b.add(new THREE.ConeGeometry(1.25, h, 4, 1).rotateX(rx).rotateZ(rz).translate(x, HC.y + 4.0 + h * 0.3, HC.z + z), 'head', 'hair', H);
      }
      fringe([[-1.4, 2.0, 1.1, 0.2], [1.0, 1.8, 1.1, -0.15]]);
      break;
    case 'long':
      cap(0.5, 0.45 * PI);
      back(0.5, 0.7 * PI, 0.8);
      // Long hair falls down the back onto the shoulders.
      b.add(tbox(6.8, 1.8, 7.4, 2.4, 33.6, 40.4, 0, -4.0), 'head', 'hair', H);
      fringe([[-2.4, 2.6, 1.2, 0.18], [-0.6, 2.2, 1.2, 0.06], [1.6, 2.6, 1.2, -0.12]]);
      break;
    case 'sidepart':
      cap(0.45, 0.43 * PI);
      back(0.4, 0.46 * PI, 0.5);
      // A swept fringe from a side parting.
      b.add(new THREE.BoxGeometry(5.6, 1.4, 2.2).rotateZ(-0.28).translate(0.8, HC.y + 3.3, faceZ(0, HC.y + 3.3, 0) - 0.3), 'head', 'hair', H);
      bang(-2.4, 2.6, 1.0, 0.25);
      break;
  }
}
