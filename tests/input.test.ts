import { describe, expect, it } from 'vitest';
import { axesFrom, joystickVector } from '../src/input/inputManager';

const none = { x: 0, y: 0 };

describe('keyboard / joystick intent (character-relative)', () => {
  it.each([
    ['w', 1, 0], ['s', -1, 0], ['d', 0, 1], ['a', 0, -1],
    ['arrowup', 1, 0], ['arrowdown', -1, 0], ['arrowright', 0, 1], ['arrowleft', 0, -1],
  ])('%s → forward %d, turn %d', (key, forward, turn) => {
    expect(axesFrom({ [key]: true }, none)).toEqual({ forward, turn });
  });

  it('opposite keys cancel and combinations mix', () => {
    expect(axesFrom({ w: true, s: true }, none)).toEqual({ forward: 0, turn: 0 });
    expect(axesFrom({ w: true, d: true }, none)).toEqual({ forward: 1, turn: 1 });
  });

  it('joystick up walks forward, sideways turns; values stay in [-1, 1]', () => {
    expect(axesFrom({}, { x: 0, y: -1 })).toEqual({ forward: 1, turn: 0 });
    expect(axesFrom({}, { x: 1, y: 0 })).toEqual({ forward: 0, turn: 1 });
    expect(axesFrom({ w: true }, { x: 0, y: -1 })).toEqual({ forward: 1, turn: 0 });
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
