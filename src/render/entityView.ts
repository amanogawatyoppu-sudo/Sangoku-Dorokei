import * as THREE from 'three';
import { NATIONS } from '../config/nations';
import { SNIPE } from '../config/map';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { dist } from '../sim/systems/collision';
import { effNation, visibleTo } from '../sim/systems/vision';

interface CharMesh {
  group: THREE.Group;
  body: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
}

function makeChar(color: number): CharMesh {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 34, 10), bodyMat);
  body.position.y = 17 + 6;
  g.add(body);
  const headMat = new THREE.MeshStandardMaterial({ color });
  const head = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 10), headMat);
  head.position.y = 17 + 34;
  g.add(head);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(4, 10, 6), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 17 + 34, 9);
  g.add(nose);
  return { group: g, body: bodyMat, head: headMat };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Owns one mesh per entity and mirrors simulation state onto them each frame. */
export class EntityView {
  private meshes = new Map<number, CharMesh>();

  constructor(scene: THREE.Scene, state: GameState) {
    for (const e of state.entities) {
      const m = makeChar(NATIONS[e.nation].color);
      scene.add(m.group);
      this.meshes.set(e.id, m);
    }
  }

  sync(state: GameState, alpha: number): void {
    const p = state.player;
    for (const e of state.entities) {
      const m = this.meshes.get(e.id)!;
      if (!e.alive) { m.group.visible = false; continue; }
      const vis = e === p || visibleTo(state, e, p);
      m.group.visible = vis;
      if (!vis) continue;
      m.group.position.set(lerp(e.prevX, e.x, alpha), heightOf(e), lerp(e.prevZ, e.z, alpha));
      m.group.rotation.y = Math.atan2(e.dirX, e.dirZ);
      const color = NATIONS[effNation(state, e, p.nation)].color;
      m.body.color.setHex(color);
      m.head.color.setHex(color);
      m.body.opacity = e.jailed ? 0.5 : 1;
      if (m.body.transparent !== e.jailed) {
        m.body.transparent = e.jailed;
        m.body.needsUpdate = true;
      }
    }
  }
}

/** Snipers standing on high ground are drawn raised (v6: cosmetic only). */
function heightOf(e: Entity): number {
  let y = 0;
  for (const z of SNIPE) if (e.role === 'sniper' && dist(e, z) < z.r) y = 24;
  return y;
}
