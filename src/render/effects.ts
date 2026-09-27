import * as THREE from 'three';
import type { GameState } from '../sim/state';
import { sniperTarget } from '../sim/systems/abilities';
import { visibleTo } from '../sim/systems/vision';
import { CHEST_H } from '../sim/systems/world';
import type { EntityView } from './entityView';

const MAX_LASERS = 16;

/** A thin glowing beam (unit length along +Z, scaled to fit) between two points. */
function beam(color: number, width: number, opacity: number): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(width, width, 1).translate(0, 0, 0.5),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false }),
  );
  m.visible = false;
  m.frustumCulled = false;
  return m;
}

function span(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  m.position.copy(a);
  m.lookAt(b);
  m.scale.set(1, 1, a.distanceTo(b));
}

/**
 * Sniper effects: the red laser sight of anyone drawing a bead (your own when a
 * shot would land; enemies' as a warning), and for each shot a muzzle flash, a
 * tracer and a spark where it hits.
 */
export class Effects {
  private lasers: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  private shots: { tracer: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>; flash: THREE.Mesh; spark: THREE.Mesh; t: number }[] = [];
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private view: EntityView) {
    for (let i = 0; i < MAX_LASERS; i++) {
      const l = beam(0xff2a2a, 0.45, 0.55);
      scene.add(l);
      this.lasers.push(l);
    }
  }

  /** A sniper fired at `targetId` (the shot always hits: it needs a clear line). */
  shot(state: GameState, shooterId: number, targetId: number): void {
    const s = state.entities[shooterId], t = state.entities[targetId];
    if (!this.view.shown(shooterId) && !this.view.shown(targetId)) return;
    const from = this.view.muzzle(shooterId, new THREE.Vector3()) ?? new THREE.Vector3(s.x, s.y + 40, s.z);
    const to = new THREE.Vector3(t.x, t.y + CHEST_H + 4, t.z);
    const tracer = beam(0xfff2c0, 0.7, 0.95);
    span(tracer, from, to);
    tracer.visible = true;
    const flash = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 1, depthWrite: false }));
    flash.position.copy(from);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    spark.position.copy(to);
    this.scene.add(tracer, flash, spark);
    this.shots.push({ tracer, flash, spark, t: 0 });
  }

  sync(state: GameState, dt: number): void {
    const p = state.player;
    // Laser sights.
    let n = 0;
    for (const e of state.entities) {
      if (e.role !== 'sniper' || !e.alive || e.jailed || e.stunUntil > state.time || n >= MAX_LASERS) continue;
      if (!this.view.shown(e.id)) continue;
      const target = e.isPlayer ? (e.cd.special <= 0.5 ? sniperTarget(state, e) : null) : e.ai.aimId !== null ? state.entities[e.ai.aimId] : null;
      if (!target || !target.alive || target.jailed || (!e.isPlayer && !visibleTo(state, target, p) && target !== p)) continue;
      if (!this.view.muzzle(e.id, this.a)) continue;
      this.b.set(target.x, target.y + CHEST_H + 4, target.z);
      const l = this.lasers[n++];
      span(l, this.a, this.b);
      l.visible = true;
      l.material.opacity = e.isPlayer ? 0.6 : 0.45 + 0.2 * Math.sin(state.time / 90);
    }
    for (; n < MAX_LASERS; n++) this.lasers[n].visible = false;
    // Shots fade out quickly.
    for (const s of this.shots) {
      s.t += dt;
      s.tracer.material.opacity = Math.max(0, 0.95 - s.t / 0.2);
      (s.flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - s.t / 0.08);
      (s.spark.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - s.t / 0.25);
      s.spark.scale.setScalar(1 + s.t * 6);
    }
    for (const s of this.shots.filter((x) => x.t > 0.3)) {
      this.scene.remove(s.tracer, s.flash, s.spark);
      s.tracer.geometry.dispose();
      s.tracer.material.dispose();
      s.flash.geometry.dispose();
      s.spark.geometry.dispose();
    }
    this.shots = this.shots.filter((x) => x.t <= 0.3);
  }
}
