import { describe, expect, it } from 'vitest';
import { FixedStepClock, MAX_STEPS_PER_FRAME, STEP_MS } from '../src/core/clock';
import { advanceFrame } from '../src/sim/game';
import { newGame } from './helpers';

describe('FixedStepClock', () => {
  it('turns frame time into whole fixed steps and keeps the remainder', () => {
    const c = new FixedStepClock();
    expect(c.consume(STEP_MS * 0.6)).toBe(0);
    expect(c.consume(STEP_MS * 0.6)).toBe(1);
    expect(c.alpha).toBeCloseTo(0.2, 5);
  });

  it('caps catch-up after a long stall (v6 clamped a frame to 50ms)', () => {
    const c = new FixedStepClock();
    expect(c.consume(5000)).toBe(MAX_STEPS_PER_FRAME);
    expect(c.alpha).toBe(0);
  });
});

describe('game time', () => {
  it('advances only by simulated steps', () => {
    const state = newGame();
    const clock = new FixedStepClock();
    let steps = 0;
    for (let i = 0; i < 120; i++) steps += advanceFrame(state, clock, 1000 / 144);
    expect(state.time).toBeCloseTo(steps * STEP_MS, 6);
    expect(state.time).toBeGreaterThan(800);
  });

  it('a hidden tab (one huge frame) does not fast-forward game timers', () => {
    const state = newGame();
    const clock = new FixedStepClock();
    advanceFrame(state, clock, 60_000);
    expect(state.time).toBeCloseTo(MAX_STEPS_PER_FRAME * STEP_MS, 6);
  });
});
