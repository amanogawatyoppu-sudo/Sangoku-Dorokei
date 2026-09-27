import * as THREE from 'three';
import { OBST } from '../config/map';

const YAW_SENS = 0.006;
const PITCH_SENS = 0.004;
const PITCH_MIN = 0.15;
const PITCH_MAX = 0.9;
export const DIST_MIN = 110;
export const DIST_MAX = 280;
const ZOOM_STEP = 15;
/** Height of the point the camera looks at (upper body of the player). */
const LOOK_HEIGHT = 60;
/** Keep the camera this far in front of any wall it would otherwise sit in. */
const WALL_MARGIN = 8;
const MIN_BOOM = 30;
/** How fast the camera eases back out after a wall stops blocking it (1/s). */
const RECOVER_RATE = 6;

/** Obstacles as real 3D boxes, so a camera above a low wall is not pulled in. */
const WALL_BOXES = OBST.map(
  (o) => new THREE.Box3(new THREE.Vector3(o.x - o.w / 2, 0, o.z - o.d / 2), new THREE.Vector3(o.x + o.w / 2, o.h, o.z + o.d / 2)),
);

const tmpRay = new THREE.Ray();
const tmpHit = new THREE.Vector3();

/** Distance along `ray` to the first obstacle box, or Infinity. */
export function firstWallHit(ray: THREE.Ray, maxDist: number): number {
  let best = Infinity;
  for (const b of WALL_BOXES) {
    if (ray.intersectBox(b, tmpHit)) {
      const d = tmpHit.distanceTo(ray.origin);
      if (d < best && d <= maxDist) best = d;
    }
  }
  return best;
}

/** Third-person orbit camera around the player. */
export class CameraController {
  yaw = Math.PI;
  pitch = 0.45;
  distance = 170;
  /** Current boom length after wall collision and easing. */
  private boom = -1;

  applyLook(dx: number, dy: number): void {
    this.yaw -= dx * YAW_SENS;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch - dy * PITCH_SENS));
  }

  applyZoom(steps: number): void {
    this.distance = Math.max(DIST_MIN, Math.min(DIST_MAX, this.distance + steps * ZOOM_STEP));
  }

  /** Horizontal direction the camera looks along (screen-forward on the ground). */
  forward(): { x: number; z: number } {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }

  /** Converts camera-relative axes (forward = W, right = D) into a world-space XZ vector. */
  toWorld(forward: number, right: number): { mx: number; mz: number } {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // Screen-right = forward × up. (v6 used the opposite sign, so A/D were swapped.)
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    return { mx: fx * forward + rx * right, mz: fz * forward + rz * right };
  }

  /** Where the camera would sit with no walls, as an offset from the look-at point. */
  private idealOffset(): THREE.Vector3 {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), d = this.distance;
    // Same framing as v6: behind the player along -forward, raised with pitch.
    return new THREE.Vector3(-Math.sin(this.yaw) * cp * d, 110 + sp * d * 0.8 - LOOK_HEIGHT, -Math.cos(this.yaw) * cp * d);
  }

  update(camera: THREE.PerspectiveCamera, px: number, pz: number, dtSec = 1 / 60): void {
    const target = new THREE.Vector3(px, LOOK_HEIGHT, pz);
    const offset = this.idealOffset();
    const ideal = offset.length();
    const dir = offset.normalize();
    tmpRay.set(target, dir);
    const hit = firstWallHit(tmpRay, ideal + WALL_MARGIN);
    const allowed = Math.max(MIN_BOOM, Math.min(ideal, hit - WALL_MARGIN));
    if (this.boom < 0 || allowed < this.boom) this.boom = allowed; // pull in at once
    else this.boom += (allowed - this.boom) * Math.min(1, dtSec * RECOVER_RATE); // ease back out
    camera.position.copy(target).addScaledVector(dir, this.boom);
    camera.lookAt(target);
  }
}
