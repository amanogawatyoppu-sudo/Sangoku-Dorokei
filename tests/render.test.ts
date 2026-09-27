import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraController, DIST_MAX, DIST_MIN, firstWallHit } from '../src/render/cameraController';
import { BASE_FOV, MAX_PIXEL_RATIO, fovForAspect, renderPixelRatio } from '../src/render/sceneBuilder';
import { FRONT_HALF_ANGLE } from '../src/render/indicators';

describe('pixel ratio', () => {
  it('follows devicePixelRatio but is capped at 2', () => {
    expect(renderPixelRatio(1)).toBe(1);
    expect(renderPixelRatio(1.5)).toBe(1.5);
    expect(renderPixelRatio(3)).toBe(MAX_PIXEL_RATIO);
    expect(renderPixelRatio(0)).toBe(1);
  });
});

describe('field of view on resize', () => {
  it('keeps the v6 FOV on landscape screens', () => {
    expect(fovForAspect(16 / 9)).toBe(BASE_FOV);
    expect(fovForAspect(1366 / 704)).toBe(BASE_FOV);
  });

  it('widens on portrait phones without exceeding 90°', () => {
    const f = fovForAspect(390 / 844);
    expect(f).toBeGreaterThan(BASE_FOV);
    expect(f).toBeLessThanOrEqual(90);
  });
});

describe('camera wall occlusion (3D)', () => {
  it('detects a wall along a low ray', () => {
    // Obstacle at x=0,z=220 (120x120, h=45): shoot a ray at y=20 from the south.
    const ray = new THREE.Ray(new THREE.Vector3(0, 20, 400), new THREE.Vector3(0, 0, -1));
    expect(firstWallHit(ray, 1000)).toBeCloseTo(400 - 280, 6);
    expect(firstWallHit(ray, 100)).toBe(Infinity);
  });

  it('does not pull the camera in when it is above a low wall (v6 did)', () => {
    const ctl = new CameraController();
    const cam = new THREE.PerspectiveCamera();
    // Player just south of the 45-high block at z=160..280; camera looks north, so it sits over the block.
    ctl.yaw = 0;
    const px = 0, pz = 300;
    ctl.update(cam, px, pz);
    const boom = cam.position.distanceTo(new THREE.Vector3(px, 60, pz));
    const idealY = 110 + Math.sin(ctl.pitch) * ctl.distance * 0.8;
    const ideal = Math.hypot(Math.cos(ctl.pitch) * ctl.distance, idealY - 60);
    expect(cam.position.z).toBeLessThan(280); // really is over the block
    expect(boom).toBeCloseTo(ideal, 6);
  });

  it('zoom stays within limits', () => {
    const ctl = new CameraController();
    ctl.applyZoom(100);
    expect(ctl.distance).toBe(DIST_MAX);
    ctl.applyZoom(-100);
    expect(ctl.distance).toBe(DIST_MIN);
  });
});

describe('front-arc indicator', () => {
  it('matches the capture rule threshold (dot >= 0.15 is front)', () => {
    expect(Math.cos(FRONT_HALF_ANGLE)).toBeCloseTo(0.15, 9);
  });
});
