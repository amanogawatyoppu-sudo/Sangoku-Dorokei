import type * as THREE from 'three';
import { anyHit } from '../sim/systems/collision';

const YAW_SENS = 0.006;
const PITCH_SENS = 0.004;
const PITCH_MIN = 0.15;
const PITCH_MAX = 0.9;

/** Third-person orbit camera around the player (v6 behaviour). */
export class CameraController {
  yaw = Math.PI;
  pitch = 0.45;
  distance = 170;

  applyLook(dx: number, dy: number): void {
    this.yaw -= dx * YAW_SENS;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch - dy * PITCH_SENS));
  }

  /** Converts camera-relative axes (forward = W, right = D) into a world-space XZ vector. */
  toWorld(forward: number, right: number): { mx: number; mz: number } {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // v6 strafe vector; points to screen-left (see fix commit).
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return { mx: fx * forward + rx * right, mz: fz * forward + rz * right };
  }

  update(camera: THREE.PerspectiveCamera, px: number, pz: number): void {
    const dx = Math.sin(this.yaw) * Math.cos(this.pitch), dz = Math.cos(this.yaw) * Math.cos(this.pitch), dy = Math.sin(this.pitch);
    let d = this.distance;
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      if (anyHit(px - dx * d * t, pz - dz * d * t, 10)) { d = this.distance * t * 0.85; break; }
    }
    camera.position.set(px - dx * d, 40 + dy * d * 0.8 + 70, pz - dz * d);
    camera.lookAt(px, 60, pz);
  }
}
