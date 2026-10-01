import * as THREE from 'three';
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
    const rimMat = new THREE.MeshBasicMaterial({ color });
    const rim = new THREE.Mesh(hex(rx + 5, 1.6, rz + 5, 0.8), rimMat);
    const base = new THREE.Mesh(hex(rx, 2.6, rz, 1.3), slab);
    const inner = new THREE.Mesh(hex(rx - 14, 0.6, rz - 10, 2.9), deck);
    base.receiveShadow = inner.receiveShadow = true;
    // Inlaid light line round the deck and the faction mark in the middle.
    const lineMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const line = new THREE.Mesh(hex(rx - 9, 0.4, rz - 6, 2.75), lineMat);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(40, 60).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: emblemTexture(emblem, color), transparent: true, opacity: 0.9 }));
    mark.position.y = 3.4;
    g.add(rim, base, line, inner, mark);
    // Pylons on the six corners, each with a glowing face.
    const glowMat = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * (rx - 4), pz = Math.sin(a) * (rz - 4);
      const p = new THREE.Mesh(pylonGeo, slab);
      p.position.set(px, 2.6, pz);
      p.castShadow = true;
      const s = new THREE.Mesh(new THREE.BoxGeometry(2, 24, 7.6).translate(0, 18, 0), glowMat);
      s.position.copy(p.position);
      g.add(p, s);
    }
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
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const g = new THREE.Group();
      g.position.set(b.x + Math.cos(a) * 84, 0, b.z + Math.sin(a) * 84);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(4, 70, 4).translate(0, 35, 0), post);
      pole.castShadow = true;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(18, 27), panelMat);
      panel.position.set(0, 52, 2.4);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 6), new THREE.MeshBasicMaterial({ color }));
      cap.position.y = 71;
      g.add(pole, panel, cap);
      g.lookAt(b.x, 0, b.z);
      scene.add(g);
    }
    // Command terminal (where the faction's meetings are called).
    const term = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 22, 8).translate(0, 11, 0), post);
    body.castShadow = true;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(11, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35) }));
    screen.position.set(0, 18, 4.1);
    screen.rotation.x = -0.25;
    term.add(body, screen);
    term.position.set(b.x + 40, 0, b.z + 40);
    term.lookAt(b.x, 0, b.z);
    scene.add(term);
  }
}
