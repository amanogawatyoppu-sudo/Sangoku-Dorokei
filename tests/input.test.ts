import { describe, expect, it } from 'vitest';
import { axesFrom, joystickVector } from '../src/input/inputManager';
import { CameraController } from '../src/render/cameraController';

const none = { x: 0, y: 0 };

describe('keyboard axes (WASD / arrows)', () => {
  it.each([
    ['w', 1, 0], ['s', -1, 0], ['d', 0, 1], ['a', 0, -1],
    ['arrowup', 1, 0], ['arrowdown', -1, 0], ['arrowright', 0, 1], ['arrowleft', 0, -1],
  ])('%s → forward %d, right %d', (key, forward, right) => {
    expect(axesFrom({ [key]: true }, none)).toEqual({ forward, right });
  });

  it('opposite keys cancel and diagonals combine', () => {
    expect(axesFrom({ w: true, s: true }, none)).toEqual({ forward: 0, right: 0 });
    expect(axesFrom({ w: true, d: true }, none)).toEqual({ forward: 1, right: 1 });
  });

  it('joystick up is forward, joystick right is right', () => {
    expect(axesFrom({}, { x: 0, y: -1 })).toEqual({ forward: 1, right: 0 });
    expect(axesFrom({}, { x: 1, y: 0 })).toEqual({ forward: 0, right: 1 });
  });
});

describe('joystickVector', () => {
  it('scales inside the ring and clamps outside it', () => {
    expect(joystickVector(20, 0)).toEqual({ x: 0.5, y: 0, px: 20, py: 0 });
    const v = joystickVector(0, -400);
    expect(v.y).toBeCloseTo(-1, 9);
    expect(v.py).toBeCloseTo(-40, 9);
  });
});

describe('camera-relative movement vectors', () => {
  it('A and D are opposite and perpendicular to W for any yaw', () => {
    const cam = new CameraController();
    for (const yaw of [0, 0.7, Math.PI, -2]) {
      cam.yaw = yaw;
      const w = cam.toWorld(1, 0), d = cam.toWorld(0, 1), a = cam.toWorld(0, -1);
      expect(w.mx * d.mx + w.mz * d.mz).toBeCloseTo(0, 9);
      expect(d.mx + a.mx).toBeCloseTo(0, 9);
      expect(d.mz + a.mz).toBeCloseTo(0, 9);
      // Seen from above (+y), D is a quarter turn clockwise from W.
      expect(w.mz * d.mx - w.mx * d.mz).toBeCloseTo(-1, 9);
    }
  });

  it('forward() matches the W direction', () => {
    const cam = new CameraController();
    cam.yaw = 1.2;
    const f = cam.forward(), w = cam.toWorld(1, 0);
    expect(f.x).toBeCloseTo(w.mx, 9);
    expect(f.z).toBeCloseTo(w.mz, 9);
  });
});
