import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraController, DIST_MAX, DIST_MIN, firstWallHit } from '../src/render/cameraController';
import { BASE_FOV, MAX_PIXEL_RATIO, fovForAspect, renderPixelRatio } from '../src/render/sceneBuilder';
import { FRONT_HALF_ANGLE } from '../src/render/indicators';
import { SITES } from '../src/config/map';

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
  it('detects a building along a low ray', () => {
    // 国会議事堂: its north face is 20 south of the north test point.
    const n = SITES.dietNorth;
    const ray = new THREE.Ray(new THREE.Vector3(n.x, 20, n.z), new THREE.Vector3(0, 0, 1));
    expect(firstWallHit(ray, 1000)).toBeCloseTo(20, 6);
    expect(firstWallHit(ray, 10)).toBe(Infinity);
  });

  it('detects floors from below (second storey)', () => {
    const u = SITES.walkup.underFloor;
    const ray = new THREE.Ray(new THREE.Vector3(u.x, 20, u.z), new THREE.Vector3(0, 1, 0));
    expect(firstWallHit(ray, 200)).toBeCloseTo(58 - 20, 6);
  });

  it('does not pull the camera in when it is above a low building (v6 did)', () => {
    const ctl = new CameraController();
    const cam = new THREE.PerspectiveCamera();
    // North of the Diet building, facing north: the camera sits back over its roof.
    const n = SITES.dietNorth;
    ctl.snap(Math.PI);
    ctl.update(cam, n.x, 0, n.z);
    const open = new CameraController();
    const cam2 = new THREE.PerspectiveCamera();
    open.snap(Math.PI);
    open.update(cam2, SITES.open.x, 0, SITES.open.z);
    expect(cam.position.z).toBeGreaterThan(n.z + 20); // really is over the building
    expect(cam.position.distanceTo(new THREE.Vector3(n.x, 55, n.z))).toBeCloseTo(cam2.position.distanceTo(new THREE.Vector3(SITES.open.x, 55, SITES.open.z)), 3);
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
