import { describe, expect, it } from 'vitest';
import { GAME_TIME, VISION } from '../src/config/constants';
import { LIGHTS } from '../src/config/map';
import { teleport } from '../src/sim/entity';
import { LAMP_R, NIGHT_VISION, inLight, nightFactor, nightTick, nightVisionMul } from '../src/sim/night';
import { drainEvents } from '../src/sim/state';
import { visibleTo } from '../src/sim/systems/vision';
import { find, freezeOthers, newGame } from './helpers';

describe('nightfall', () => {
  it('dusk at the start, full night at the end', () => {
    const state = newGame();
    expect(nightFactor(state)).toBe(0);
    state.time = GAME_TIME * 1000;
    expect(nightFactor(state)).toBe(1);
  });

  it('at night you are seen from less far — unless you stand under a street lamp', () => {
    const state = newGame('sun', 'soldier', 1, 6);
    freezeOthers(state, []);
    state.time = GAME_TIME * 1000 - 1000;
    const lamp = LIGHTS[0];
    expect(inLight(lamp.x, lamp.z)).toBe(true);
    expect(nightVisionMul(state, lamp.x, lamp.z)).toBe(1);
    // A dark spot far from every lamp.
    const dark = { x: lamp.x + 2000, z: lamp.z };
    const darkOk = LIGHTS.every((l) => Math.hypot(l.x - dark.x, l.z - dark.z) > LAMP_R + 150);
    if (darkOk) expect(nightVisionMul(state, dark.x, dark.z)).toBeCloseTo(NIGHT_VISION + (1 - NIGHT_VISION) * (1 - nightFactor(state)), 5);
    // In practice: someone at 85% of daytime vision range is lost in the dark, but not under a lamp.
    const p = state.player, foe = find(state, 'moon', 'soldier');
    const d = VISION * 0.85;
    teleport(p, lamp.x - d, lamp.z, 0);
    teleport(foe, lamp.x, lamp.z, 0);
    const lampSeen = visibleTo(state, foe, p);
    state.time = 0;
    const daySeen = visibleTo(state, foe, p);
    expect(lampSeen).toBe(daySeen);
  });

  it('the dark is announced once', () => {
    const state = newGame();
    drainEvents(state);
    for (let t = 0; t <= GAME_TIME * 1000; t += 500) { state.time = t; nightTick(state, 0.5); }
    expect(drainEvents(state).filter((e) => e.type === 'NIGHTFALL')).toHaveLength(1);
  });
});

describe('announcements at a moment in the match', () => {
  it('the tower phase is announced once however the steps fall', async () => {
    const { towerTick } = await import('../src/sim/systems/tower');
    for (const step of [500, 1000 / 60, 250]) {
      const state = newGame();
      drainEvents(state);
      for (let t = 0; t <= GAME_TIME * 1000; t += step) { state.time = t; towerTick(state, step / 1000); }
      expect(drainEvents(state).filter((e) => e.type === 'BEACON_PHASE')).toHaveLength(1);
    }
  });
});
