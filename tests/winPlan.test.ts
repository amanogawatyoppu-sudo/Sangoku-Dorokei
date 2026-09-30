import { describe, expect, it } from 'vitest';
import { GAME_TIME } from '../src/config/constants';
import { NATIONS } from '../src/config/nations';
import { STEP_SEC } from '../src/core/clock';
import { factionTick } from '../src/ai/faction';
import { sendToJail } from '../src/sim/systems/jail';
import { stepSimulation } from '../src/sim/step';
import type { GameState } from '../src/sim/state';
import { find, newGame } from './helpers';

function steps(state: GameState, sec: number) {
  for (let i = 0; i < Math.round(sec / STEP_SEC); i++) {
    stepSimulation(state, STEP_SEC);
    state.events.length = 0;
  }
}

const hunters = (state: GameState, n: 'sun' | 'moon' | 'star') =>
  state.entities.filter((e) => e.nation === n && !e.isPlayer && e.alive && !e.jailed && (e.role === 'soldier' || e.role === 'ranger'));

describe('commanders play to win (v7.30)', () => {
  it('king and every keyholder jailed: no rescue that cannot happen, everyone goes for an enemy king', () => {
    const state = newGame('star', 'communicator', 4, 15);
    state.nextEventAt = Infinity;
    const catcher = find(state, 'moon', 'soldier');
    sendToJail(state, find(state, 'sun', 'king'), 'moon', catcher);
    for (const kh of state.entities.filter((e) => e.nation === 'sun' && e.role === 'keyholder')) sendToJail(state, kh, 'moon', catcher);
    steps(state, 1.2);
    expect(state.factions.sun.posture).toBe('ALL_OUT');
    expect(state.factions.sun.strategy.kind).toBe('ALL_OUT');
    const tasks = hunters(state, 'sun').map((e) => e.ai.task);
    expect(tasks.some((t) => t?.kind === 'rescueEscort')).toBe(false);
    expect(tasks.filter((t) => t?.kind === 'huntKing').length).toBeGreaterThanOrEqual(Math.ceil(tasks.length * 0.6));
    // With nothing known, the jailer's king comes first.
    for (const t of tasks) if (t?.kind === 'huntKing') expect(t.nation).toBe('moon');
  });

  it('a keyholder still free: the rescue goes on as before', () => {
    const state = newGame('star', 'communicator', 4, 15);
    state.nextEventAt = Infinity;
    sendToJail(state, find(state, 'sun', 'king'), 'moon', find(state, 'moon', 'soldier'));
    steps(state, 1.2);
    expect(state.factions.sun.posture).toBe('RESCUE_KING');
  });

  it('the hunt heads for the enemy heartland, not a strategic point', () => {
    const state = newGame('star', 'communicator', 4, 15);
    state.nextEventAt = Infinity;
    const catcher = find(state, 'moon', 'soldier');
    sendToJail(state, find(state, 'sun', 'king'), 'moon', catcher);
    for (const kh of state.entities.filter((e) => e.nation === 'sun' && e.role === 'keyholder')) sendToJail(state, kh, 'moon', catcher);
    const home = NATIONS.moon.base;
    const far = (s: GameState) => hunters(s, 'sun').reduce((a, e) => a + Math.hypot(e.x - home.x, e.z - home.z), 0) / hunters(s, 'sun').length;
    steps(state, 1.2);
    const before = far(state);
    steps(state, 20);
    expect(far(state)).toBeLessThan(before - 400);
  }, 30_000);

  it('an enemy king lit by our tower: hunters are sent to where it is', () => {
    const state = newGame('star', 'communicator', 2, 10);
    state.nextEventAt = Infinity;
    state.kingBeacon.sun = state.time + 12000;
    factionTick(state);
    const st = state.factions.sun.strategy;
    expect(st.kind).toBe('HUNT_KING');
    const king = find(state, st.enemy!, 'king');
    const leads = hunters(state, 'sun').map((e) => e.ai.task).filter((t) => t?.kind === 'huntKing');
    expect(leads.length).toBeGreaterThanOrEqual(3);
    for (const t of leads) {
      if (t?.kind !== 'huntKing') continue;
      expect(t.nation).toBe(king.nation);
      expect(Math.hypot(t.lead!.x - king.x, t.lead!.z - king.z)).toBeLessThan(5);
    }
  });

  it('near the end, behind on points: 超級 goes after the leader; ahead: it protects the lead', () => {
    const state = newGame('star', 'communicator', 3, 10);
    state.nextEventAt = Infinity;
    state.cpuLevel = 'expert';
    state.time = (GAME_TIME - 60) * 1000;
    state.natStats.moon.cap = 10;
    factionTick(state);
    expect(state.factions.sun.strategy.kind).toBe('HUNT_KING');
    expect(state.factions.sun.strategy.enemy).toBe('moon');
    expect(state.factions.moon.strategy.kind).toBe('HOLD_LEAD');
    // 初級 does not count points.
    const easy = newGame('star', 'communicator', 3, 10);
    easy.nextEventAt = Infinity;
    easy.cpuLevel = 'easy';
    easy.time = (GAME_TIME - 60) * 1000;
    easy.natStats.moon.cap = 10;
    factionTick(easy);
    expect(easy.factions.moon.strategy.kind).not.toBe('HOLD_LEAD');
  });
});
