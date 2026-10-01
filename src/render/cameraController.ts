import * as THREE from 'three';
import { WORLD } from '../config/map';

const PITCH_SENS = 0.004;
const PITCH_MIN = 0.12;
const PITCH_MAX = 0.95;
export const DIST_MIN = 95;
export const DIST_MAX = 300;
const ZOOM_STEP = 15;
/** Height above the feet the camera looks at. */
export const LOOK_HEIGHT = 50;
/** Keep the camera this far in front of any wall or floor it would otherwise sit in. */
const WALL_MARGIN = 8;
const MIN_BOOM = 26;
/** How fast the camera eases back out after a wall stops blocking it (1/s). */
const RECOVER_RATE = 5;
/** Yaw follow rate (1/s): ~90 % of a turn is caught up in ~0.25 s. */
export const FOLLOW_RATE = 9;
/** Height follow rate (1/s), so stairs and drops don't jolt the view. */
const HEIGHT_RATE = 10;

/** Ramps are cut into this many steps for camera collision. */
const RAMP_SLICES = 6;

/**
 * Every solid the camera must not pass through, as 3D boxes (ramps as a staircase of
 * boxes). Small street furniture (trees, poles, cars, vending machines, bollards…)
 * is left out: it would only yank the camera in and out as you walk past it; the
 * player's silhouette shows through anything that hides them instead.
 */
const SMALL = new Set(['tree', 'pole', 'car', 'vending', 'water']);
const SOLIDS = WORLD.filter((p) => !SMALL.has(p.mat) && !(p.kind === 'box' && p.w * p.d < 2500 && p.y1 < 260)).flatMap((p) => {
  if (p.kind === 'box') {
    return [new THREE.Box3(new THREE.Vector3(p.x - p.w / 2, p.y0, p.z - p.d / 2), new THREE.Vector3(p.x + p.w / 2, p.y1, p.z + p.d / 2))];
  }
  const len = p.axis === 'x' ? p.w : p.d;
  return Array.from({ length: RAMP_SLICES }, (_, i) => {
    const a = -len / 2 + (len * i) / RAMP_SLICES, b = a + len / RAMP_SLICES;
    // Height at the slice's higher edge (the ramp rises toward +axis when dir is 1).
    const u = p.dir === 1 ? (b + len / 2) / len : 1 - (a + len / 2) / len;
    const top = p.hLow + (p.hHigh - p.hLow) * u;
    const [x0, x1, z0, z1] = p.axis === 'x'
      ? [p.x + a, p.x + b, p.z - p.d / 2, p.z + p.d / 2]
      : [p.x - p.w / 2, p.x + p.w / 2, p.z + a, p.z + b];
    return new THREE.Box3(new THREE.Vector3(x0, p.y0, z0), new THREE.Vector3(x1, top, z1));
  });
});

const tmpRay = new THREE.Ray();
const UP = new THREE.Vector3(0, 1, 0);
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
  distance = 160;
  private boom = -1;
  private eyeY: number | null = null;
  private highTilt = 0;
  private effPitch: number | null = null;
  private indoor = 0;
  /** Current camera distance after collisions (the renderer fades the player when it is tiny). */
  boomLength = Infinity;

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
    // Under a low ceiling, look from just below it (and level) instead of from inside it.
    tmpRay.set(new THREE.Vector3(px, this.eyeY + 30, pz), UP);
    const ceiling = 30 + firstWallHit(tmpRay, 200);
    const lookH = Math.min(LOOK_HEIGHT, ceiling - 12);
    this.indoor += ((ceiling < 120 ? 1 : 0) - this.indoor) * k;
    const target = new THREE.Vector3(px, this.eyeY + lookH, pz);
    // Under a low ceiling (ground floor of a hall, under a skyway) a steep boom hits
    // the floor above: try flatter angles and keep the one with the most room.
    let best = { pitch: wanted, room: -1, ideal: 0 };
    for (const pitch of this.indoor > 0.5 ? [0] : [wanted, wanted * 0.5, 0]) {
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
    this.boomLength = this.boom;
    camera.lookAt(target.x + Math.sin(this.yaw) * 20, target.y, target.z + Math.cos(this.yaw) * 20);
  }

  /** Ghost view (spectating): free-floating, through walls, looking along the yaw and pitch. */
  free(camera: THREE.PerspectiveCamera, x: number, y: number, z: number): void {
    const pitch = this.pitch - 0.2;
    camera.position.set(x, y, z);
    camera.lookAt(x + Math.sin(this.yaw) * Math.cos(pitch) * 100, y - Math.sin(pitch) * 100, z + Math.cos(this.yaw) * Math.cos(pitch) * 100);
    this.boomLength = Infinity;
    this.eyeY = null;
    this.boom = -1;
  }

  private boomDir(pitch: number): { dir: THREE.Vector3; ideal: number } {
    const cp = Math.cos(pitch), sp = Math.sin(pitch), d = this.distance;
    const offset = new THREE.Vector3(-Math.sin(this.yaw) * cp * d, sp * d * 0.75 + 30 * Math.min(1, pitch / 0.2), -Math.cos(this.yaw) * cp * d);
    const ideal = offset.length();
    return { dir: offset.normalize(), ideal };
  }
}
