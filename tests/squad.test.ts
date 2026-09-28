import { describe, expect, it } from 'vitest';
import { STEP_SEC } from '../src/core/clock';
import { playerSquadSize } from '../src/ai/faction';
import { teleport } from '../src/sim/entity';
import type { Entity } from '../src/sim/entity';
import { stepSimulation } from '../src/sim/step';
import type { GameState } from '../src/sim/state';
import { queueCommand } from '../src/sim/state';
import { SITES } from '../src/config/map';
import { find, newGame } from './helpers';

function steps(state: GameState, sec: number, each?: () => void): void {
  for (let t = 0; t < sec; t += STEP_SEC) { stepSimulation(state, STEP_SEC); each?.(); }
}

const squadOf = (state: GameState, L: Entity) => state.entities.filter((e) => e.ai.leaderId === L.id && e.alive && !e.jailed);
const d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** A 10-per-nation match where only the sun nation moves (no enemies to fight). */
function calm(): GameState {
  const state = newGame('sun', 'soldier', 3, 10);
  state.nextEventAt = Infinity;
  state.nextMeetingAt = Infinity;
  for (const e of state.entities) if (e.nation !== 'sun') e.stunUntil = Infinity;
  return state;
}

describe('squads', () => {
  it('the player gets a squad sized to the nation (soldiers first)', () => {
    expect([6, 10, 15].map(playerSquadSize)).toEqual([2, 3, 4]);
    const state = calm();
    steps(state, 1.2);
    const sq = squadOf(state, state.player);
    expect(sq.length).toBe(3);
    expect(sq.every((e) => e.nation === 'sun' && e.role !== 'king' && e.role !== 'keyholder' && e.role !== 'communicator')).toBe(true);
  });

  it('AI hunters form squads of up to three and keep together on patrol', () => {
    const state = newGame('sun', 'soldier', 5, 15);
    state.nextEventAt = Infinity;
    state.nextMeetingAt = Infinity;
    state.player.stunUntil = Infinity;
    steps(state, 2);
    const leaders = state.entities.filter((e) => e.nation === 'moon' && squadOf(state, e).length > 0);
    expect(leaders.length).toBeGreaterThan(0);
    expect(leaders.every((L) => squadOf(state, L).length <= 2)).toBe(true);
    // Over the next 30 s, followers keeping formation stay close to their leader.
    const gaps: number[] = [];
    steps(state, 30, () => {
      for (const e of state.entities) {
        if (e.nation === 'sun' || e.ai.state !== 'SQUAD' || e.ai.leaderId === null) continue;
        gaps.push(d(e, state.entities[e.ai.leaderId]));
      }
    });
    gaps.sort((a, b) => a - b);
    expect(gaps.length).toBeGreaterThan(100);
    expect(gaps[Math.floor(gaps.length / 2)]).toBeLessThan(160); // median
  });

  it('follows the player in formation', () => {
    const state = calm();
    const p = state.player;
    teleport(p, SITES.open.x, SITES.open.z + 250);
    steps(state, 1.2);
    for (const e of squadOf(state, p)) teleport(e, p.x + (e.id % 3) * 30 - 30, p.z + 60);
    p.dirX = 0;
    p.dirZ = -1;
    state.input = { forward: 1, turn: 0, dash: false };
    steps(state, 1.6); // ~480 across the plaza
    state.input = { forward: 0, turn: 0, dash: false };
    steps(state, 2.5);
    for (const e of squadOf(state, p)) expect(d(e, p)).toBeLessThan(200);
  });

  it('"ここを守れ" keeps them at the spot while the player leaves', () => {
    const state = calm();
    const p = state.player;
    teleport(p, SITES.open.x, SITES.open.z);
    steps(state, 1.2);
    const sq = squadOf(state, p);
    for (const e of sq) teleport(e, p.x + (e.id % 3) * 30 - 30, p.z + 50);
    queueCommand(state, { type: 'squad', order: 'hold' });
    steps(state, 0.1);
    const anchor = { ...state.squadAnchor! };
    p.dirX = 0;
    p.dirZ = -1;
    state.input = { forward: 1, turn: 0, dash: false };
    steps(state, 2);
    state.input = { forward: 0, turn: 0, dash: false };
    steps(state, 3);
    expect(d(p, anchor)).toBeGreaterThan(400);
    for (const e of sq) expect(d(e, anchor)).toBeLessThan(140);
  });

  it('"周りを警戒しろ" rings the player, each facing outward', () => {
    const state = calm();
    const p = state.player;
    teleport(p, SITES.open.x, SITES.open.z);
    steps(state, 1.2);
    const sq = squadOf(state, p);
    for (const e of sq) teleport(e, p.x + (e.id % 3) * 30 - 30, p.z + 60);
    queueCommand(state, { type: 'squad', order: 'spread' });
    steps(state, 5);
    for (const e of sq) {
      expect(d(e, p)).toBeGreaterThan(35);
      expect(d(e, p)).toBeLessThan(110);
      // Looking away from the player.
      expect(e.dirX * (e.x - p.x) + e.dirZ * (e.z - p.z)).toBeGreaterThan(0);
    }
    const pts = sq.map((e) => Math.atan2(e.x - p.x, e.z - p.z)).sort((a, b) => a - b);
    for (let i = 1; i < pts.length; i++) expect(pts[i] - pts[i - 1]).toBeGreaterThan(0.8); // spread round, not bunched
  });

  it('keeps up while the player keeps walking (no need to stop)', () => {
    const state = calm();
    const p = state.player;
    teleport(p, SITES.open.x, SITES.open.z + 300);
    steps(state, 1.5);
    const sq = squadOf(state, p);
    for (const e of sq) teleport(e, p.x + (e.id % 3) * 30 - 30, p.z + 60);
    p.dirX = 0;
    p.dirZ = -1;
    state.input = { forward: 1, turn: 0.15, dash: false };
    const gaps: number[] = [];
    let t = 0;
    steps(state, 10, () => { if ((t += STEP_SEC) > 1) for (const e of sq) gaps.push(d(e, p)); });
    gaps.sort((a, b) => a - b);
    expect(gaps[Math.floor(gaps.length / 2)]).toBeLessThan(110); // median
    expect(gaps[Math.floor(gaps.length * 0.9)]).toBeLessThan(260);
  });

  it('squad members go after an enemy they see', () => {
    const state = calm();
    const p = state.player;
    teleport(p, SITES.open.x, SITES.open.z + 150);
    p.dirX = 0;
    p.dirZ = -1; // the enemy is ahead of the squad
    steps(state, 1.2);
    const sq = squadOf(state, p);
    for (const e of sq) { teleport(e, p.x + (e.id % 3) * 30 - 30, p.z + 40); e.dirX = 0; e.dirZ = -1; }
    const enemy = find(state, 'moon', 'soldier');
    enemy.stunUntil = 0;
    teleport(enemy, SITES.open.x, SITES.open.z - 150);
    enemy.stunUntil = Infinity; // stands still, in plain view
    steps(state, 1.5);
    expect(sq.some((e) => (e.ai.state === 'CHASE' || e.ai.state === 'INTERCEPT') && e.ai.targetId === enemy.id)).toBe(true);
  });
});
