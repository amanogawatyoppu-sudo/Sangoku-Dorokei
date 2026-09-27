import { describe, expect, it } from 'vitest';
import { GAME_TIME } from '../src/config/constants';
import { drainEvents } from '../src/sim/state';
import { newGame, runFrames } from './helpers';

describe('full match (AI only)', () => {
  it.each([1, 2, 3, 4, 5])('seed %i plays to a result without errors', (seed) => {
    const state = newGame('star', 'communicator', seed);
    const counts: Record<string, number> = {};
    for (let t = 0; t < GAME_TIME + 5 && !state.over; t++) {
      runFrames(state, 1000);
      for (const ev of drainEvents(state)) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
    }
    expect(state.over).toBe(true);
    expect(state.winner).not.toBeNull();
    // The AI actually plays: captures and jailings happen.
    expect(counts.JAILED ?? 0).toBeGreaterThan(0);
    for (const e of state.entities) {
      expect(Number.isFinite(e.x) && Number.isFinite(e.z)).toBe(true);
    }
  });
});
