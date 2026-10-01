import { describe, expect, it } from 'vitest';
import { factionTick } from '../src/ai/faction';
import { targetOf } from '../src/ai/controller';
import { closeMeeting, openMeeting, openScheduledMeeting, voteInMeeting } from '../src/meeting/meetingSystem';
import { DEFAULT_SETTINGS, canStart, missing, summary } from '../src/ui/flow';
import { drainEvents } from '../src/sim/state';
import { find, newGame, placeAtBase } from './helpers';

/** Gives the sun faction a fresh report of an enemy (as if someone had just seen it). */
function report(state: ReturnType<typeof newGame>, id: number) {
  const e = state.entities[id];
  state.factions.sun.intel.set(id, { id, x: e.x, y: e.y, z: e.z, vx: 0, vz: 0, t: state.time, since: state.time });
}

describe('会議で次の標的を決める (v8.4)', () => {
  it('the vote lists enemy members the faction has seen, and the winner becomes the next target', () => {
    const state = newGame('sun', 'soldier', 2, 10);
    state.nextEventAt = Infinity;
    const foe = find(state, 'moon', 'ranger');
    report(state, foe.id);
    placeAtBase(state.player);
    expect(openMeeting(state)).toBe(true);
    const zones = state.meeting!.zones;
    const i = zones.findIndex((z) => z.targetId === foe.id);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(zones[i].label).toMatch(/^LUNA・/);
    expect(zones.every((z) => z.targetId === undefined || state.entities[z.targetId].nation !== 'sun')).toBe(true);
    voteInMeeting(state, i);
    closeMeeting(state);
    expect(targetOf(state, 'sun')).toBe(foe.id);
    expect(drainEvents(state).some((ev) => ev.type === 'TARGET_SET' && ev.targetId === foe.id)).toBe(true);
    // …for a minute.
    state.time += 61000;
    expect(targetOf(state, 'sun')).toBe(null);
  });

  it('with no evidence on anyone, the vote falls back to places to search', () => {
    const state = newGame('sun', 'soldier', 2, 10);
    state.nextEventAt = Infinity;
    placeAtBase(state.player);
    openMeeting(state);
    expect(state.meeting!.zones.length).toBeGreaterThan(0);
    expect(state.meeting!.zones.every((z) => z.targetId === undefined)).toBe(true);
  });

  it('at half time the CPU factions pick a target of their own from what they have seen', () => {
    const state = newGame('sun', 'soldier', 2, 10);
    const foe = find(state, 'sun', 'sniper');
    const e = state.entities[foe.id];
    state.factions.moon.intel.set(foe.id, { id: foe.id, x: e.x, y: e.y, z: e.z, vx: 0, vz: 0, t: state.time, since: state.time });
    openScheduledMeeting(state);
    expect(targetOf(state, 'moon')).toBe(foe.id);
    closeMeeting(state);
    // Its commander sends a party to where that person was last seen.
    state.factions.moon.nextTickAt = 0;
    factionTick(state);
    const party = state.entities.filter((m) => m.nation === 'moon' && m.ai.task?.kind === 'huntKing' && m.ai.task.nation === 'sun');
    expect(party.length).toBeGreaterThanOrEqual(2);
    // The voted person is chased before anyone else in view.
    expect(state.factions.moon.belief.get(foe.id)).toBeGreaterThan(2.5); // (fades a little each commander tick)
  });
});

describe('CPU戦は所属勢力と役職がランダム (v8.4)', () => {
  it('a CPU match can start without choosing a faction or role; online still asks', () => {
    expect(canStart(DEFAULT_SETTINGS)).toBe(true);
    expect(summary(DEFAULT_SETTINGS).slice(0, 2)).toEqual(['所属勢力：ランダム', '役職：ランダム']);
    expect(missing({ ...DEFAULT_SETTINGS, mode: 'online' })).toEqual(['所属勢力', '役職']);
  });
});
