import { describe, expect, it } from 'vitest';
import { STEP_SEC } from '../src/core/clock';
import { BRIDGES, riverBanks } from '../src/config/map';
import { navGraph, planPath } from '../src/ai/nav';
import { teleport } from '../src/sim/entity';
import type { Entity } from '../src/sim/entity';
import { stepSimulation } from '../src/sim/step';
import type { GameState } from '../src/sim/state';
import { inWater } from '../src/sim/systems/world';
import { newGame } from './helpers';

const squadOf = (state: GameState, L: Entity) => state.entities.filter((e) => e.ai.leaderId === L.id && e.alive && !e.jailed);

/** Walks the player (with the real movement rules) along a planned route, then stands still. */
function walkRoute(state: GameState, to: { x: number; y: number; z: number }, stats: { maxGap: number; waterSteps: number }): boolean {
  const p = state.player;
  const route = planPath(p, to);
  if (!route) return false;
  let i = 0;
  for (let t = 0; t < 60 && i < route.length; t += STEP_SEC) {
    const w = route[i];
    const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
    if (d < 14) { i++; continue; }
    p.dirX = dx / d; p.dirZ = dz / d;
    state.input = { forward: 1, turn: 0, dash: false };
    stepSimulation(state, STEP_SEC);
    for (const f of squadOf(state, p)) {
      const gg = Math.hypot(f.x - p.x, f.z - p.z);
      stats.maxGap = Math.max(stats.maxGap, gg);
      if (inWater(f.x, f.z, f.y)) stats.waterSteps++;
    }
  }
  state.input = { forward: 0, turn: 0, dash: false };
  return true;
}

describe('付いてこい (follow): the squad keeps up across bridges and round obstacles', () => {
  for (const bi of [0, 2, 4]) {
    it(`bridge ${bi}: nobody ends up in the river or stuck behind`, () => {
      const state = newGame('sun', 'soldier', 11, 10);
      state.nextEventAt = Infinity;
      state.nextMeetingAt = Infinity;
      for (const e of state.entities) if (e.nation !== 'sun') e.stunUntil = Infinity;
      const b = BRIDGES[bi];
      const [south, north] = riverBanks(b.x);
      teleport(state.player, b.x, south + 150);
      for (let t = 0; t < 1.5; t += STEP_SEC) stepSimulation(state, STEP_SEC); // squads form
      const sq = squadOf(state, state.player);
      expect(sq.length).toBeGreaterThan(0);
      for (const [k, f] of sq.entries()) teleport(f, b.x + (k - 1) * 40, south + 200);
      const stats = { maxGap: 0, waterSteps: 0 };
      // Across the bridge and a way on, then back again.
      expect(walkRoute(state, { x: b.x, y: 0, z: north - 250 }, stats)).toBe(true);
      expect(walkRoute(state, { x: b.x + 60, y: 0, z: south + 250 }, stats)).toBe(true);
      for (let t = 0; t < 6; t += STEP_SEC) stepSimulation(state, STEP_SEC); // they catch up
      const gaps = squadOf(state, state.player).map((f) => Math.round(Math.hypot(f.x - state.player.x, f.z - state.player.z)));
      expect(stats.waterSteps, `steps in the water: ${stats.waterSteps}`).toBe(0);
      expect(Math.max(...gaps), `gaps at the end: ${gaps}`).toBeLessThan(160);
      expect(stats.maxGap, 'never left far behind').toBeLessThan(600);
    }, 60_000);
  }
});

describe('付いてこい: a dashing player through the city', () => {
  for (const seed of [1, 5]) {
    it(`seed ${seed}: followers never stand stuck and are all back in formation after each run`, () => {
      const state = newGame('sun', 'soldier', seed, 10);
      state.nextEventAt = Infinity;
      state.nextMeetingAt = Infinity;
      for (const e of state.entities) if (e.nation !== 'sun') e.stunUntil = Infinity;
      const p = state.player;
      const b = BRIDGES[(seed * 3) % BRIDGES.length];
      teleport(p, b.x, riverBanks(b.x)[0] + 150);
      for (let t = 0; t < 1.5; t += STEP_SEC) stepSimulation(state, STEP_SEC);
      const sq = squadOf(state, p);
      const nodes = navGraph().nodes.filter((n) => n.reachable);
      let rs = seed * 99;
      const rnd = () => ((rs = (rs * 1103515245 + 12345) >>> 0) / 4294967296);
      const last = new Map(sq.map((f) => [f.id, { x: f.x, z: f.z, stuck: 0 }]));
      let worstStuck = 0;
      for (let leg = 0; leg < 4; leg++) {
        const cands = nodes.filter((n) => { const d = Math.hypot(n.x - p.x, n.z - p.z); return d > 400 && d < 900; });
        const route = planPath(p, cands[Math.floor(rnd() * cands.length)]);
        if (!route) continue;
        let i = 0;
        for (let t = 0; t < 25 && i < route.length; t += STEP_SEC) {
          const w = route[i], dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
          if (d < 14) { i++; continue; }
          p.dirX = dx / d; p.dirZ = dz / d; p.stamina = 100;
          state.input = { forward: 1, turn: 0, dash: leg % 2 === 0 };
          stepSimulation(state, STEP_SEC);
          for (const f of sq) {
            const l = last.get(f.id)!;
            const moved = Math.hypot(f.x - l.x, f.z - l.z);
            l.stuck = Math.hypot(f.x - p.x, f.z - p.z) > 130 && moved < 0.5 ? l.stuck + STEP_SEC : 0;
            l.x = f.x; l.z = f.z;
            worstStuck = Math.max(worstStuck, l.stuck);
          }
        }
        state.input = { forward: 0, turn: 0, dash: false };
        // Up to 15 s to rejoin (a long way round, e.g. up onto the palace grounds, takes a while).
        for (let t = 0; t < 15 && sq.some((f) => Math.hypot(f.x - p.x, f.z - p.z) > 150); t += STEP_SEC) stepSimulation(state, STEP_SEC);
        const gaps = sq.map((f) => Math.round(Math.hypot(f.x - p.x, f.z - p.z)));
        expect(Math.max(...gaps), `leg ${leg} gaps ${gaps}`).toBeLessThan(200);
      }
      expect(worstStuck).toBeLessThan(1.5);
    }, 120_000);
  }
});
