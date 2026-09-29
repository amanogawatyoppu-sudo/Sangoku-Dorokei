import { describe, expect, it } from 'vitest';
import { STEP_SEC } from '../src/core/clock';
import { teleport } from '../src/sim/entity';
import { PING_TIME, aiPings, pingTick, placePing } from '../src/sim/ping';
import { queueCommand } from '../src/sim/state';
import { stepSimulation } from '../src/sim/step';
import { find, freezeOthers, newGame, SPOT } from './helpers';

describe('pings (合図)', () => {
  it('助けて brings the nearest free allies to you', () => {
    const state = newGame('sun', 'soldier', 3, 10);
    const p = state.player;
    teleport(p, SPOT.x, SPOT.z);
    const allies = state.entities.filter((e) => e.nation === 'sun' && !e.isPlayer && (e.role === 'soldier' || e.role === 'ranger'));
    allies.forEach((a, i) => teleport(a, SPOT.x + 200 + i * 40, SPOT.z));
    queueCommand(state, { type: 'ping', kind: 'help' });
    stepSimulation(state, STEP_SEC);
    const ping = state.pings.find((q) => q.by === p.id)!;
    expect(ping.kind).toBe('help');
    expect(Math.hypot(ping.x - p.x, ping.z - p.z)).toBeLessThan(5);
    const coming = allies.filter((a) => a.ai.searchCenter && Math.hypot(a.ai.searchCenter.x - p.x, a.ai.searchCenter.z - p.z) < 5);
    expect(coming.length).toBeGreaterThanOrEqual(2);
  });

  it('ここに王！ marks the enemy you are facing and makes your commanders suspect it', () => {
    const state = newGame('sun', 'soldier', 3, 10);
    const p = state.player;
    freezeOthers(state, []);
    teleport(p, SPOT.x, SPOT.z);
    p.dirX = 1; p.dirZ = 0;
    const foe = find(state, 'moon', 'soldier');
    teleport(foe, SPOT.x + 80, SPOT.z);
    const ping = placePing(state, p, 'king')!;
    expect(Math.hypot(ping.x - foe.x, ping.z - foe.z)).toBeLessThan(2);
    expect(state.factions.sun.belief.get(foe.id)).toBeGreaterThanOrEqual(3.5);
    expect(state.teamFocus.sun).not.toBeNull();
  });

  it('pings are only for your nation, run out, and a nation keeps at most 4', () => {
    const state = newGame('sun', 'soldier', 3, 10);
    const suns = state.entities.filter((e) => e.nation === 'sun');
    for (let i = 0; i < 6; i++) placePing(state, suns[i], 'gather');
    expect(state.pings.filter((q) => q.nation === 'sun')).toHaveLength(4);
    expect(state.pings.every((q) => q.nation === 'sun')).toBe(true);
    // Too soon for the same person again.
    expect(placePing(state, suns[5], 'gather')).toBeNull();
    state.time += PING_TIME + 10;
    pingTick(state);
    expect(state.pings).toHaveLength(0);
  });

  it('AI allies ping a likely king they can see', () => {
    const state = newGame('sun', 'soldier', 3, 10);
    freezeOthers(state, []);
    const scout = state.entities.find((e) => e.nation === 'sun' && e.role === 'soldier' && !e.isPlayer)!;
    const king = find(state, 'moon', 'king');
    teleport(scout, SPOT.x, SPOT.z);
    teleport(king, SPOT.x + 60, SPOT.z);
    scout.ai.visible = [king.id];
    state.factions.sun.belief.set(king.id, 4);
    state.time = 30000;
    aiPings(state);
    expect(state.pings.some((q) => q.nation === 'sun' && q.kind === 'king' && q.by === scout.id)).toBe(true);
  });
});
