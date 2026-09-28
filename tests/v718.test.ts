import { describe, expect, it } from 'vitest';
import { jailDuration } from '../src/sim/systems/jail';
import { discussionLines } from '../src/meeting/dialogue';
import { stepSimulation } from '../src/sim/step';
import { STEP_SEC } from '../src/core/clock';
import { newGame } from './helpers';

describe('v7.18', () => {
  it('prisoners wait longer before execution: 50 s, the king 80 s', () => {
    const state = newGame('sun', 'soldier', 1, 10);
    const soldier = state.entities.find((e) => e.role === 'soldier')!;
    const king = state.entities.find((e) => e.role === 'king')!;
    expect(jailDuration(soldier)).toBe(50000);
    expect(jailDuration(king)).toBe(80000);
  });

  it('meetings in one match do not keep saying the same things', () => {
    const state = newGame('moon', 'soldier', 7, 10);
    for (let i = 0; i < 60 * 40; i++) stepSimulation(state, STEP_SEC);
    const facts = { seen: [{ nation: 'sun' as const, place: '秋葉原', count: 3, ageSec: 12, king: 0 }], suspect: null };
    const strip = (l: string) => l.replace(/^[^「]*「/, '');
    const meetings = [0, 1, 2].map(() => discussionLines(state, 'moon', facts).map(strip));
    for (const m of meetings) {
      expect(m.length).toBeGreaterThan(5);
      expect(m.join('')).not.toMatch(/NaN|undefined/);
    }
    // Apart from the call to vote, a later meeting shares few lines with an earlier one.
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        const same = meetings[b].filter((l) => meetings[a].includes(l) && !l.includes('投票'));
        expect(same.length).toBeLessThanOrEqual(2);
      }
    }
  });
});
