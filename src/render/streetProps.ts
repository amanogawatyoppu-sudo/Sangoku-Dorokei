import * as THREE from 'three';
import type { BoxPrim } from '../config/map';
import { BUILDINGS, CURB, WORLD } from '../config/map';

/**
 * Street clutter against the shopfronts: parked bicycles, konbini bins, planters,
 * A-frame shop boards and utility boxes. Scenery only (no collision), kept tight to
 * the walls so nobody walks through them. One instanced draw call per prop type;
 * each prop is a few boxes/cylinders merged with baked vertex colours.
 */

type Part = { geo: THREE.BufferGeometry; color: number };

/** Merge coloured parts into one non-indexed geometry with a `color` attribute. */
function merge(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  const c = new THREE.Color();
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    pos.push(...(g.attributes.position.array as Float32Array));
    nrm.push(...(g.attributes.normal.array as Float32Array));
    c.setHex(color);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rx = 0): Part =>
  ({ geo: new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z), color });

/** Bicycle, 1.7 m long along z, wheels in the YZ plane. Frame is white (tinted per instance). */
function bicycle(): THREE.BufferGeometry {
  const tyre = 0x1a1a1a, metal = 0x9a9ea3, frame = 0xffffff;
  const wheel = (z: number): Part[] => [
    { geo: new THREE.TorusGeometry(8.5, 1.1, 5, 16).rotateY(Math.PI / 2).translate(0, 9.6, z), color: tyre },
    { geo: new THREE.CylinderGeometry(1.4, 1.4, 3, 6).rotateZ(Math.PI / 2).translate(0, 9.6, z), color: metal },
  ];
  const tube = (y0: number, z0: number, y1: number, z1: number, r = 0.9, color = frame): Part => {
    const len = Math.hypot(y1 - y0, z1 - z0);
    const g = new THREE.CylinderGeometry(r, r, len, 5).rotateX(Math.atan2(z1 - z0, y1 - y0)).translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
    return { geo: g, color };
  };
  return merge([
    ...wheel(-15), ...wheel(15),
    tube(9.6, -15, 22, -3), tube(22, -3, 22, 10), tube(9.6, -15, 11, -1), tube(11, -1, 22, 10),
    tube(9.6, 15, 24, 11, 0.9, metal), tube(11, -1, 25, -5),
    box(4, 1.6, 7, 0, 26, -5.5, 0x222222),
    box(15, 1.2, 1.2, 0, 25, 11, 0x222222),
    box(9, 5, 7, 0, 22, 16, 0x5a5d60), // front basket (ママチャリ)
    box(6, 0.8, 9, 0, 17, -16, metal), // rear rack
  ]);
}

/** Konbini bins: burnables, cans/bottles and PET, with coloured lids and label bands. */
function bins(): THREE.BufferGeometry {
  const body = 0xd6d4ce;
  const one = (x: number, lid: number): Part[] => [
    box(15, 30, 15, x, 15, 0, body),
    box(15.6, 3, 15.6, x, 31.5, 0, lid),
    box(10, 3, 0.4, x, 31, 7.9, 0x111111),
    box(15.2, 7, 0.4, x, 22, 7.6, lid),
  ];
  return merge([...one(-16.5, 0x2f7a3c), ...one(0, 0xc8412d), ...one(16.5, 0x2c63b8), box(52, 2, 17, 0, 1, 0, 0x6d6a64)]);
}

/** Planter: a concrete trough with a clipped shrub. */
function planter(): THREE.BufferGeometry {
  const shrub = new THREE.IcosahedronGeometry(1, 1).scale(24, 11, 9);
  const pos = shrub.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(pos.getY(i), -2) + 19); // flat underside, sits in the trough
  return merge([box(52, 14, 20, 0, 7, 0, 0x9d9a92), box(48, 2, 16, 0, 13.2, 0, 0x3b2d22), { geo: shrub, color: 0x3f6b35 }]);
}

/** A-frame shop board (立て看板): two leaning panels on a small base. Panel white, tinted per instance. */
function aframe(): THREE.BufferGeometry {
  return merge([
    box(18, 30, 1.2, 0, 15, 4, 0xffffff, -0.2),
    box(18, 30, 1.2, 0, 15, -4, 0xffffff, 0.2),
    box(14, 14, 0.2, 0, 17, 5.1, 0x2b2b2b, -0.2), // blackboard face
    box(20, 2, 3, 0, 29.5, 0, 0x3a2c20),
  ]);
}

/** Pad-mounted transformer / utility box (地上機器) on a small plinth. */
function utilityBox(): THREE.BufferGeometry {
  return merge([
    box(34, 3, 20, 0, 1.5, 0, 0x8f8c86),
    box(30, 38, 16, 0, 22, 0, 0xb9c2b4),
    box(31, 1.5, 17, 0, 41.5, 0, 0xa7b0a2),
    box(12, 30, 0.4, -7, 21, 8.1, 0xa9b2a4),
    box(12, 30, 0.4, 7, 21, 8.1, 0xa9b2a4),
    box(6, 4, 0.4, 0, 32, 8.3, 0xe8c83a), // warning label
  ]);
}

type Side = 'n' | 's' | 'e' | 'w';
const OUT: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function buildStreetProps(scene: THREE.Scene): void {
  const lists = { bike: [] as THREE.Matrix4[], bins: [] as THREE.Matrix4[], planter: [] as THREE.Matrix4[], aframe: [] as THREE.Matrix4[], util: [] as THREE.Matrix4[] };
  const cols = { bike: [] as THREE.Color[], aframe: [] as THREE.Color[] };
  const vend = WORLD.filter((p) => p.mat === 'vending') as BoxPrim[];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const BIKE = [0xd8d8d8, 0x2a2c30, 0x8c1f22, 0x2e4f8a, 0xc9b98f, 0x3e6b44, 0xe0e0e0];
  const BOARD = [0xf4efe4, 0x2f2f33, 0xc8452f, 0x3a5a3a, 0x7a5a3a];
  for (const b of BUILDINGS) {
    if (b.outside || b.h < 60) continue;
    const rnd = prng(b.seed * 7 + 3);
    const [nx, nz] = OUT[b.front];
    const len = b.front === 'n' || b.front === 's' ? b.w : b.d;
    const tx = -nz, tz = nx; // along the façade
    const fx = b.x + nx * (b.front === 'e' || b.front === 'w' ? b.w / 2 : 0), fz = b.z + nz * (b.front === 'n' || b.front === 's' ? b.d / 2 : 0);
    const faceYaw = Math.atan2(nx, nz); // local +z points away from the wall
    const used: [number, number][] = [];
    const free = (s: number, half: number) => {
      const px = fx + tx * s, pz = fz + tz * s;
      if (vend.some((v) => Math.hypot(v.x - px, v.z - pz) < 45 + half)) return false;
      return used.every(([u, h]) => Math.abs(u - s) > half + h + 4);
    };
    const put = (list: THREE.Matrix4[], s: number, depth: number, yaw: number, half: number): boolean => {
      if (Math.abs(s) > len / 2 - half - 12 || !free(s, half)) return false;
      used.push([s, half]);
      const off = depth / 2 + 2;
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(fx + tx * s + nx * off, CURB, fz + tz * s + nz * off), q.clone().setFromAxisAngle(up, yaw), one));
      return true;
    };
    const commercial = b.type === 'shop' || b.type === 'mixed';
    const r = rnd();
    if (commercial) {
      // A row of parked bikes nose to the wall, a bin set and a shop board.
      if (r < 0.55) {
        const n = 2 + Math.floor(rnd() * 4), s0 = (rnd() - 0.5) * (len - 120);
        for (let k = 0; k < n; k++) {
          const s = s0 + k * 16;
          if (put(lists.bike, s, 34, faceYaw + (rnd() - 0.5) * 0.25, 4)) cols.bike.push(new THREE.Color(BIKE[Math.floor(rnd() * BIKE.length)]));
        }
      }
      if (rnd() < 0.35) put(lists.bins, (rnd() - 0.5) * (len - 80), 17, faceYaw, 27);
      if (rnd() < 0.5) {
        const s = (rnd() - 0.5) * (len - 60);
        // Stands out on the pavement a little, facing the street.
        if (put(lists.aframe, s, 30, faceYaw + (rnd() - 0.5) * 0.4, 10)) cols.aframe.push(new THREE.Color(BOARD[Math.floor(rnd() * BOARD.length)]));
      }
    } else if (b.type === 'office' || b.type === 'tower') {
      if (r < 0.6) { put(lists.planter, -len / 4, 20, faceYaw, 26); put(lists.planter, len / 4, 20, faceYaw, 26); }
    } else {
      if (r < 0.35) put(lists.util, (rnd() - 0.5) * (len - 60), 20, faceYaw, 17);
      if (rnd() < 0.4) {
        const s = (rnd() - 0.5) * (len - 60);
        if (put(lists.bike, s, 34, faceYaw, 4)) cols.bike.push(new THREE.Color(BIKE[Math.floor(rnd() * BIKE.length)]));
      }
      if (rnd() < 0.3) put(lists.planter, (rnd() - 0.5) * (len - 70), 20, faceYaw, 26);
    }
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
  const add = (geo: THREE.BufferGeometry, ms: THREE.Matrix4[], colors?: THREE.Color[], shadow = true) => {
    if (!ms.length) return;
    const m = new THREE.InstancedMesh(geo, mat, ms.length);
    ms.forEach((x, i) => m.setMatrixAt(i, x));
    colors?.forEach((c, i) => m.setColorAt(i, c));
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
  };
  add(bicycle(), lists.bike, cols.bike, false);
  add(bins(), lists.bins);
  add(planter(), lists.planter);
  add(aframe(), lists.aframe, cols.aframe, false);
  add(utilityBox(), lists.util);
}
