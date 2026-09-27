import { describe, expect, it } from 'vitest';
import { GAME_TIME } from '../src/config/constants';
import { eliminate } from '../src/sim/systems/jail';
import { forceEndByTime, nationScore } from '../src/sim/systems/winCondition';
import { find, freezeOthers, newGame, runFrames } from './helpers';

describe('win condition', () => {
  it('the last nation with a living king wins, and the simulation stops', () => {
    const state = newGame('sun', 'soldier');
    eliminate(state, find(state, 'moon', 'king'));
    expect(state.over).toBe(false);
    eliminate(state, find(state, 'star', 'king'));
    expect(state.over).toBe(true);
    expect(state.winner).toBe('sun');
    expect(state.events.filter((e) => e.type === 'GAME_OVER')).toHaveLength(1);
    const t = state.time;
    runFrames(state, 5000);
    expect(state.time).toBe(t);
  });

  it('time-up picks the best score among surviving kingdoms', () => {
    const state = newGame();
    state.natStats.moon.cap = 2;
    state.natStats.star.hit = 1;
    forceEndByTime(state);
    expect(nationScore(state, 'moon')).toBe(6);
    expect(state.winner).toBe('moon');
  });

  it('time-up with tied scores is a draw', () => {
    const state = newGame();
    forceEndByTime(state);
    expect(state.winner).toBe('draw');
  });

  it('time-up ignores kingdoms whose king is dead', () => {
    const state = newGame();
    state.natStats.star.cap = 10;
    eliminate(state, find(state, 'star', 'king'));
    state.natStats.sun.res = 1;
    forceEndByTime(state);
    expect(state.winner).toBe('sun');
  });

  it('the match ends when game time reaches GAME_TIME', () => {
    const state = newGame();
    state.nextEventAt = Infinity;
    state.nextMeetingAt = Infinity; // meetings pause the clock (tested in meeting.test.ts)
    freezeOthers(state, []);
    runFrames(state, GAME_TIME * 1000 - 1000);
    expect(state.over).toBe(false);
    runFrames(state, 2000);
    expect(state.over).toBe(true);
    expect(state.winner).toBe('draw');
  });
});
