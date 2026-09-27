import { describe, expect, it } from 'vitest';
import { SCOPE_RANGE } from '../src/config/constants';
import { SNIPE_RANGE, sniperTarget, useSpecial } from '../src/sim/systems/abilities';
import { teleport } from '../src/sim/entity';
import { canPerceive } from '../src/ai/perception';
import { visibleTo } from '../src/sim/systems/vision';
import { SPOT, find, freezeOthers, newGame } from './helpers';

/** A sniper on open ground facing +z and one enemy placed relative to it. */
function range(dx: number, dz: number, dy = 0) {
  const state = newGame('sun', 'sniper');
  state.nextEventAt = Infinity;
  const s = state.player, t = find(state, 'moon', 'soldier');
  freezeOthers(state, [s, t]);
  // Park everyone else far away so they cannot be picked.
  for (const e of state.entities) if (e !== s && e !== t) teleport(e, SPOT.x + 3000, SPOT.z);
  teleport(s, SPOT.x, SPOT.z - 300, dy);
  s.dirX = 0;
  s.dirZ = 1;
  teleport(t, SPOT.x + dx, SPOT.z - 300 + dz, 0);
  return { state, s, t };
}

describe('sniper', () => {
  it('locks onto an enemy ahead within range and line of sight', () => {
    const { state, s, t } = range(60, 400);
    expect(sniperTarget(state, s)).toBe(t);
  });

  it('does not reach past its range, or outside ±30° of the facing', () => {
    expect(sniperTarget(range(0, SNIPE_RANGE + 40).state, range(0, SNIPE_RANGE + 40).s)).toBeNull();
    const side = range(300, 300); // 45° off
    expect(sniperTarget(side.state, side.s)).toBeNull();
  });

  it('shoots further from high ground', () => {
    const { state, s, t } = range(0, SNIPE_RANGE * 1.15, 100);
    s.y = 100; // standing on something 100 up (a deck)
    expect(sniperTarget(state, s)).toBe(t);
  });

  it('a hit stuns and turns the shooter to face the target; with nothing in the sights no reload is spent', () => {
    const hit = range(80, 300);
    useSpecial(hit.state, hit.s);
    expect(hit.t.stunUntil).toBeGreaterThan(hit.state.time);
    expect(hit.s.cd.special).toBeGreaterThan(5);
    expect(hit.s.dirX).toBeGreaterThan(0.1); // swung toward the target on the right
    const miss = range(0, SNIPE_RANGE + 200);
    useSpecial(miss.state, miss.s);
    expect(miss.s.cd.special).toBeLessThan(1);
  });

  it('sees far ahead through the scope (a narrow cone only), as the AI does', () => {
    const ahead = range(0, SCOPE_RANGE - 30);
    expect(visibleTo(ahead.state, ahead.t, ahead.s)).toBe(true);
    const wide = range(250, SCOPE_RANGE - 100); // outside the scope cone and beyond normal vision
    expect(visibleTo(wide.state, wide.t, wide.s)).toBe(false);
    // An AI sniper's perception uses the same scope.
    const ai = range(0, SCOPE_RANGE - 30);
    const aiSniper = find(ai.state, 'moon', 'sniper');
    teleport(aiSniper, ai.t.x, ai.t.z - SCOPE_RANGE + 30);
    aiSniper.dirX = 0;
    aiSniper.dirZ = 1;
    const sunSoldier = find(ai.state, 'sun', 'soldier');
    teleport(sunSoldier, ai.t.x, ai.t.z);
    aiSniper.ai.alert = 0;
    expect(canPerceive(ai.state, aiSniper, sunSoldier)).toBe(true);
  });
});
