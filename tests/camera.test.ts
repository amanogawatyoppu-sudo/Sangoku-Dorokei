import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraController, angleDelta } from '../src/render/cameraController';
import { solidAt } from '../src/sim/systems/world';
import { SITES } from '../src/config/map';

const P = SITES.open; // 皇居前広場: open ground

function behindness(cam: THREE.PerspectiveCamera, yaw: number, px: number, pz: number): number {
  // Negative when the camera is behind the character (opposite to its facing).
  return (cam.position.x - px) * Math.sin(yaw) + (cam.position.z - pz) * Math.cos(yaw);
}

describe('rear-follow camera', () => {
  for (const yaw of [0, 1, Math.PI, -2.2]) {
    it(`settles behind the character (facing ${yaw.toFixed(1)})`, () => {
      const ctl = new CameraController();
      const cam = new THREE.PerspectiveCamera(65, 1.5, 1, 8000);
      ctl.snap(yaw);
      ctl.update(cam, P.x, 0, P.z);
      expect(behindness(cam, yaw, P.x, P.z)).toBeLessThan(-100);
    });
  }

  it('catches up with a turn smoothly within ~0.3 s, not instantly', () => {
    const ctl = new CameraController();
    ctl.snap(0);
    const target = Math.PI / 2;
    ctl.follow(target, 1 / 60);
    expect(Math.abs(angleDelta(ctl.yaw, target))).toBeGreaterThan(1.2); // not a snap
    for (let t = 1 / 60; t < 0.3; t += 1 / 60) ctl.follow(target, 1 / 60);
    expect(Math.abs(angleDelta(ctl.yaw, target))).toBeLessThan(0.15);
  });

  it('takes the short way round across ±π', () => {
    const ctl = new CameraController();
    ctl.snap(3.0);
    ctl.follow(-3.0, 0.05);
    expect(ctl.yaw).toBeGreaterThan(3.0);
  });

  it('ignores horizontal drags (no free look) but tilts with vertical drags', () => {
    const ctl = new CameraController();
    const y0 = ctl.yaw, p0 = ctl.pitch;
    ctl.applyLook(400, 0);
    expect(ctl.yaw).toBe(y0);
    ctl.applyLook(0, -50);
    expect(ctl.pitch).toBeGreaterThan(p0);
  });

  it('D (turn right) swings the character toward screen-right', () => {
    const ctl = new CameraController();
    const cam = new THREE.PerspectiveCamera(65, 1.5, 1, 8000);
    ctl.snap(0);
    ctl.update(cam, P.x, 0, P.z);
    cam.updateMatrixWorld();
    const a = 0 - 0.4; // turning right decreases the facing angle (see turnBy)
    const ndc = new THREE.Vector3(P.x + Math.sin(a) * 60, 55, P.z + Math.cos(a) * 60).project(cam);
    expect(ndc.x).toBeGreaterThan(0.02);
  });

  it('rises with the player (stairs / upper floors)', () => {
    const ctl = new CameraController();
    const cam = new THREE.PerspectiveCamera();
    ctl.snap(0);
    ctl.update(cam, P.x, 0, P.z);
    const y0 = cam.position.y;
    for (let i = 0; i < 90; i++) ctl.update(cam, P.x, 64, P.z, 1 / 60);
    expect(cam.position.y - y0).toBeGreaterThan(55);
  });

  it('never ends up inside a wall or floor (ground floor of a 2F building)', () => {
    const ctl = new CameraController();
    const cam = new THREE.PerspectiveCamera();
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      ctl.snap(yaw);
      const u = SITES.walkup.underFloor;
      for (let i = 0; i < 10; i++) ctl.update(cam, u.x, 0, u.z, 1 / 60);
      expect(solidAt(cam.position.x, cam.position.y, cam.position.z)).toBe(false);
      // Under the second floor the boom stays below the ceiling and shorter than in the open.
      expect(cam.position.y).toBeLessThan(58);
      expect(cam.position.distanceTo(new THREE.Vector3(u.x, 45, u.z))).toBeLessThan(180);
    }
  });
});
