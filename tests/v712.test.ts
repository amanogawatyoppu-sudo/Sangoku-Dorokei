import { describe, expect, it } from 'vitest';
import { STEP_SEC } from '../src/core/clock';
import { SPRINT_TIME, STAMINA_MAX } from '../src/config/constants';
import { ROSTERS, SPECIAL_CD } from '../src/config/roles';
import { nameOf } from '../src/config/names';
import { NATIONS } from '../src/config/nations';
import { chokePoints, navGraph } from '../src/ai/nav';
import { groundAt } from '../src/sim/systems/world';
import { VOTE_CALL } from '../src/meeting/dialogue';
import { openScheduledMeeting, sayInMeeting, updateMeeting, voteInMeeting } from '../src/meeting/meetingSystem';
import { teleport } from '../src/sim/entity';
import { stepSimulation } from '../src/sim/step';
import type { GameState } from '../src/sim/state';
import { activate } from '../src/sim/systems/abilities';
import { attemptCapture } from '../src/sim/systems/capture';
import { eliminate, sendToJail } from '../src/sim/systems/jail';
import { climbMul, updatePlayerMovement } from '../src/sim/systems/movement';
import { SPOT, find, freezeOthers, newGame } from './helpers';

const walk = (state: GameState, sec: number) => {
  for (let t = 0; t < sec; t += STEP_SEC) { state.time += STEP_SEC * 1000; updatePlayerMovement(state, STEP_SEC); }
};

describe('遊撃兵 (ranger)', () => {
  it('replaces the impostor in every roster', () => {
    for (const r of Object.values(ROSTERS)) {
      expect(r).toContain('ranger');
      expect(r as readonly string[]).not.toContain('impostor');
    }
  });

  it('疾走: faster for 4.5 s, then a 16 s cooldown', () => {
    const plain = newGame('sun', 'ranger'), fast = newGame('sun', 'ranger');
    for (const s of [plain, fast]) {
      teleport(s.player, SPOT.x, SPOT.z);
      s.player.dirX = 0; s.player.dirZ = -1;
      s.input = { forward: 1, turn: 0, dash: false };
    }
    activate(fast, fast.player);
    expect(fast.player.cd.special).toBe(SPECIAL_CD.ranger);
    expect(fast.player.sprintUntil - fast.time).toBe(SPRINT_TIME);
    const z0 = plain.player.z;
    walk(plain, 1);
    walk(fast, 1);
    expect((z0 - fast.player.z) / (z0 - plain.player.z)).toBeGreaterThan(1.2);
  });

  it('gets stamina back faster than a soldier', () => {
    const r = newGame('sun', 'ranger'), s = newGame('sun', 'soldier');
    for (const g of [r, s]) { g.player.stamina = 0; g.input = { forward: 0, turn: 0, dash: false }; walk(g, 2); }
    expect(r.player.stamina).toBeGreaterThan(s.player.stamina * 1.5);
    expect(r.player.stamina).toBeLessThanOrEqual(STAMINA_MAX);
  });

  it('hardly slows on stairs and slopes (others do)', () => {
    expect(chokePoints().length).toBeGreaterThan(20);
    const { nodes } = navGraph();
    const c = nodes.find((n) => n.reachable && n.edges.some((id) => nodes[id].y > n.y + 6 && nodes[id].y < n.y + 40))!;
    const up = nodes[c.edges.find((id) => nodes[id].y > c.y + 6 && nodes[id].y < c.y + 40)!];
    const l = Math.hypot(up.x - c.x, up.z - c.z);
    let soldier = 1, ranger = 1;
    // Walk up toward the higher node until the floor starts rising.
    for (let k = 2; k < l && soldier === 1; k += 2) {
      const x = c.x + ((up.x - c.x) / l) * (k - 2), z = c.z + ((up.z - c.z) / l) * (k - 2);
      const nx = c.x + ((up.x - c.x) / l) * k, nz = c.z + ((up.z - c.z) / l) * k;
      const y = groundAt(x, z, c.y + 5);
      soldier = climbMul({ x, y, z, role: 'soldier' }, nx, nz);
      ranger = climbMul({ x, y, z, role: 'ranger' }, nx, nz);
    }
    expect(soldier).toBeLessThan(0.9);
    expect(ranger).toBeGreaterThan(0.9);
  });

  it('AI rangers rush to a fight', () => {
    const state = newGame('star', 'communicator', 2, 10);
    state.nextEventAt = Infinity;
    state.nextMeetingAt = Infinity;
    const r = find(state, 'sun', 'ranger');
    freezeOthers(state, [r]);
    teleport(r, SPOT.x, SPOT.z);
    state.factions.sun.fight = { x: SPOT.x + 900, y: 0, z: SPOT.z, t: state.time };
    for (let t = 0; t < 3; t += STEP_SEC) stepSimulation(state, STEP_SEC);
    expect(r.ai.goal).not.toBeNull();
    expect(Math.hypot(r.x - SPOT.x - 900, r.z - SPOT.z)).toBeLessThan(900 - 500); // well on the way (it sprints)
  });
});

describe('王のスーパーハンド', () => {
  it('a king catches face to face, every time', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = newGame('sun', 'king', seed);
      const king = state.player, t = find(state, 'moon', 'sniper');
      teleport(t, SPOT.x, SPOT.z); t.dirX = 0; t.dirZ = 1;
      teleport(king, SPOT.x, SPOT.z + 40); king.dirX = 0; king.dirZ = -1; // right in front of it
      attemptCapture(state, king);
      expect(t.jailed).toBe(true);
    }
  });

  it('others still can\'t catch from the front', () => {
    const state = newGame('sun', 'soldier');
    const a = state.player, t = find(state, 'moon', 'sniper');
    teleport(t, SPOT.x, SPOT.z); t.dirX = 0; t.dirZ = 1;
    teleport(a, SPOT.x, SPOT.z + 40);
    attemptCapture(state, a);
    expect(t.jailed).toBe(false);
  });
});

describe('a kingdom whose king is executed', () => {
  it('is out: all its people are executed and its prisoners go free', () => {
    const state = newGame('star', 'soldier');
    const prisoner = find(state, 'sun', 'soldier');
    sendToJail(state, prisoner, 'moon', null);
    const moonKing = find(state, 'moon', 'king');
    sendToJail(state, moonKing, 'star', null);
    eliminate(state, moonKing);
    expect(state.entities.filter((e) => e.nation === 'moon').every((e) => !e.alive)).toBe(true);
    expect(state.events.some((e) => e.type === 'NATION_FALLEN' && e.nation === 'moon')).toBe(true);
    expect(prisoner.jailed).toBe(false);
    expect(prisoner.alive).toBe(true);
    expect(Math.hypot(prisoner.x - NATIONS.sun.base.x, prisoner.z - NATIONS.sun.base.z)).toBeLessThan(80);
    expect(state.over).toBe(false); // two kingdoms left
  });
});

describe('meeting talk', () => {
  it('teammates speak one at a time, by name, and answer the player', () => {
    const state = newGame('sun', 'soldier', 4, 10);
    openScheduledMeeting(state);
    const m = state.meeting!;
    const before = m.lines.length;
    updateMeeting(state, 500);
    expect(m.lines.length).toBe(before); // nobody has spoken yet
    updateMeeting(state, 3000);
    expect(m.lines.length).toBeGreaterThan(before);
    const mates = state.entities.filter((e) => e.nation === 'sun' && !e.isPlayer).map((e) => nameOf(e.id));
    expect(m.lines.slice(before).some((l) => mates.some((n) => l.startsWith(n)))).toBe(true);
    const n0 = m.lines.length;
    sayInMeeting(state, m.choices[1]);
    expect(m.lines[n0]).toBe(`あなた「${m.choices[1]}」`);
    updateMeeting(state, 1000);
    expect(m.lines.length).toBeGreaterThan(n0 + 1); // someone answered
    voteInMeeting(state, 0);
    expect(m.script.some((l) => l.includes(VOTE_CALL))).toBe(false);
    updateMeeting(state, 25000);
    expect(m.script.length).toBe(0);
  });

  it('names are distinct across a full match', () => {
    const state = newGame('sun', 'soldier', 1, 15);
    expect(new Set(state.entities.map((e) => nameOf(e.id))).size).toBe(state.entities.length);
  });
});

describe('water', () => {
  it('someone who falls into the river climbs out onto a bank instead of being stuck', async () => {
    const { SITES } = await import('../src/config/map');
    const { settleBody } = await import('../src/sim/systems/movement');
    const { inWater } = await import('../src/sim/systems/world');
    const state = newGame();
    const p = state.player;
    // Straight down into the river (as if off a bridge).
    p.x = SITES.riverBank.x; p.z = SITES.riverZ(SITES.riverBank.x); p.y = 60;
    expect(inWater(p.x, p.z, 1)).toBe(true);
    for (let i = 0; i < 120; i++) settleBody(p, 1 / 60);
    expect(inWater(p.x, p.z, p.y + 1)).toBe(false);
    // And can walk again.
    const x0 = p.x, z0 = p.z;
    state.input = { forward: 1, turn: 0, dash: false };
    for (let a = 0; a < 8 && Math.hypot(p.x - x0, p.z - z0) < 20; a++) {
      p.dirX = Math.sin(a * 0.8); p.dirZ = Math.cos(a * 0.8);
      for (let i = 0; i < 30; i++) { state.time += 16; updatePlayerMovement(state, 1 / 60); }
    }
    expect(Math.hypot(p.x - x0, p.z - z0)).toBeGreaterThan(20);
  });
});
