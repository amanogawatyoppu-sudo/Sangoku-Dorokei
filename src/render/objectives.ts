import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NATIONS, NATION_IDS } from '../config/nations';
import { emblemTexture } from './textures';
import { NIGHT_GLOW } from './nightGlow';

/**
 * Objectives in the TRI//TRACE look (v9.0, visual only — the areas the simulation uses
 * are unchanged): LOCK POINTs are low stretched-hex platforms with glowing rims, corner
 * pylons, the faction mark on the floor and a soft column of light; faction bases are a
 * hex ring with holo pylons and a command terminal.
 */

/** A vertical fade (bright at the bottom) for light columns. */
export function fadeColumnTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 128, 0, 0);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

/** A flat hexagon prism (6-sided cylinder, a vertex pointing along ±X), scaled to rx × h × rz. */
const hex = (rx: number, h: number, rz: number, y: number) => new THREE.CylinderGeometry(1, 1, 1, 6).rotateY(Math.PI / 2).scale(rx, h, rz).translate(0, y, 0);

const GUNMETAL = 0x2b3038, DECK = 0x3a404a;

/** LOCK POINTs: one per faction, where the people it TRACEs are held. */
export function buildLockPoints(scene: THREE.Scene): void {
  const fade = fadeColumnTexture();
  const slab = new THREE.MeshStandardMaterial({ color: GUNMETAL, roughness: 0.7, metalness: 0.3 });
  const deck = new THREE.MeshStandardMaterial({ color: DECK, roughness: 0.55, metalness: 0.2 });
  const pylonGeo = new THREE.BoxGeometry(7, 34, 7).translate(0, 17, 0);
  for (const n of NATION_IDS) {
    const { jail: j, color, emblem } = NATIONS[n];
    const g = new THREE.Group();
    g.position.set(j.x, 0, j.z);
    const rx = j.w / 2 + 18, rz = j.d / 2 + 26;
    // Merged per material: a handful of draw calls per LOCK POINT.
    const solid: THREE.BufferGeometry[] = [hex(rx, 2.6, rz, 1.3)];
    const glow: THREE.BufferGeometry[] = [hex(rx + 5, 1.6, rz + 5, 0.8)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * (rx - 4), pz = Math.sin(a) * (rz - 4);
      solid.push(pylonGeo.clone().translate(px, 2.6, pz));
      glow.push(new THREE.BoxGeometry(2, 24, 7.6).translate(px, 20.6, pz));
    }
    const base = new THREE.Mesh(mergeGeometries(solid.map((g) => g.toNonIndexed()))!, slab);
    base.castShadow = base.receiveShadow = true;
    const rim = new THREE.Mesh(mergeGeometries(glow.map((g) => g.toNonIndexed()))!, new THREE.MeshBasicMaterial({ color }));
    const inner = new THREE.Mesh(hex(rx - 14, 0.6, rz - 10, 2.9), deck);
    inner.receiveShadow = true;
    // Inlaid light line round the deck and the faction mark in the middle.
    const line = new THREE.Mesh(hex(rx - 9, 0.4, rz - 6, 2.75), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(40, 60).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: emblemTexture(emblem, color), transparent: true, opacity: 0.9 }));
    mark.position.y = 3.4;
    g.add(rim, base, line, inner, mark);
    // A soft column of light (seen from across the district).
    const col = new THREE.Mesh(new THREE.CylinderGeometry(rx * 0.55, rx * 0.7, 700, 6, 1, true).rotateY(Math.PI / 2).scale(1, 1, rz / rx).translate(0, 350, 0),
      new THREE.MeshBasicMaterial({ map: fade, color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    col.renderOrder = 2;
    g.add(col);
    NIGHT_GLOW.push({ set: (k) => { (col.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.14 * k; } });
    scene.add(g);
  }
}

/** Faction bases: a hex ring on the ground, four holo pylons with the faction mark, and a command terminal. */
export function buildBases(scene: THREE.Scene): void {
  const post = new THREE.MeshStandardMaterial({ color: GUNMETAL, roughness: 0.6, metalness: 0.4 });
  for (const n of NATION_IDS) {
    const { base: b, color, emblem } = NATIONS[n];
    const ringGeo = new THREE.RingGeometry(62, 72, 6, 1).rotateZ(Math.PI / 6);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.x, 0.5, b.z);
    scene.add(ring);
    const tex = emblemTexture(emblem, color);
    const panelMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
    // Four holo pylons and the command terminal, merged per material.
    const posts: THREE.BufferGeometry[] = [], panels: THREE.BufferGeometry[] = [], caps: THREE.BufferGeometry[] = [];
    const place = (g: THREE.BufferGeometry, x: number, z: number) => {
      const yaw = Math.atan2(b.x - x, b.z - z);
      return g.rotateY(yaw).translate(x, 0, z).toNonIndexed();
    };
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const x = b.x + Math.cos(a) * 84, z = b.z + Math.sin(a) * 84;
      posts.push(place(new THREE.BoxGeometry(4, 70, 4).translate(0, 35, 0), x, z));
      panels.push(place(new THREE.PlaneGeometry(18, 27).translate(0, 52, 2.4), x, z));
      caps.push(place(new THREE.BoxGeometry(6, 2, 6).translate(0, 71, 0), x, z));
    }
    // Command terminal (where the faction's meetings are called), its screen lit in the faction colour.
    const tx = b.x + 40, tz = b.z + 40;
    posts.push(place(new THREE.BoxGeometry(14, 22, 8).translate(0, 11, 0), tx, tz));
    caps.push(place(new THREE.PlaneGeometry(11, 8).rotateX(-0.25).translate(0, 18, 4.1), tx, tz));
    const postMesh = new THREE.Mesh(mergeGeometries(posts)!, post);
    postMesh.castShadow = true;
    scene.add(postMesh, new THREE.Mesh(mergeGeometries(panels)!, panelMat), new THREE.Mesh(mergeGeometries(caps)!, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25), side: THREE.DoubleSide })));
  }
}
