import { describe, expect, it } from 'vitest';
import type { Prim } from '../src/config/map';
import { BLOCKS, BRIDGES, SIGNALS, WORLD, riverBanks } from '../src/config/map';
import { planPath } from '../src/ai/nav';
import { settleBody, updatePlayerMovement } from '../src/sim/systems/movement';
import { inWater } from '../src/sim/systems/world';
import { streetPropSpots } from '../src/render/streetProps';
import { newGame } from './helpers';

const top = (p: Prim) => (p.kind === 'box' ? p.y1 : Math.max(p.hLow, p.hHigh));
const overlapXZ = (a: Prim, b: Prim, m = 2) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 - m && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - m;

describe('map: rivers and bridges', () => {
  it('standing on a low bridge deck over the river is dry (nobody is sent back to the bank)', () => {
    const state = newGame();
    const p = state.player;
    for (const b of BRIDGES) {
      p.x = b.x; p.z = b.z; p.y = 60;
      for (let i = 0; i < 60; i++) settleBody(p, 1 / 60);
      expect(inWater(p.x, p.z, p.y + 1)).toBe(false);
      expect(Math.hypot(p.x - b.x, p.z - b.z)).toBeLessThan(1);
    }
  });

  it('the player can walk across every bridge in both directions', () => {
    const state = newGame();
    const p = state.player;
    for (const b of BRIDGES) {
      const [south, north] = riverBanks(b.x);
      for (const [from, to] of [[south, north], [north, south]]) {
        p.x = p.prevX = b.x; p.z = p.prevZ = from; p.y = 0;
        const dir = Math.sign(to - from);
        p.dirX = 0; p.dirZ = dir;
        state.input = { forward: 1, turn: 0, dash: false };
        for (let i = 0; i < 600 && (to - p.z) * dir > 0; i++) {
          state.time += 16;
          updatePlayerMovement(state, 1 / 60);
          settleBody(p, 1 / 60);
          expect(inWater(p.x, p.z, p.y + 1)).toBe(false);
        }
        expect((to - p.z) * dir, `bridge at x=${Math.round(b.x)} from z=${Math.round(from)}`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('the AI finds a way over the river at every bridge', () => {
    for (const b of BRIDGES) {
      const [south, north] = riverBanks(b.x);
      const path = planPath({ x: b.x, y: 0, z: south }, { x: b.x, y: 0, z: north });
      expect(path, `bridge at x=${Math.round(b.x)}`).not.toBeNull();
      // It crosses here (not a long way round).
      expect(path!.every((q) => Math.abs(q.x - b.x) < 600)).toBe(true);
    }
  });
});

describe('map: nothing overlaps', () => {
  it('buildings, towers, expressways, bridges and footbridges do not run into each other', () => {
    const big = WORLD.filter((p) => ['bldg', 'glass', 'concrete', 'brick', 'stone', 'metal', 'steel'].includes(p.mat) && top(p) > 8 || p.group === 'bridge');
    const clash: string[] = [];
    for (let i = 0; i < big.length; i++) {
      for (let j = i + 1; j < big.length; j++) {
        const a = big[i], b = big[j];
        if (a.group && a.group === b.group) continue; // parts of one structure
        if (!a.group && !b.group && a.mat === b.mat && a.mat !== 'bldg') continue; // walls of one landmark
        if (!overlapXZ(a, b) || a.y0 >= top(b) || b.y0 >= top(a)) continue;
        clash.push(`${a.mat}:${a.group ?? ''}@(${Math.round(a.x)},${Math.round(a.z)}) × ${b.mat}:${b.group ?? ''}@(${Math.round(b.x)},${Math.round(b.z)})`);
      }
    }
    // Landmark grounds (palace, hills) carry their own ramps and buildings on top: allowed.
    expect(clash.filter((c) => !/palace|keep|hill|museum|tokyoTower|footTown|dietTower|walkup|arcade|stadium/.test(c))).toEqual([]);
  });

  it('traffic signals do not stand inside footbridge stairs', () => {
    const fb = WORLD.filter((p) => p.group === 'footbridge');
    for (const s of SIGNALS) expect(fb.some((p) => Math.abs(s.x - p.x) < p.w / 2 + 4 && Math.abs(s.z - p.z) < p.d / 2 + 4)).toBe(false);
  });

  it('street props stand on the pavement and touch nothing', () => {
    const spots = streetPropSpots();
    expect(spots.length).toBeGreaterThan(30);
    const solid = WORLD.filter((p) => p.mat !== 'sidewalk' && !(p.kind === 'box' && p.y1 <= 5 && p.mat !== 'water'));
    for (const s of spots) {
      expect(BLOCKS.some((b) => s.x0 >= b.x0 && s.x1 <= b.x1 && s.z0 >= b.z0 && s.z1 <= b.z1)).toBe(true);
      expect(solid.some((p) => s.x0 < p.x + p.w / 2 && s.x1 > p.x - p.w / 2 && s.z0 < p.z + p.d / 2 && s.z1 > p.z - p.d / 2)).toBe(false);
    }
  });
});
