import * as THREE from 'three';
import type { RoleId } from '../config/roles';
import type { BoneName, BuildOpts, Gear, Human, Look } from './humanModel';
import { BONES, JACKET, PLATE, SkinBuilder, STEEL, assembleHuman, blob, box, dark, gearFor, joints, light, lookFor, tbox } from './humanModel';

/**
 * v9.2 art prototype — "Stylized Future Street Agent".
 *
 * A friendlier, more human street-runner on the same skeleton and joint positions as the v9
 * operator (so every pose, animation and gameplay height stays as it is): about 5.6 heads,
 * a rounded head with big readable eyes and brows, clumped hair, a curved jacket with tails
 * that swing with the legs, slim trousers and chunky platform sneakers. Surfaces are lofted
 * rings (soft curves with a few hard edges) rather than boxes.
 *
 * Same rules as v9.1: everyone wears the same uniform (`b`); role gear is a separate layer
 * (`g`) shown to the wearer's side and, to enemies, only per `gearReveal`. ANCHOR has no gear
 * of its own. Hair, skin, face and build come from the character id only (`lookFor`).
 */

/** A ring of a lofted surface: height, half-width and half-depth, and centre offset. */
interface Ring { y: number; rx: number; rz: number; cx?: number; cz?: number }

/**
 * A lofted tube through `rings` (bottom to top), superellipse cross-sections with exponent `n`
 * (2 = ellipse, higher = squarer), smooth normals, optional end caps.
 */
function loft(rings: Ring[], seg: number, n = 2.4, capBottom = false, capTop = false): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const e = 2 / n;
  for (const r of rings) {
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      pos.push((r.cx ?? 0) + r.rx * Math.sign(s) * Math.abs(s) ** e, r.y, (r.cz ?? 0) + r.rz * Math.sign(c) * Math.abs(c) ** e);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i, b = k * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, b, d, a, d, c);
    }
  }
  const cap = (k: number, up: boolean) => {
    const r = rings[k], ci = pos.length / 3;
    pos.push(r.cx ?? 0, r.y, r.cz ?? 0);
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i, b = k * seg + ((i + 1) % seg);
      if (up) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  };
  if (capBottom) cap(0, false);
  if (capTop) cap(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Interpolated ring at height y (for placing details flush on a lofted surface). */
function ringAt(rings: Ring[], y: number): Ring {
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k], b = rings[k + 1];
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y || 1);
      const L = (p: number, q: number) => p + (q - p) * t;
      return { y, rx: L(a.rx, b.rx), rz: L(a.rz, b.rz), cx: L(a.cx ?? 0, b.cx ?? 0), cz: L(a.cz ?? 0, b.cz ?? 0) };
    }
  }
  return rings[y < rings[0].y ? 0 : rings.length - 1];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Torso skinning: hips → spine → chest with soft bands, and jacket tails that follow the legs a little. */
function torsoBone(x: number, y: number): BoneName | [BoneName, BoneName, number] {
  if (y < 21.6) return ['hips', x >= 0 ? 'thighL' : 'thighR', 0.38 * clamp01((21.6 - y) / 2.6) * clamp01(Math.abs(x) / 2.2)];
  if (y < 24.2) return 'hips';
  if (y < 25.4) return ['hips', 'spine', (y - 24.2) / 1.2 * 0.5];
  if (y < 28.0) return 'spine';
  if (y < 29.4) return ['spine', 'chest', (y - 28.0) / 1.4 * 0.6 + 0.2];
  return 'chest';
}

// ---- palette (street jacket: black/charcoal with faction trims) -------------------------------
const JKT = 0x1f2228, JKT2 = 0x2a2e36, PANT = 0x2f333b, PANT2 = 0x262930, SOLE = 0xeef0f2, UPPER = 0x22252b, GLOVE = 0x17191d;

// ---- head ----------------------------------------------------------------------------------------
const HV = { y: 42.7, z: 0.25, rx: 4.05, ry: 4.4, rz: 4.15 };

/** A rounded head with cheekbones and a defined jaw: soft on top, planes toward the chin. */
function headV2(jaw: number, ws: number, hs: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0.05) {
      const t = -y;
      // Cheeks narrow into a jaw (sharper for higher `jaw`), the chin comes forward a touch.
      x *= 1 - (0.16 + 0.14 * jaw) * t * t * 1.5 - 0.05 * t;
      if (z > 0) z *= 1 - 0.08 * t; else z *= 1 - 0.32 * t * t;
      z += 0.07 * t * t;
      y *= 1 + 0.06 * t;
    } else {
      x *= 1 + 0.025 * y;
      if (z < 0) z *= 1.04; // a fuller back of the skull
    }
    p.setXYZ(i, x * HV.rx, y * HV.ry, z * HV.rz);
  }
  g.computeVertexNormals();
  return g.translate(0, HV.y, HV.z);
}

/** The head's front surface depth at (x, y), to seat face parts on it. */
function frontZ(x: number, y: number, jaw: number): number {
  const ny = (y - HV.y) / HV.ry;
  let sx = 1;
  if (ny < 0.05) { const t = -ny; sx = 1 - (0.16 + 0.14 * jaw) * t * t * 1.5 - 0.05 * t; }
  const nx = x / (HV.rx * sx);
  const base = Math.sqrt(Math.max(0.04, 1 - nx * nx - ny * ny));
  const t = Math.max(0, -ny);
  return HV.z + HV.rz * base * (1 - 0.08 * t) + 0.07 * t * t * HV.rz;
}

/** A clump of hair along a path of points: tapering diamond section, flat side facing out from the head. */
function strandPath(pts: THREE.Vector3[], w: number, t: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const centre = new THREE.Vector3(0, HV.y, HV.z);
  const n = pts.length - 1;
  for (let i = 0; i <= n; i++) {
    const tan = (i < n ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    const out = pts[i].clone().sub(centre).normalize();
    let side = new THREE.Vector3().crossVectors(tan, out);
    if (side.lengthSq() < 1e-5) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const nrm = new THREE.Vector3().crossVectors(side, tan).normalize();
    const k = 1 - (i / (n + 0.7)) ** 1.3;
    const W = w * k, T = t * k, c = pts[i];
    for (const [a, b] of [[W, 0], [0, T], [-W, 0], [0, -T * 0.4]] as const) pos.push(c.x + side.x * a + nrm.x * b, c.y + side.y * a + nrm.y * b, c.z + side.z * a + nrm.z * b);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) {
    const a = i * 4 + j, b = i * 4 + ((j + 1) % 4);
    idx.push(a, b, b + 4, a, b + 4, a + 4);
  }
  const tip = pts[n].clone().addScaledVector(pts[n].clone().sub(pts[n - 1]).normalize(), 0.5);
  const ti = pos.length / 3;
  pos.push(tip.x, tip.y, tip.z);
  for (let j = 0; j < 4; j++) idx.push(n * 4 + j, n * 4 + ((j + 1) % 4), ti);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Unit direction from the head centre for (theta from the crown, phi round from the front, +phi = the character's left). */
const dirOf = (theta: number, phi: number) => new THREE.Vector3(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi));

/**
 * Points along the scalp from A to B (a great-circle arc on the head's ellipsoid), floating
 * `g0`→`g1` above it; optionally continuing straight down to `dropY` (long hair falling).
 */
function arc(a: [number, number], b: [number, number], g0: number, g1: number, steps: number, dropY?: number): THREE.Vector3[] {
  const da = dirOf(a[0], a[1]), db = dirOf(b[0], b[1]);
  const ang = da.angleTo(db), sin = Math.sin(ang) || 1;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const d = ang < 1e-4 ? da.clone() : da.clone().multiplyScalar(Math.sin((1 - t) * ang) / sin).add(db.clone().multiplyScalar(Math.sin(t * ang) / sin));
    const gr = g0 + (g1 - g0) * t;
    pts.push(new THREE.Vector3(d.x * (HV.rx + gr), HV.y + d.y * (HV.ry + gr), HV.z + d.z * (HV.rz + gr)));
  }
  if (dropY !== undefined) {
    const last = pts[pts.length - 1];
    const outward = new THREE.Vector3(last.x, 0, last.z - HV.z).normalize().multiplyScalar(0.25);
    const n = Math.max(1, Math.round((last.y - dropY) / 2.2));
    for (let i = 1; i <= n; i++) pts.push(new THREE.Vector3(last.x + outward.x * i, last.y - ((last.y - dropY) * i) / n, last.z + outward.z * i));
  }
  return pts;
}

/** A tiny deterministic random stream (hair layout jitter per person). */
function rngFor(id: number): () => number {
  let a = (id * 1597334677 + 12345) >>> 0;
  return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
}

/**
 * Clumped hair: a thin scalp cap with strands combed over it along the head's surface — a fringe
 * that stops above the brows, crown strands swept back or to one side, sides, nape and (for long
 * styles) lengths falling to the shoulders. Free-standing spikes only for the spiky style.
 * Every style comes from `look.hairStyle`, which depends on the id only — never on the role.
 */
function hairV2(b: SkinBuilder, look: Look, id: number, H: number, detail: number): void {
  const PI = Math.PI, r = rngFor(id + 31);
  const steps = detail >= 2 ? 5 : 3;
  const ws = detail >= 2 ? 14 : 10, hseg = detail >= 2 ? 7 : 5;
  const Hd = dark(H, 0.72), Hl = light(H, 0.08);
  /** A shell round the head. three.js measures phi from -x toward +z (front at phi = π/2, back at 3π/2). */
  const shell = (grow: number, t1: number, p0: number, p1: number, t0: number, color: number) =>
    b.add(new THREE.SphereGeometry(1, ws, hseg, p0, p1, t0, t1).scale(HV.rx + grow, HV.ry + grow, HV.rz + grow).translate(0, HV.y, HV.z), 'head', 'hair', color);
  /**
   * The scalp: a crown cap all round, and the back and sides down to `t1`; the forehead is left
   * to the fringe strands (a cap reaching down the front reads as a helmet).
   */
  const cap = (grow: number, t1: number, _p0 = 0, _p1 = 2 * PI, _t0 = 0, color = Hd) => {
    shell(grow, Math.min(t1, 0.24 * PI), 0, 2 * PI, 0, color);
    if (t1 > 0.24 * PI) shell(grow, t1 - 0.2 * PI, 1.5 * PI - 0.62 * PI, 1.24 * PI, 0.2 * PI, color);
  };
  const add = (pts: THREE.Vector3[], w: number, color = H) => b.add(strandPath(pts, w, w * 0.55), 'head', 'hair', color);
  /** The brow line's polar angle on the head (fringes end just above it). */
  const browTheta = Math.acos(Math.min(1, (42.15 + 1.5 + 0.7 - HV.y) / (HV.ry + 0.5))); // tips stop clear of the brows
  const fringe = (n: number, spread: number, sweep: number, len = 1) => {
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1) - 0.5;
      const p0 = u * spread + sweep * 0.35 + (r() - 0.5) * 0.08;
      const tEnd = Math.min(browTheta, 0.12 * PI + (browTheta - 0.12 * PI) * len * (0.82 + r() * 0.18));
      add(arc([0.08 * PI, p0 - sweep * 0.5], [tEnd, p0 + sweep * 0.25], 0.38, 0.62, steps), 1.55 + r() * 0.35, i % 2 ? H : Hl);
    }
  };
  /** Strands from the front of the crown swept back over the head to the nape. */
  const sweepBack = (n: number, spread: number, end = 0.62 * PI) => {
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1) - 0.5;
      add(arc([0.17 * PI, u * spread], [end + (r() - 0.5) * 0.1, PI + u * spread * 0.6], 0.45, 0.55, steps + 1), 1.5 + r() * 0.3, i % 2 ? H : Hl);
    }
  };
  const sides = (endTheta: number, dropY?: number, rows = 2) => {
    for (const s of [1, -1]) for (let k = 0; k < rows; k++) {
      const ph = s * (0.42 * PI + k * 0.2 * PI);
      add(arc([0.28 * PI, ph], [endTheta + (r() - 0.5) * 0.06, ph + s * 0.06], 0.42, 0.55, steps, dropY), 1.35 + r() * 0.25, k % 2 ? H : Hl);
    }
  };
  const nape = (n: number, endTheta: number, dropY?: number) => {
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1) - 0.5;
      add(arc([0.35 * PI, PI + u * 1.6], [endTheta + (r() - 0.5) * 0.06, PI + u * 1.7], 0.42, 0.55, steps, dropY), 1.45 + r() * 0.25, i % 2 ? H : Hl);
    }
  };
  switch (look.hairStyle) {
    case 'buzz':
      cap(0.18, 0.48 * PI, 0, 2 * PI, 0, H);
      for (let i = 0; i < 6; i++) add(arc([0.12 * PI, (i - 2.5) * 0.35], [0.3 * PI, (i - 2.5) * 0.45], 0.2, 0.3, 3), 1.2, Hl);
      break;
    case 'undercut':
      cap(0.14, 0.5 * PI, 0, 2 * PI, 0, Hd);
      sweepBack(7, 1.6, 0.42 * PI);
      fringe(2, 0.5, 0.8, 0.7);
      break;
    case 'spiky':
      cap(0.3, 0.5 * PI);
      for (let i = 0; i < 10; i++) {
        const th = 0.08 * PI + (i % 3) * 0.1, ph = (i / 10) * 2 * PI;
        const root = dirOf(th, ph).multiply(new THREE.Vector3(HV.rx + 0.4, HV.ry + 0.4, HV.rz + 0.4)).add(new THREE.Vector3(0, HV.y, HV.z));
        const out = dirOf(th * 0.6, ph);
        const pts = [root];
        for (let k = 1; k <= 3; k++) pts.push(root.clone().addScaledVector(out, k * 1.25).add(new THREE.Vector3(0, 0, -0.35 * k)));
        add(pts, 1.4, i % 2 ? H : Hl);
      }
      fringe(5, 1.7, 0.1, 0.85);
      sides(0.52 * PI, undefined, 1);
      nape(4, 0.58 * PI);
      break;
    case 'pony':
      cap(0.3, 0.5 * PI);
      sweepBack(6, 1.5, 0.6 * PI);
      fringe(3, 1.0, -0.6, 0.9);
      sides(0.5 * PI, undefined, 1);
      // The tail, tied at the back with a band in the faction colour.
      b.add(blob(0.9, 0.7, 0.9, 0, HV.y - 0.4, HV.z - HV.rz - 0.4, 8, 5), 'head', 'band', 0xffffff);
      for (const dx of [-0.55, 0, 0.55]) {
        const s0 = new THREE.Vector3(dx, HV.y - 0.4, HV.z - HV.rz - 0.8);
        add([s0, s0.clone().add(new THREE.Vector3(dx * 0.2, -1.6, -1.0)), s0.clone().add(new THREE.Vector3(dx * 0.4, -3.8, -1.4)), s0.clone().add(new THREE.Vector3(dx * 0.5, -6.0, -1.2))], 1.05, H);
      }
      break;
    case 'bob':
      cap(0.32, 0.5 * PI);
      fringe(6, 1.9, 0, 1);
      sweepBack(4, 1.2, 0.55 * PI);
      sides(0.66 * PI, 37.6, 2);
      nape(6, 0.66 * PI, 37.4);
      break;
    case 'long':
      cap(0.32, 0.5 * PI);
      fringe(5, 1.7, 0.4, 1);
      sweepBack(4, 1.2, 0.55 * PI);
      sides(0.62 * PI, 34.0, 2);
      nape(7, 0.62 * PI, 32.5);
      break;
    case 'sidepart':
      cap(0.3, 0.5 * PI);
      for (let i = 0; i < 6; i++) add(arc([0.1 * PI, -0.6 + i * 0.12], [0.3 * PI + i * 0.025, 0.55 + i * 0.22], 0.45, 0.6, steps), 1.55, i % 2 ? H : Hl);
      fringe(3, 0.8, 1.0, 0.95);
      sides(0.52 * PI, undefined, 1);
      nape(4, 0.58 * PI);
      break;
    default: // short
      cap(0.3, 0.5 * PI);
      fringe(5, 1.7, 0.25, 0.85);
      sweepBack(5, 1.3, 0.52 * PI);
      sides(0.5 * PI, undefined, 1);
      nape(4, 0.56 * PI);
      break;
  }
}

/**
 * Light strips a shade deeper than the faction colour: with their glow on top they stay
 * orange / blue / yellow instead of washing out (a lit SOL strip must not read as STAR).
 */
export const stripTone = (c: number) => new THREE.Color(c).multiplyScalar(0.72).getHex();

/** Head size relative to the modelled one (5.5–6 heads tall). */
const HEAD_SCALE = 0.94;
const HEAD_BONE = BONES.indexOf('head');

/** Scales every piece riding only on the head bone (and the face-part centres) about the neck joint at height y0. */
function scaleHead(sb: SkinBuilder, y0: number, k: number): void {
  for (let i = 0; i < sb.bone.length; i++) {
    if (sb.bone[i] !== HEAD_BONE || ((sb.w2[i] ?? 0) > 0 && sb.bone2[i] !== HEAD_BONE)) continue;
    sb.pos[i * 3] *= k;
    sb.pos[i * 3 + 1] = y0 + (sb.pos[i * 3 + 1] - y0) * k;
    sb.pos[i * 3 + 2] *= k;
  }
  for (const c of sb.centers.values()) if (c.y > y0) c.set(c.x * k, y0 + (c.y - y0) * k, c.z * k);
}

export function buildHumanV2(id: number, nationColor: number, emblemMat: THREE.Material, opts: BuildOpts = {}): Human {
  const look = lookFor(id);
  const gear: Gear = opts.role ? gearFor(opts.role as RoleId, id) : id % 2 ? 'vanguard' : 'runner';
  const det = opts.detail ?? 2;
  const SEG = det >= 2 ? 10 : det === 1 ? 8 : 6, LS = det >= 2 ? 8 : 6, HW = det >= 2 ? 16 : 12, HH = det >= 2 ? 12 : 9;
  const w = look.build;
  const J = joints(w);
  const b = new SkinBuilder(), g = new SkinBuilder();
  const S = look.skin, H = look.hair, C = nationColor, L = stripTone(nationColor), TR = light(nationColor, 0.45);

  // ---- legs: slim trousers with a little flare over chunky platform sneakers.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const x = s * 2.3;
    b.add(loft([{ y: 12.4, rx: 1.9, rz: 2.0, cx: x, cz: 0.2 }, { y: 15, rx: 2.05, rz: 2.15, cx: x }, { y: 19, rx: 2.35, rz: 2.4, cx: x }, { y: 23.2, rx: 2.55, rz: 2.6, cx: x * 0.98 }], LS), `thigh${side}`, 'armor', PANT);
    b.add(blob(1.95, 1.8, 2.0, x, 12.6, 0.3, LS, 5), `shin${side}`, 'armor', PANT);
    b.add(blob(1.55, 1.45, 0.5, x, 12.7, 2.05, LS, 4), `shin${side}`, 'plate', PANT2); // knee panel
    b.add(loft([{ y: 3.6, rx: 2.0, rz: 2.2, cx: x, cz: 0.15 }, { y: 5.2, rx: 1.65, rz: 1.8, cx: x, cz: 0.1 }, { y: 8.6, rx: 1.78, rz: 1.98, cx: x, cz: 0.0 }, { y: 11.4, rx: 1.78, rz: 1.9, cx: x, cz: 0.2 }, { y: 12.8, rx: 1.95, rz: 2.0, cx: x, cz: 0.25 }], LS), `shin${side}`, 'armor', PANT);
    // Sneaker: platform sole (white), a faction midsole line, a rounded upper, toe bumper, heel tab.
    b.add(loft([{ y: 0, rx: 1.95, rz: 3.95, cx: x, cz: 1.0 }, { y: 1.4, rx: 2.0, rz: 4.0, cx: x, cz: 1.0 }], LS + 4, 4, true, false), `foot${side}`, 'boot', SOLE);
    b.add(loft([{ y: 1.4, rx: 2.02, rz: 4.02, cx: x, cz: 1.0 }, { y: 1.85, rx: 1.98, rz: 3.95, cx: x, cz: 1.0 }], LS + 4, 4), `foot${side}`, 'cloth', C);
    b.add(loft([{ y: 1.85, rx: 1.85, rz: 3.75, cx: x, cz: 0.95 }, { y: 3.0, rx: 1.7, rz: 3.2, cx: x, cz: 0.75 }, { y: 4.1, rx: 1.55, rz: 2.1, cx: x, cz: -0.1 }, { y: 4.6, rx: 1.6, rz: 1.8, cx: x, cz: -0.3 }], LS + 2, 3, false, true), `foot${side}`, 'boot', UPPER);
    b.add(blob(1.55, 0.85, 1.1, x, 2.3, 3.9, LS, 4), `foot${side}`, 'boot', SOLE); // toe bumper
    b.add(tbox(1.0, 0.5, 0.8, 0.5, 2.6, 5.0, x, -2.0), `foot${side}`, 'cloth', C); // heel tab
    b.add(box(0.9, 0.25, 1.6, x, 3.3, 2.2), `foot${side}`, 'light', L); // lace light
    b.add(box(0.3, 6.0, 0.5, x + s * 2.32, 18.5, -0.5), `thigh${side}`, 'light', L); // side seam light
  }

  // ---- torso: trousers at the hips under a curved street jacket with tails.
  const jacket: Ring[] = [
    { y: 18.4, rx: 5.15 * w, rz: 3.8, cz: -0.25 }, { y: 20.0, rx: 4.85 * w, rz: 3.5, cz: -0.1 }, { y: 22.2, rx: 4.6 * w, rz: 3.25 },
    { y: 24.6, rx: 4.15 * w, rz: 2.95 }, { y: 26.6, rx: 4.25 * w, rz: 3.1, cz: 0.05 }, { y: 29.2, rx: 4.85 * w, rz: 3.5, cz: 0.15 },
    { y: 32.0, rx: 5.3 * w, rz: 3.7, cz: 0.2 }, { y: 34.1, rx: 5.35 * w, rz: 3.25 }, { y: 35.3, rx: 4.5 * w, rz: 2.85 }, { y: 36.0, rx: 3.0, rz: 2.35 },
  ];
  b.add(loft([{ y: 18.0, rx: 4.35 * w, rz: 3.05 }, { y: 23.5, rx: 4.3 * w, rz: 3.05 }], SEG, 2.6, true, false), torsoBone, 'armor', PANT2);
  b.add(loft(jacket, SEG + 4, 2.5, false, true), torsoBone, 'armor', JKT);
  // Hem band in the faction colour, the zip, a chest panel and glowing seams.
  b.add(loft([{ ...jacket[0], rx: jacket[0].rx + 0.08, rz: jacket[0].rz + 0.08 }, { ...ringAt(jacket, 19.0), rx: ringAt(jacket, 19.0).rx + 0.08, rz: ringAt(jacket, 19.0).rz + 0.08 }], SEG + 4, 2.5), torsoBone, 'cloth', C);
  const zipZ = (y: number) => { const rg = ringAt(jacket, y); return (rg.cz ?? 0) + rg.rz + 0.05; };
  b.add(tbox(0.32, 0.3, 0.32, 0.3, 19.0, 31.0, 0, (zipZ(19) + zipZ(31)) / 2), torsoBone, 'gold', STEEL);
  // Open neckline: an inner layer in the faction colour framed by dark lapels.
  b.add(tbox(0.7, 0.3, 3.2, 0.3, 30.6, 35.4, 0, zipZ(33) - 0.08, 0.15), 'chest', 'cloth', C);
  for (const sx of [1, -1]) b.add(new THREE.BoxGeometry(0.55, 5.4, 0.36).rotateZ(sx * 0.27).translate(sx * 0.95, 33.0, zipZ(33) + 0.02), 'chest', 'armor', JKT2);
  for (const sx of [1, -1]) {
    const yA = 27.6, yB = 33.6, rg = ringAt(jacket, 30.6);
    b.add(tbox(1.9, 0.35, 2.2, 0.35, yA, yB, sx * 2.1 * w, (rg.cz ?? 0) + rg.rz * 0.93), 'chest', 'armor', JKT2); // chest panel
    b.add(box(0.28, 5.2, 0.3, sx * 3.35 * w, 30.8, (rg.cz ?? 0) + rg.rz * 0.8), 'chest', 'light', L);
    const side = ringAt(jacket, 30);
    b.add(box(0.3, 7.5, 0.4, sx * (side.rx - 0.05), 29.5, -0.4), torsoBone, 'light', L); // side seam
    b.add(tbox(1.1, 1.7, 1.1, 1.7, 20.0, 22.4, sx * 3.9 * w, 2.6), 'hips', 'armor', JKT2); // pockets
  }
  // Stand-up collar in the faction colour, a neck, and a soft lining.
  b.add(loft([{ y: 35.1, rx: 3.45, rz: 3.0, cz: -0.25 }, { y: 36.4, rx: 3.3, rz: 2.85, cz: -0.25 }, { y: 37.9, rx: 3.15, rz: 2.75, cz: -0.35 }], SEG, 2.2), 'chest', 'cloth', C);
  b.add(loft([{ y: 35.2, rx: 1.45, rz: 1.4, cz: 0.1 }, { y: 39.4, rx: 1.3, rz: 1.3, cz: 0.15 }], LS), 'neck', 'skin', S);

  // Back yoke in the faction colour across the shoulder blades (the view you chase).
  { const rg = ringAt(jacket, 34.0); b.add(new THREE.CylinderGeometry(1, 1, 1.3, 14, 1, true, Math.PI * 0.62, Math.PI * 0.76).scale(rg.rx + 0.06, 1, rg.rz + 0.06).translate(0, 34.0, rg.cz ?? 0), 'chest', 'cloth', C); }
  // ---- back unit: compact, rounded, faction frame and the emblem; light rails.
  const unitY = 31.3, unitZ = -(3.4 + 1.15);
  b.add(loft([{ y: unitY - 3.0, rx: 2.85 * w, rz: 1.15, cz: unitZ }, { y: unitY + 3.0, rx: 2.85 * w, rz: 1.15, cz: unitZ }], 12, 5, true, true), 'chest', 'cloth', C);
  b.add(loft([{ y: unitY - 2.5, rx: 2.4 * w, rz: 0.4, cz: unitZ - 1.05 }, { y: unitY + 2.5, rx: 2.4 * w, rz: 0.4, cz: unitZ - 1.05 }], 12, 5, true, true), 'chest', 'plate', PLATE);
  b.add(box(3.6 * w, 0.45, 0.4, 0, unitY - 3.3, unitZ - 0.9), 'chest', 'light', L);
  for (const sx of [1, -1]) {
    b.add(box(0.45, 5.0, 0.45, sx * 3.0 * w, unitY, unitZ - 0.7), 'chest', 'light', L);
    b.add(box(0.9, 6.5, 0.4, sx * 2.6 * w, 31.0, ringAt(jacket, 31).rz + 0.25), 'chest', 'armor', dark(JACKET, 0.7)); // harness straps
  }

  // ---- arms: jacket sleeves with faction trims, a flared cuff, hands with fingerless gloves.
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const ax = s * 6.4 * w, fx = s * 6.75 * w, hx = s * 6.95 * w;
    b.add(blob(2.15, 1.75, 2.2, ax, 33.9, -0.2, SEG, 6), `arm${side}`, 'armor', JKT2); // shoulder
    b.add(loft([{ y: 32.5, rx: 1.86, rz: 1.92, cx: ax + s * 0.04, cz: -0.2 }, { y: 33.4, rx: 1.93, rz: 1.98, cx: ax, cz: -0.2 }], LS), `arm${side}`, 'cloth', C); // sleeve band
    b.add(loft([{ y: 28.4, rx: 1.6, rz: 1.65, cx: fx, cz: -0.2 }, { y: 31.5, rx: 1.72, rz: 1.78, cx: (ax + fx) / 2, cz: -0.2 }, { y: 34.6, rx: 1.95, rz: 2.0, cx: ax, cz: -0.2 }], LS), `arm${side}`, 'armor', JKT2);
    b.add(blob(1.62, 1.55, 1.65, fx, 28.4, -0.2, LS, 5), `fore${side}`, 'armor', JKT2); // elbow
    b.add(loft([{ y: 23.7, rx: 1.85, rz: 1.9, cx: hx * 0.99, cz: 0 }, { y: 25.0, rx: 1.55, rz: 1.6, cx: fx, cz: -0.05 }, { y: 28.4, rx: 1.58, rz: 1.62, cx: fx, cz: -0.15 }], LS), `fore${side}`, 'armor', JKT2);
    b.add(loft([{ y: 23.5, rx: 1.95, rz: 2.0, cx: hx * 0.99 }, { y: 24.2, rx: 1.92, rz: 1.98, cx: hx * 0.99 }], LS), `fore${side}`, 'cloth', C); // cuff
    b.add(loft([{ y: 20.4, rx: 0.85, rz: 1.05, cx: hx, cz: 0.35 }, { y: 21.6, rx: 1.0, rz: 1.25, cx: hx, cz: 0.35 }, { y: 23.4, rx: 1.0, rz: 1.2, cx: hx, cz: 0.2 }], LS, 3, true, true), `hand${side}`, 'skin', S);
    b.add(loft([{ y: 21.8, rx: 1.06, rz: 1.3, cx: hx, cz: 0.32 }, { y: 23.5, rx: 1.06, rz: 1.26, cx: hx, cz: 0.2 }], LS, 3), `hand${side}`, 'boot', GLOVE);
    b.add(blob(0.42, 0.75, 0.42, hx - s * 0.75, 21.9, 1.25, 6, 4), `hand${side}`, 'skin', S); // thumb
  }
  // TRACE DEVICE on the left wrist: housing and a screen that lights up.
  b.add(tbox(1.9, 2.4, 1.9, 2.4, 24.5, 26.4, 6.75 * w + 1.1, 0.15), 'foreL', 'plate', PLATE);
  b.add(box(0.3, 1.5, 1.9, 6.75 * w + 2.1, 25.45, 0.15), 'foreL', 'trace', TR);
  b.add(box(1.5, 0.28, 0.4, 6.75 * w + 1.1, 26.5, 1.3), 'foreL', 'trace', TR);

  // ---- head: rounded skull, big readable eyes, brows, nose, mouth, ears, earpiece.
  const jaw = look.jaw;
  b.add(headV2(jaw, HW, HH), 'head', 'skin', S);
  const eyeY = 42.15, eyeX = 1.55;
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const ex = s * eyeX, ez = frontZ(ex, eyeY, jaw), yaw = s * 0.33;
    const at = (gg: THREE.BufferGeometry, dz: number, dx = 0, dy = 0) => gg.rotateY(yaw).translate(ex + dx, eyeY + dy, ez + dz);
    b.add(at(new THREE.SphereGeometry(1, 10, 6).scale(0.86, 0.78, 0.22), -0.08), 'head', `eye${side}`, 0xf6f3ee); // white
    b.add(at(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 12).rotateX(Math.PI / 2), 0.1, s * 0.05, -0.05), 'head', `eye${side}`, look.eye); // iris
    b.add(at(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 10).rotateX(Math.PI / 2), 0.16, s * 0.05, -0.05), 'head', `eye${side}`, 0x0d0b0a); // pupil
    b.add(at(new THREE.SphereGeometry(0.13, 6, 4), 0.22, s * 0.2, 0.2), 'head', `eye${side}`, 0xffffff); // catch-light
    b.add(at(new THREE.BoxGeometry(1.95, 0.34, 0.32).rotateZ(s * -0.1), 0.02, s * 0.05, 0.74), 'head', `lid${side}`, 0x16110f); // upper lash line
    b.add(at(new THREE.BoxGeometry(0.5, 0.22, 0.3).rotateZ(s * 0.5), 0.0, s * 0.98, 0.6), 'head', `lid${side}`, 0x16110f); // outer flick
    const by = eyeY + 1.5, bz = frontZ(ex, by, jaw);
    b.add(new THREE.BoxGeometry(1.3, 0.42 * look.brow, 0.36).rotateZ(s * 0.0).rotateY(yaw).translate(ex - s * 0.2, by - 0.05, bz - 0.04), 'head', `brow${side}`, dark(H, 0.75));
    b.add(new THREE.BoxGeometry(0.85, 0.32 * look.brow, 0.34).rotateZ(s * 0.26).rotateY(yaw).translate(ex + s * 0.78, by + 0.12, frontZ(ex + s * 0.78, by, jaw) - 0.06), 'head', `brow${side}`, dark(H, 0.75));
    b.add(blob(0.42, 0.85, 0.62, s * (HV.rx * 0.97), 41.9, HV.z + 0.05, 6, 4), 'head', 'skin', dark(S, 0.93)); // ear
  }
  b.add(tbox(0.55, 0.45, 0.32, 0.25, 40.55, 41.85, 0, frontZ(0, 41.2, jaw) + 0.12), 'head', 'skin', dark(S, 0.9)); // nose
  b.add(blob(0.3, 0.2, 0.18, 0, 40.65, frontZ(0, 40.65, jaw) + 0.35, 6, 4), 'head', 'skin', light(S, 0.12)); // nose tip
  const my = 39.55, mz = frontZ(0, my, jaw);
  b.add(new THREE.BoxGeometry(1.25, 0.24, 0.28).translate(0, my, mz - 0.03), 'head', 'mouth', 0x6b3530);
  for (const s of [1, -1]) b.add(new THREE.BoxGeometry(0.34, 0.2, 0.26).rotateZ(s * 0.45).translate(s * 0.72, my + 0.1, frontZ(s * 0.72, my, jaw) - 0.05), 'head', 'mouth', 0x6b3530);
  // Earpiece (right ear) with a status light and a short mic.
  b.add(blob(0.8, 1.05, 0.95, -(HV.rx + 0.25), 41.8, 0.25, 8, 5), 'head', 'plate', PLATE);
  b.add(box(0.25, 0.5, 0.5, -(HV.rx + 1.05), 41.8, 0.25), 'head', 'light', L);
  b.add(new THREE.BoxGeometry(0.28, 0.28, 2.6).rotateY(-0.38).translate(-3.75, 40.4, 2.0), 'head', 'plate', PLATE);
  hairV2(b, look, id, H, det);

  // ---- role gear (a separate layer, same pieces as v9.1 placed on this body).
  const heavy = gear === 'vanguard', lite = gear === 'runner';
  for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) {
    const x = s * 2.3, ax = s * 6.4 * w, fx = s * 6.75 * w;
    if (lite) g.add(box(0.35, 5.0, 0.5, x + s * 1.75, 8.0, -0.6), `shin${side}`, 'light', L);
    if (heavy) {
      g.add(tbox(4.6, 5.0, 3.8, 4.4, 33.4, 37.6, ax + s * 0.7, -0.2), `arm${side}`, 'plate', PLATE);
      g.add(tbox(4.8, 5.2, 4.6, 5.0, 33.2, 33.9, ax + s * 0.7, -0.2), `arm${side}`, 'cloth', C);
      g.add(tbox(3.4, 3.4, 3.2, 3.4, 24.6, 27.6, fx, 0.15), `fore${side}`, 'plate', PLATE);
    }
  }
  if (lite) g.add(loft([{ y: 35.4, rx: 3.6, rz: 3.15, cz: -0.15 }, { y: 38.2, rx: 3.0, rz: 2.75, cz: -0.1 }], SEG, 2.2), 'chest', 'cloth', C); // neck gaiter
  if (gear === 'relay') {
    g.add(tbox(3.6, 1.8, 3.0, 1.6, unitY + 3.0, unitY + 5.0, 0, unitZ - 0.4), 'chest', 'plate', PLATE);
    g.add(new THREE.CylinderGeometry(0.12, 0.2, 12, 4).translate(1.8, unitY + 10, unitZ - 0.6), 'chest', 'gold', STEEL);
    g.add(new THREE.CylinderGeometry(0.12, 0.2, 7, 4).translate(-1.4, unitY + 7.5, unitZ - 0.6), 'chest', 'gold', STEEL);
    g.add(box(0.6, 0.6, 0.6, 1.8, unitY + 16.2, unitZ - 0.6), 'chest', 'light', L);
  }
  if (gear === 'breaker') {
    g.add(tbox(1.6, 2.4, 1.4, 2.2, 17.4, 23.0, -5.2 * w, 0.6), 'hips', 'plate', PLATE);
    g.add(box(0.4, 4.4, 0.4, -6.05 * w, 20.0, 0.6), 'hips', 'light', L);
    g.add(tbox(2.6, 2.8, 2.4, 2.6, 24.6, 27.4, -6.75 * w - 0.5, 0.3), 'foreR', 'plate', PLATE);
    g.add(box(0.3, 1.8, 1.6, -6.75 * w - 1.85, 26.0, 0.3), 'foreR', 'light', L);
  }
  if (gear === 'spotter') {
    const ez = frontZ(-eyeX, eyeY, jaw);
    g.add(new THREE.CylinderGeometry(0.8, 0.9, 1.6, 10).rotateX(Math.PI / 2).translate(-eyeX, eyeY, ez + 0.75), 'head', 'plate', PLATE);
    g.add(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 10).rotateX(Math.PI / 2).translate(-eyeX, eyeY, ez + 1.6), 'head', 'light', L);
    g.add(box(0.4, 0.4, 3.4, -3.6, 43.5, 1.6), 'head', 'plate', PLATE);
  }
  // Proportions: the head (face, hair, earpiece) a touch smaller round the neck joint, ≈ 5.7 heads tall.
  for (const sb of [b, g]) scaleHead(sb, J.head[2], HEAD_SCALE);
  return assembleHuman({ look, gear, J, b, g, nationColor, emblemMat, emblemAt: [0, unitY - J.chest[2], unitZ - 1.5], emblemSize: 3.9, stripColor: stripTone });
}

/** Which body style draws a character (v9.2 prototype: `?art=v2` for yourself, `?art=v2all` for everyone). */
export type ArtStyle = 'v1' | 'v2';
