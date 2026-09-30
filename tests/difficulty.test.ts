import { describe, expect, it } from 'vitest';
import * as C from '../src/config/constants';
import { AI_TUNING, CPU_LEVELS, tuning } from '../src/ai/difficulty';
import { STEP_SEC } from '../src/core/clock';
import { teleport } from '../src/sim/entity';
import { jailDuration } from '../src/sim/systems/jail';
import { stepSimulation } from '../src/sim/step';
import { find, freezeOthers, newGame, SPOT } from './helpers';

describe('CPU level (CPUレベル)', () => {
  it('easy < normal < hard in reaction, search, memory and teamwork', () => {
    const [e, n, h, x] = CPU_LEVELS.map((l) => AI_TUNING[l]);
    expect(CPU_LEVELS).toEqual(['easy', 'normal', 'hard', 'expert']);
    expect(x.reactionMs).toBeLessThan(h.reactionMs);
    expect(x.searchMs).toBeGreaterThan(h.searchMs);
    expect(x.strategyTickMs).toBeLessThan(h.strategyTickMs);
    expect(x.rescueExtra).toBeGreaterThan(h.rescueExtra);
    expect(x.kingHunt).toBeGreaterThan(h.kingHunt);
    expect(x.endgameSec).toBeGreaterThan(h.endgameSec);
    expect(e.endgameSec).toBe(0);
    expect(e.reactionMs).toBeGreaterThan(n.reactionMs);
    expect(n.reactionMs).toBeGreaterThan(h.reactionMs);
    expect(e.searchMs).toBeLessThan(n.searchMs);
    expect(n.searchMs).toBeLessThan(h.searchMs);
    expect(e.followUpMs).toBeLessThan(n.followUpMs);
    expect(n.followUpMs).toBeLessThan(h.followUpMs);
    expect(e.forgetMs).toBeLessThan(h.forgetMs);
    expect(e.flankChance).toBeLessThan(n.flankChance);
    expect(e.ambush).toBe('none');
    expect(h.ambush).toBe('rangersAndSoldiers');
    expect(e.sniperFireChance).toBeLessThan(1);
    expect(h.strategyTickMs).toBeLessThan(n.strategyTickMs);
    expect(e.strategyTickMs).toBeGreaterThan(n.strategyTickMs);
    expect(h.rescueExtra).toBeGreaterThan(n.rescueExtra);
  });

  it('標準 is the AI as it was (reaction 550 ms, search 6.5 s, follow-up 7 s)', () => {
    const state = newGame();
    expect(state.cpuLevel).toBe('normal');
    expect(tuning(state)).toMatchObject({ reactionMs: 550, searchMs: 6500, followUpMs: 7000, forgetMs: 20000, flankChance: 1, sniperFireChance: 1, strategyTickMs: 1000 });
  });

  it('an easy CPU is slower to react to the same enemy than a hard one', () => {
    const chaseAfter = (level: 'easy' | 'hard') => {
      const state = newGame('sun', 'soldier', 5, 6);
      state.cpuLevel = level;
      const hunter = find(state, 'moon', 'soldier');
      freezeOthers(state, [hunter]);
      state.player.stunUntil = Infinity;
      teleport(hunter, SPOT.x, SPOT.z);
      teleport(state.player, SPOT.x + 90, SPOT.z);
      hunter.dirX = 1; hunter.dirZ = 0;
      for (let t = 0; t < 2; t += STEP_SEC) {
        stepSimulation(state, STEP_SEC);
        if (hunter.ai.targetId === state.player.id) return t;
      }
      return Infinity;
    };
    const easy = chaseAfter('easy'), hard = chaseAfter('hard');
    expect(hard).toBeLessThan(easy);
  });

  it('the rules are the same on every level (no stat cheating)', () => {
    const rules = () => ({ vision: C.VISION, cap: C.CAP_RANGE, speed: C.AI_SPEED, sprint: C.SPRINT_SPEED, jail: C.JAIL_TIME, king: C.KING_JAIL_EXTRA });
    const base = rules();
    for (const level of CPU_LEVELS) {
      const state = newGame('sun', 'soldier', 1, 10);
      state.cpuLevel = level;
      expect(rules()).toEqual(base);
      const soldier = find(state, 'moon', 'soldier');
      expect(soldier.hp).toBe(3);
      expect(jailDuration(soldier)).toBe(C.JAIL_TIME);
    }
  });
});
