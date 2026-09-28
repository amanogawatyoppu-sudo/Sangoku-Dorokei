import * as THREE from 'three';
import type { GameState } from '../sim/state';
import type { CaptureTier } from '../sim/systems/capture';
import { captureCandidate, captureTier, superHand } from '../sim/systems/capture';
import { visibleTo } from '../sim/systems/vision';
import { sniperTarget } from '../sim/systems/abilities';
import { lerp } from './entityView';

/** captureTier() calls anything with dot >= 0.15 'front', i.e. within ±81.4° of facing. */
export const FRONT_HALF_ANGLE = Math.acos(0.15);

const TIER_COLOR: Record<CaptureTier, number> = { deepback: 0x7dff9a, back: 0xc8f060, side: 0xffb040, front: 0xff6a5a };

/**
 * Ground markers that make the back-capture rule visible:
 * the player's front arc (enemies there cannot capture you) and a ring
 * under whoever a capture would take right now, coloured by angle.
 */
export class Indicators {
  private front = new THREE.Group();
  private target: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** Sniper lock-on: red crosshair ring under whoever the shot would hit (grey while reloading). */
  private reticle: THREE.Group;
  /** Small green rings under the player's squad members. */
  private squad: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(26, 44, 32, 1, -Math.PI / 2 - FRONT_HALF_ANGLE, FRONT_HALF_ANGLE * 2),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    // RingGeometry lies in XY; laid flat, angle -90° points along local +Z (the facing).
    arc.rotation.x = -Math.PI / 2;
    arc.position.y = 0.6;
    this.front.add(arc);
    scene.add(this.front);

    this.target = new THREE.Mesh(
      new THREE.RingGeometry(20, 25, 28),
      new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.target.rotation.x = -Math.PI / 2;
    this.target.visible = false;
    scene.add(this.target);

    this.reticle = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(27, 30, 36), mat);
    ring.rotation.x = -Math.PI / 2;
    this.reticle.add(ring);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(3, 12), mat);
      tick.rotation.x = -Math.PI / 2;
      tick.rotation.z = (i * Math.PI) / 2;
      tick.position.set(Math.sin((i * Math.PI) / 2) * 34, 0, Math.cos((i * Math.PI) / 2) * 34);
      this.reticle.add(tick);
    }
    this.reticle.visible = false;
    scene.add(this.reticle);

    const sqMat = new THREE.MeshBasicMaterial({ color: 0x7dcf9a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(15, 18, 24), sqMat);
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      scene.add(r);
      this.squad.push(r);
    }
  }

  sync(state: GameState, alpha: number): void {
    const p = state.player;
    const active = p.alive && !p.jailed;
    this.front.visible = active;
    if (active) {
      const x = lerp(p.prevX, p.x, alpha), z = lerp(p.prevZ, p.z, alpha);
      this.front.position.set(x, lerp(p.prevY, p.y, alpha), z);
      this.front.rotation.y = Math.atan2(p.dirX, p.dirZ);
    }
    const s = active && p.role === 'sniper' && !state.meeting && p.stunUntil <= state.time ? sniperTarget(state, p) : null;
    this.reticle.visible = !!s;
    if (s) {
      this.reticle.position.set(lerp(s.prevX, s.x, alpha), lerp(s.prevY, s.y, alpha) + 1, lerp(s.prevZ, s.z, alpha));
      this.reticle.rotation.y = state.time / 900;
      ((this.reticle.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(p.cd.special > 0.5 ? 0x8a8a8a : 0xff3030);
    }
    let k = 0;
    for (const e of state.entities) {
      if (k >= this.squad.length || e.ai.leaderId !== p.id || !e.alive || e.jailed) continue;
      this.squad[k].position.set(lerp(e.prevX, e.x, alpha), lerp(e.prevY, e.y, alpha) + 0.7, lerp(e.prevZ, e.z, alpha));
      this.squad[k++].visible = true;
    }
    for (; k < this.squad.length; k++) this.squad[k].visible = false;
    const t = active && !state.meeting && p.stunUntil <= state.time ? captureCandidate(state, p) : null;
    this.target.visible = !!t && visibleTo(state, t, p);
    if (t && this.target.visible) {
      const x = lerp(t.prevX, t.x, alpha), z = lerp(t.prevZ, t.z, alpha);
      this.target.position.set(x, lerp(t.prevY, t.y, alpha) + 0.8, z);
      this.target.material.color.setHex(TIER_COLOR[superHand(p) ? 'deepback' : captureTier(t, p)]);
      this.target.material.opacity = p.cd.capture > 0 ? 0.35 : 0.85;
    }
  }
}
