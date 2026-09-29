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

  /** Same sectors for everyone, so only the numbers a test sets differ. */
  const even = (state: ReturnType<typeof newGame>) => { state.war.sectors.forEach((s) => { s.owner = null; }); };

  it('time-up picks the best war score among surviving kingdoms', () => {
    const state = newGame();
    even(state);
    const base = nationScore(state, 'moon');
    state.natStats.moon.cap = 2;
    state.natStats.star.hit = 1;
    forceEndByTime(state);
    expect(nationScore(state, 'moon') - base).toBe(6);
    expect(state.winner).toBe('moon');
  });

  it('the tower no longer decides it alone: 100 s in the tower is worth less than a few captures and a sector', () => {
    const state = newGame();
    even(state);
    state.natStats.moon.tower = 100;
    state.natStats.star.cap = 2;
    state.war.sectors[0].owner = 'star';
    forceEndByTime(state);
    expect(state.winner).toBe('star');
  });

  it('a king still in a jail at time-up costs points; sectors and free people count', () => {
    const state = newGame();
    even(state);
    const s0 = nationScore(state, 'sun');
    state.war.sectors[0].owner = 'sun';
    expect(nationScore(state, 'sun') - s0).toBe(4);
    const k = find(state, 'sun', 'king');
    k.jailed = true;
    expect(nationScore(state, 'sun') - s0).toBe(4 - 10 - 2);
  });

  it('time-up with tied scores is a draw', () => {
    const state = newGame();
    even(state);
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
  });
});
