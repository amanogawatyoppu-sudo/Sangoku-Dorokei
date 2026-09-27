import { describe, expect, it } from 'vitest';
import { JAIL_TIME, KING_JAIL_EXTRA } from '../src/config/constants';
import type { Entity } from '../src/sim/entity';
import type { GameState } from '../src/sim/state';
import { freeFromJail, sendToJail } from '../src/sim/systems/jail';
import { freezeOthers, find, newGame, runFrames } from './helpers';

function jailWithoutInterference(state: GameState, prisoner: Entity): void {
  state.nextEventAt = Infinity; // no random jailbreak
  freezeOthers(state, []); // nobody can rescue
  sendToJail(state, prisoner, 'sun', null);
}

describe('execution timer', () => {
  it('executes a prisoner after JAIL_TIME of game time, not before', () => {
    const state = newGame('sun', 'soldier');
    const prisoner = find(state, 'moon', 'sniper');
    jailWithoutInterference(state, prisoner);
    runFrames(state, JAIL_TIME - 200);
    expect(prisoner.alive).toBe(true);
    runFrames(state, 400);
    expect(prisoner.alive).toBe(false);
    expect(prisoner.jailed).toBe(false);
    expect(prisoner.eliminatedAt).toBeCloseTo(JAIL_TIME / 1000, 0);
    expect(state.events.map((e) => e.type)).toContain('ELIMINATED');
  });

  it('gives kings the extra sentence time', () => {
    const state = newGame('sun', 'soldier');
    const king = find(state, 'moon', 'king');
    jailWithoutInterference(state, king);
    runFrames(state, JAIL_TIME + 1000);
    expect(king.alive).toBe(true);
    runFrames(state, KING_JAIL_EXTRA);
    expect(king.alive).toBe(false);
  });

  it('a rescued prisoner returns to base and is not executed', () => {
    const state = newGame('sun', 'soldier');
    const prisoner = find(state, 'moon', 'sniper');
    jailWithoutInterference(state, prisoner);
    runFrames(state, 5000);
    freeFromJail(prisoner);
    runFrames(state, JAIL_TIME + 1000);
    expect(prisoner.alive).toBe(true);
    expect(prisoner.jailed).toBe(false);
  });
});
