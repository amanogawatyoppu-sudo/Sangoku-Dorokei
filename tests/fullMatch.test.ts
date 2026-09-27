import { describe, expect, it } from 'vitest';
import { GAME_TIME } from '../src/config/constants';
import { drainEvents } from '../src/sim/state';
import { closeMeeting } from '../src/meeting/meetingSystem';
import { newGame, runFrames } from './helpers';

describe('full match (AI only)', () => {
  it.each([
    [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 10], [7, 15],
  ] as const)('seed %i (%i per nation) plays to a result without errors', (seed, size) => {
    const state = newGame('star', 'communicator', seed, size);
    expect(state.entities.length).toBe(size * 3);
    expect(state.entities.filter((e) => e.role === 'king').length).toBe(3);
    expect(state.entities.filter((e) => e.isPlayer).length).toBe(1);
    const counts: Record<string, number> = {};
    for (let t = 0; t < GAME_TIME + 5 && !state.over; t++) {
      runFrames(state, 1000);
      for (const ev of drainEvents(state)) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
      if (state.meeting) closeMeeting(state); // the player leaves each meeting straight away
    }
    expect(state.over).toBe(true);
    expect(counts.MEETING_OPENED ?? 0).toBeGreaterThanOrEqual(2); // scheduled meetings happened
    expect(state.winner).not.toBeNull();
    // The AI actually plays: captures and jailings happen.
    expect(counts.JAILED ?? 0).toBeGreaterThan(0);
    for (const e of state.entities) {
      expect(Number.isFinite(e.x) && Number.isFinite(e.z)).toBe(true);
    }
  }, 30000);
});
