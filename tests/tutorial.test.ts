import { describe, expect, it } from 'vitest';
import { GAME_TIME } from '../src/config/constants';
import { STEP_SEC } from '../src/core/clock';
import { sendToJail } from '../src/sim/systems/jail';
import { stepSimulation } from '../src/sim/step';
import { newGame } from './helpers';

describe('tutorial mode (チュートリアル)', () => {
  it('the CPUs stand still, nobody is executed and the clock never ends the match', () => {
    const state = newGame('sun', 'keyholder');
    state.tutorial = state.practice = true;
    const cpu = state.entities.find((e) => e.nation === 'moon' && e.role === 'soldier')!;
    const pal = state.entities.find((e) => e.nation === 'sun' && e.role === 'soldier')!;
    sendToJail(state, pal, 'moon', null);
    state.time = GAME_TIME * 1000 - 1000;
    // (a moment for people spawned shoulder to shoulder to step apart)
    for (let i = 0; i < 60 * 3; i++) stepSimulation(state, STEP_SEC);
    const at = { x: cpu.x, z: cpu.z };
    for (let i = 0; i < 60 * 120; i++) stepSimulation(state, STEP_SEC);
    expect(state.over).toBe(false);
    expect(Math.hypot(cpu.x - at.x, cpu.z - at.z)).toBeLessThan(1);
    expect(pal.alive && pal.jailed).toBe(true);
    expect(state.meeting).toBeNull();
  });

  it('a normal match is unchanged (the clock still ends it)', () => {
    const state = newGame('sun', 'keyholder');
    state.time = GAME_TIME * 1000 - 100;
    for (let i = 0; i < 30; i++) stepSimulation(state, STEP_SEC);
    expect(state.over).toBe(true);
  });
});
