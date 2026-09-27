import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraController } from '../src/render/cameraController';

/** Projects a world point to normalized device coords with the real three.js camera. */
function screenX(cam: THREE.PerspectiveCamera, x: number, z: number): number {
  return new THREE.Vector3(x, 60, z).project(cam).x;
}

describe('camera-relative movement', () => {
  for (const yaw of [Math.PI, 0, 1, -2.3, 4]) {
    it(`W is away from the camera and D is screen-right (yaw=${yaw.toFixed(2)})`, () => {
      const ctl = new CameraController();
      ctl.yaw = yaw;
      const cam = new THREE.PerspectiveCamera(65, 1.5, 1, 4000);
      // Player far from obstacles so the camera is not pulled in.
      const px = 0, pz = 380;
      ctl.update(cam, px, pz);
      cam.updateMatrixWorld();

      const right = ctl.toWorld(0, 1);
      expect(screenX(cam, px + right.mx * 50, pz + right.mz * 50)).toBeGreaterThan(0.05);
      const left = ctl.toWorld(0, -1);
      expect(screenX(cam, px + left.mx * 50, pz + left.mz * 50)).toBeLessThan(-0.05);

      const fwd = ctl.toWorld(1, 0);
      const camDist = (x: number, z: number) => Math.hypot(cam.position.x - x, cam.position.z - z);
      expect(camDist(px + fwd.mx * 50, pz + fwd.mz * 50)).toBeGreaterThan(camDist(px, pz));
    });
  }
});
