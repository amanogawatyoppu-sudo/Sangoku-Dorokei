import * as THREE from 'three';
import { NATIONS } from '../config/nations';
import type { GameState } from '../sim/state';
import { effNation, visibleTo } from '../sim/systems/vision';
import { heightAt } from './terrain';

interface CharMesh {
  group: THREE.Group;
  /** Nation-coloured cloth: tunic, helmet crest band and back banner. */
  cloth: THREE.MeshStandardMaterial;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  torso: THREE.Object3D;
  phase: number;
}

const SKIN = 0xe3bf95;
const ARMOR = 0x8a8f99;
const LEATHER = 0x5a4130;
const GOLD = 0xd8b25a;

const shared = {
  skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 }),
  armor: new THREE.MeshStandardMaterial({ color: ARMOR, roughness: 0.5, metalness: 0.15 }),
  leather: new THREE.MeshStandardMaterial({ color: LEATHER, roughness: 0.9 }),
  gold: new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.7 }),
  eye: new THREE.MeshBasicMaterial({ color: 0x151515 }),
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Limb pivoting at its top so it can swing. */
function limb(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, len: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(mesh(geo, mat, 0, -len / 2, 0));
  return pivot;
}

/**
 * Same silhouette for every role (roles are hidden information); only the
 * kingdom colour differs. Local +Z is the facing: the face and helmet crest
 * look forward, the banner on the back marks the side you capture from.
 */
function makeChar(color: number): CharMesh {
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const legL = limb(new THREE.CapsuleGeometry(4, 14, 4, 8), shared.leather, -5, 22, 18);
  const legR = limb(new THREE.CapsuleGeometry(4, 14, 4, 8), shared.leather, 5, 22, 18);
  const torso = new THREE.Group();
  torso.position.y = 22;
  // Tunic skirt + armoured chest.
  torso.add(mesh(new THREE.CylinderGeometry(10, 12.5, 12, 12), cloth, 0, 4, 0));
  torso.add(mesh(new THREE.CylinderGeometry(9.5, 10, 16, 12), cloth, 0, 17, 0)); // coat in kingdom colour
  torso.add(mesh(new THREE.BoxGeometry(22, 4, 10), shared.armor, 0, 25, 0)); // shoulders
  const belt = mesh(new THREE.TorusGeometry(10.2, 1.2, 6, 16), shared.gold, 0, 10, 0);
  belt.rotation.x = Math.PI / 2;
  torso.add(belt);
  // Head, face and helmet.
  torso.add(mesh(new THREE.SphereGeometry(7.5, 14, 12), shared.skin, 0, 33, 0));
  torso.add(mesh(new THREE.BoxGeometry(1.6, 1.6, 1), shared.eye, -2.6, 34, 7));
  torso.add(mesh(new THREE.BoxGeometry(1.6, 1.6, 1), shared.eye, 2.6, 34, 7));
  const helmet = mesh(new THREE.SphereGeometry(8.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), shared.armor, 0, 34.5, -0.5);
  torso.add(helmet);
  torso.add(mesh(new THREE.CylinderGeometry(8.6, 8.6, 2, 14), cloth, 0, 35, -0.5)); // helmet band
  const crest = mesh(new THREE.ConeGeometry(2.2, 9, 4), shared.gold, 0, 43, 3);
  crest.rotation.x = 0.5;
  torso.add(crest);
  // Back banner (sashimono): pole + cloth behind the shoulders.
  torso.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 34, 5), shared.leather, 0, 38, -9));
  const flag = mesh(new THREE.PlaneGeometry(11, 17), cloth, 0, 46, -9.2);
  torso.add(flag);
  const armL = limb(new THREE.CapsuleGeometry(3, 12, 4, 8), shared.armor, -12.5, 24, 16);
  const armR = limb(new THREE.CapsuleGeometry(3, 12, 4, 8), shared.armor, 12.5, 24, 16);
  torso.add(armL, armR);
  g.add(legL, legR, torso);
  return { group: g, cloth, legL, legR, armL, armR, torso, phase: 0 };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Owns one model per entity and mirrors simulation state onto them each frame. */
export class EntityView {
  private meshes = new Map<number, CharMesh>();

  constructor(scene: THREE.Scene, state: GameState) {
    for (const e of state.entities) {
      const m = makeChar(NATIONS[e.nation].color);
      scene.add(m.group);
      this.meshes.set(e.id, m);
    }
  }

  sync(state: GameState, alpha: number, dtSec = 1 / 60): void {
    const p = state.player;
    for (const e of state.entities) {
      const m = this.meshes.get(e.id)!;
      if (!e.alive) { m.group.visible = false; continue; }
      const vis = e === p || visibleTo(state, e, p);
      m.group.visible = vis;
      if (!vis) continue;
      const x = lerp(e.prevX, e.x, alpha), z = lerp(e.prevZ, e.z, alpha);
      m.group.position.set(x, heightAt(x, z), z);
      m.group.rotation.y = Math.atan2(e.dirX, e.dirZ);
      m.cloth.color.setHex(NATIONS[effNation(state, e, p.nation)].color);
      const ghost = e.jailed;
      if (m.cloth.transparent !== ghost) {
        m.cloth.transparent = ghost;
        m.cloth.needsUpdate = true;
      }
      m.cloth.opacity = ghost ? 0.5 : 1;
      this.animate(m, Math.hypot(e.x - e.prevX, e.z - e.prevZ) / (1 / 60), dtSec, state.time < e.stunUntil);
    }
  }

  /** Walk cycle driven by actual speed (units/s); stunned characters slump. */
  private animate(m: CharMesh, speed: number, dt: number, stunned: boolean): void {
    const moving = speed > 20;
    m.phase += moving ? dt * (6 + speed / 60) : 0;
    const amp = moving ? Math.min(0.55, 0.2 + speed / 900) : 0;
    const s = Math.sin(m.phase) * amp;
    m.legL.rotation.x = s;
    m.legR.rotation.x = -s;
    m.armL.rotation.x = -s * 0.8;
    m.armR.rotation.x = s * 0.8;
    m.torso.position.y = 22 + (moving ? Math.abs(Math.cos(m.phase)) * 1.6 : 0);
    m.torso.rotation.x = stunned ? 0.3 : moving ? 0.05 : 0;
  }
}
