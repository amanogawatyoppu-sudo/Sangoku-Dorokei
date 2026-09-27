import * as THREE from 'three';
import { WORLD } from '../config/map';

const PITCH_SENS = 0.004;
const PITCH_MIN = 0.12;
const PITCH_MAX = 0.95;
export const DIST_MIN = 110;
export const DIST_MAX = 300;
const ZOOM_STEP = 15;
/** Height above the feet the camera looks at. */
export const LOOK_HEIGHT = 55;
/** Keep the camera this far in front of any wall or floor it would otherwise sit in. */
const WALL_MARGIN = 8;
const MIN_BOOM = 26;
/** How fast the camera eases back out after a wall stops blocking it (1/s). */
const RECOVER_RATE = 5;
/** Yaw follow rate (1/s): ~90 % of a turn is caught up in ~0.25 s. */
export const FOLLOW_RATE = 9;
/** Height follow rate (1/s), so stairs and drops don't jolt the view. */
const HEIGHT_RATE = 10;

/** Every solid in the world as a 3D box (ramps approximated by their mid height). */
const SOLIDS = WORLD.filter((p) => p.mat !== 'water').map((p) => {
  const top = p.kind === 'box' ? p.y1 : (p.hLow + p.hHigh) / 2;
  return new THREE.Box3(new THREE.Vector3(p.x - p.w / 2, p.y0, p.z - p.d / 2), new THREE.Vector3(p.x + p.w / 2, top, p.z + p.d / 2));
});

const tmpRay = new THREE.Ray();
const tmpHit = new THREE.Vector3();

/** Distance along `ray` to the first solid (wall, floor, hill, stairs), or Infinity. */
export function firstWallHit(ray: THREE.Ray, maxDist: number): number {
  let best = Infinity;
  for (const b of SOLIDS) {
    if (b.containsPoint(ray.origin)) continue;
    if (ray.intersectBox(b, tmpHit)) {
      const d = tmpHit.distanceTo(ray.origin);
      if (d < best && d <= maxDist) best = d;
    }
  }
  return best;
}

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Third-person camera that always settles behind the character. Its yaw eases
 * toward the character's facing, so the view shows what the character faces
 * and the back stays a blind spot, which is the point of a backstab game.
 * Players can tilt (pitch) and zoom, but not spin it freely.
 */
export class CameraController {
  yaw = Math.PI;
  pitch = 0.42;
  distance = 190;
  private boom = -1;
  private eyeY: number | null = null;
  private highTilt = 0;
  private effPitch: number | null = null;

  /** Vertical drag tilts the view. Horizontal drag is ignored on purpose (no free look). */
  applyLook(_dx: number, dy: number): void {
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch - dy * PITCH_SENS));
  }

  applyZoom(steps: number): void {
    this.distance = Math.max(DIST_MIN, Math.min(DIST_MAX, this.distance + steps * ZOOM_STEP));
  }

  /** Eases the yaw toward the character's facing angle (atan2(dirX, dirZ)). */
  follow(facingYaw: number, dtSec: number): void {
    this.yaw += angleDelta(this.yaw, facingYaw) * (1 - Math.exp(-FOLLOW_RATE * dtSec));
  }

  /** Snap directly behind (at spawn). */
  snap(facingYaw: number): void {
    this.yaw = facingYaw;
  }

  forward(): { x: number; z: number } {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }

  update(camera: THREE.PerspectiveCamera, px: number, py: number, pz: number, dtSec = 1 / 60): void {
    const k = 1 - Math.exp(-HEIGHT_RATE * dtSec);
    this.eyeY = this.eyeY === null ? py : this.eyeY + (py - this.eyeY) * k;
    // Look down a little more from high ground.
    this.highTilt += ((this.eyeY > 30 ? 0.12 : 0) - this.highTilt) * k;
    const wanted = Math.min(PITCH_MAX, this.pitch + this.highTilt);
    const target = new THREE.Vector3(px, this.eyeY + LOOK_HEIGHT, pz);
    // Under a low ceiling (ground floor of a hall, under a skyway) a steep boom hits
    // the floor above: try flatter angles and keep the one with the most room.
    let best = { pitch: wanted, room: -1, ideal: 0 };
    for (const pitch of [wanted, wanted * 0.5, 0.04]) {
      const { dir, ideal } = this.boomDir(pitch);
      tmpRay.set(target, dir);
      const room = Math.min(ideal, firstWallHit(tmpRay, ideal + WALL_MARGIN) - WALL_MARGIN);
      if (room > best.room + 1) best = { pitch, room, ideal };
      if (room >= ideal * 0.7) break;
    }
    if (this.effPitch === null || best.pitch < this.effPitch) this.effPitch = best.pitch;
    else this.effPitch += (best.pitch - this.effPitch) * Math.min(1, dtSec * RECOVER_RATE);
    const { dir, ideal } = this.boomDir(this.effPitch);
    tmpRay.set(target, dir);
    const hit = firstWallHit(tmpRay, ideal + WALL_MARGIN);
    // Never past an obstruction; keep a small minimum only when there is room for it.
    const allowed = Math.min(ideal, Math.max(Math.min(MIN_BOOM, hit - 3), hit - WALL_MARGIN));
    if (this.boom < 0 || allowed < this.boom) this.boom = allowed; // pull in at once
    else this.boom += (allowed - this.boom) * Math.min(1, dtSec * RECOVER_RATE); // ease back out
    camera.position.copy(target).addScaledVector(dir, Math.max(0, this.boom));
    camera.lookAt(target.x + Math.sin(this.yaw) * 20, target.y, target.z + Math.cos(this.yaw) * 20);
  }

  private boomDir(pitch: number): { dir: THREE.Vector3; ideal: number } {
    const cp = Math.cos(pitch), sp = Math.sin(pitch), d = this.distance;
    const offset = new THREE.Vector3(-Math.sin(this.yaw) * cp * d, sp * d * 0.75 + 30 * Math.min(1, pitch / 0.2), -Math.cos(this.yaw) * cp * d);
    const ideal = offset.length();
    return { dir: offset.normalize(), ideal };
  }
}
