import { BOUNDS } from '../config/map';
import type { CameraController } from './cameraController';

/** Ghost speeds (units/s): normal and with Shift. */
const SPEED = 520, FAST = 1500, CLIMB = 420, TURN = 2.2;

/**
 * Spectating after being executed (観戦・幽霊): the view floats free through the
 * city and walls. ↑↓ fly forward and back (where the view points), ←→ turn, Shift faster,
 * Space up, Z down; dragging tilts the view. Everyone is shown. Purely a view: it never touches the match.
 */
export class Ghost {
  x = 0;
  y = 0;
  z = 0;
  active = false;

  /** Rise from where the character fell. */
  start(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y + 160;
    this.z = z;
    this.active = true;
  }

  step(cam: CameraController, move: { forward: number; turn: number }, fast: boolean, up: boolean, down: boolean, dt: number): void {
    cam.yaw -= move.turn * TURN * dt;
    // Fly where the view points (tilt it by dragging): on a phone, the stick alone goes anywhere.
    const v = (fast ? FAST : SPEED) * dt * Math.max(-1, Math.min(1, move.forward));
    const pitch = cam.pitch - 0.2;
    this.x += Math.sin(cam.yaw) * Math.cos(pitch) * v;
    this.z += Math.cos(cam.yaw) * Math.cos(pitch) * v;
    this.y -= Math.sin(pitch) * v;
    this.y += ((up ? 1 : 0) - (down ? 1 : 0)) * CLIMB * (fast ? 2 : 1) * dt;
    this.x = Math.max(BOUNDS.minX - 1500, Math.min(BOUNDS.maxX + 1500, this.x));
    this.z = Math.max(BOUNDS.minZ - 1500, Math.min(BOUNDS.maxZ + 1500, this.z));
    this.y = Math.max(20, Math.min(4000, this.y));
  }
}
