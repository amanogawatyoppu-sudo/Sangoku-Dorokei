import { describe, expect, it } from 'vitest';
import { GAME_TIME } from '../src/config/constants';
import { teleport } from '../src/sim/entity';
import { DECOY_TIME, canUseDecoy, decoyOf, useDecoy } from '../src/sim/decoy';
import { kingLit, lightKings } from '../src/sim/systems/tower';
import { find, newGame } from './helpers';

describe('影武者 (the king’s double)', () => {
  it('names the nearest ally for 30 s, once a match; enemy suspicion moves to the double', () => {
    const state = newGame('sun', 'soldier', 2, 10);
    const king = find(state, 'moon', 'king');
    const ally = state.entities.find((e) => e.nation === 'moon' && e.role === 'soldier')!;
    teleport(king, 0, 0); teleport(ally, 60, 0);
    for (const e of state.entities) if (e.nation === 'moon' && e !== king && e !== ally) teleport(e, 3000, 3000);
    state.factions.sun.belief.set(king.id, 4);
    expect(useDecoy(state, king)).toBe(true);
    expect(decoyOf(state, 'moon')?.id).toBe(ally.id);
    expect(state.factions.sun.belief.get(king.id)).toBe(0);
    expect(state.factions.sun.belief.get(ally.id)).toBeGreaterThanOrEqual(4);
    expect(canUseDecoy(state, king)).toBe(false);
    state.time += DECOY_TIME + 1;
    expect(decoyOf(state, 'moon')).toBeNull();
    expect(useDecoy(state, king)).toBe(false);
  });

  it('the tower lights the double instead of the king while it stands in', () => {
    const state = newGame('sun', 'soldier', 2, 10);
    const king = find(state, 'moon', 'king');
    const ally = state.entities.find((e) => e.nation === 'moon' && e.role === 'soldier')!;
    teleport(ally, king.x + 50, king.z);
    expect(useDecoy(state, king)).toBe(true);
    const double = decoyOf(state, 'moon')!;
    state.tower.owner = 'sun';
    state.time = (GAME_TIME * 1000 * 2) / 3 + 1000;
    state.decoy.moon!.until = state.time + 10000;
    expect(lightKings(state, 'sun')).toBe(true);
    expect(kingLit(state, king, 'sun')).toBe(false);
    expect(kingLit(state, double, 'sun')).toBe(true);
    // The real star king is lit as usual.
    expect(kingLit(state, find(state, 'star', 'king'), 'sun')).toBe(true);
  });

  it('nobody near: no double, and the chance is not spent', () => {
    const state = newGame('sun', 'soldier', 2, 6);
    const king = find(state, 'moon', 'king');
    teleport(king, 0, 0);
    for (const e of state.entities) if (e.nation === 'moon' && e !== king) teleport(e, 4000, 4000);
    expect(useDecoy(state, king)).toBe(false);
    expect(canUseDecoy(state, king)).toBe(true);
  });
});
