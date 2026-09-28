import { describe, expect, it } from 'vitest';
import { GAME_TIME, KING_BEACON_CD, KING_BEACON_TIME } from '../src/config/constants';
import { STEP_SEC } from '../src/core/clock';
import { teleport } from '../src/sim/entity';
import { drainEvents } from '../src/sim/state';
import { activate } from '../src/sim/systems/abilities';
import { eliminate, sendToJail } from '../src/sim/systems/jail';
import { canRescue, lastStanding, updateRescue } from '../src/sim/systems/rescue';
import { canLightKings, lightKings } from '../src/sim/systems/tower';
import { visibleTo } from '../src/sim/systems/vision';
import { find, newGame } from './helpers';

/** Hold Z next to the jailed ally until the lock opens (or give up). */
function rescueBy(state: ReturnType<typeof newGame>, who: ReturnType<typeof find>): boolean {
  activate(state, who);
  if (!who.channeling) return false;
  const target = who.channeling.target;
  for (let t = 0; t < 10 && who.channeling; t += STEP_SEC) { state.time += STEP_SEC * 1000; updateRescue(state, who, STEP_SEC); }
  return !target.jailed;
}

describe('v7.19 rescue ability', () => {
  it('the king can always open a jail, and a soldier cannot while others are free', () => {
    const state = newGame('sun', 'soldier', 1, 10);
    const king = find(state, 'sun', 'king'), soldier = state.entities.find((e) => e.nation === 'sun' && e.role === 'soldier' && !e.isPlayer)!;
    const prisoner = state.entities.find((e) => e.nation === 'sun' && e.role === 'sniper')!;
    sendToJail(state, prisoner, 'moon', null);
    expect(canRescue(state, king)).toBe(true);
    expect(canRescue(state, soldier)).toBe(false);
    teleport(soldier, prisoner.x + 20, prisoner.z);
    activate(state, soldier);
    expect(soldier.channeling).toBeNull();
    teleport(king, prisoner.x + 20, prisoner.z);
    expect(rescueBy(state, king)).toBe(true);
  });

  it('the last one of a nation still free gets the rescue ability (and it is announced)', () => {
    const state = newGame('sun', 'soldier', 1, 6);
    const sun = state.entities.filter((e) => e.nation === 'sun');
    const last = sun.find((e) => e.role === 'soldier')!;
    drainEvents(state);
    for (const e of sun) if (e !== last) sendToJail(state, e, 'moon', null);
    expect(lastStanding(state, last)).toBe(true);
    expect(canRescue(state, last)).toBe(true);
    expect(drainEvents(state).some((ev) => ev.type === 'LAST_STAND' && ev.entityId === last.id)).toBe(true);
    const king = find(state, 'sun', 'king');
    teleport(last, king.x + 20, king.z);
    expect(rescueBy(state, last)).toBe(true);
    // Once someone else is free again, the soldier is a soldier again.
    expect(canRescue(state, last)).toBe(false);
  });

  it('an execution does not stop the last one from rescuing the rest', () => {
    const state = newGame('sun', 'soldier', 1, 6);
    const sun = state.entities.filter((e) => e.nation === 'sun');
    const last = sun.find((e) => e.role === 'sniper')!;
    for (const e of sun) if (e !== last) sendToJail(state, e, 'moon', null);
    const victim = sun.find((e) => e.role === 'soldier')!;
    eliminate(state, victim);
    expect(canRescue(state, last)).toBe(true);
  });
});

describe('v7.19 tower lights the kings', () => {
  it('only in the last third of the match, only for the holder, then recharges', () => {
    const state = newGame('sun', 'soldier', 1, 6);
    state.tower.owner = 'sun';
    state.time = (GAME_TIME * 1000 * 2) / 3 - 5000;
    expect(canLightKings(state, 'sun')).toBe(false);
    state.time = (GAME_TIME * 1000 * 2) / 3 + 1000;
    expect(canLightKings(state, 'moon')).toBe(false);
    const moonKing = find(state, 'moon', 'king');
    const p = state.player;
    teleport(moonKing, p.x + 3000, p.z + 3000);
    expect(visibleTo(state, moonKing, p)).toBe(false);
    expect(lightKings(state, 'sun')).toBe(true);
    expect(visibleTo(state, moonKing, p)).toBe(true);
    // The moon cannot see the sun king (they did not light anything).
    expect(visibleTo(state, find(state, 'sun', 'king'), state.entities.find((e) => e.nation === 'moon' && e.role === 'soldier')!)).toBe(false);
    expect(state.factions.sun.belief.get(moonKing.id)).toBe(5);
    expect(lightKings(state, 'sun')).toBe(false); // still lit / recharging
    state.time += KING_BEACON_TIME + 10;
    expect(visibleTo(state, moonKing, p)).toBe(false);
    expect(canLightKings(state, 'sun')).toBe(false);
    state.time += KING_BEACON_CD;
    expect(canLightKings(state, 'sun')).toBe(true);
  });
});
