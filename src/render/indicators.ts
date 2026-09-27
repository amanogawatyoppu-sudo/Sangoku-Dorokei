import * as THREE from 'three';
import type { GameState } from '../sim/state';
import type { CaptureTier } from '../sim/systems/capture';
import { captureCandidate, captureTier } from '../sim/systems/capture';
import { visibleTo } from '../sim/systems/vision';
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
  }

  sync(state: GameState, alpha: number): void {
    const p = state.player;
    const active = p.alive && !p.jailed;
    this.front.visible = active;
    if (active) {
      this.front.position.set(lerp(p.prevX, p.x, alpha), 0, lerp(p.prevZ, p.z, alpha));
      this.front.rotation.y = Math.atan2(p.dirX, p.dirZ);
    }
    const t = active && !state.meeting && p.stunUntil <= state.time ? captureCandidate(state, p) : null;
    this.target.visible = !!t && visibleTo(state, t, p);
    if (t && this.target.visible) {
      this.target.position.set(lerp(t.prevX, t.x, alpha), 0.8, lerp(t.prevZ, t.z, alpha));
      this.target.material.color.setHex(TIER_COLOR[captureTier(t, p)]);
      this.target.material.opacity = p.cd.capture > 0 ? 0.35 : 0.85;
    }
  }
}
