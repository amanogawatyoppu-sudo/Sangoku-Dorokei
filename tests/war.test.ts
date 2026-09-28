import { describe, expect, it } from 'vitest';
import { STEP_SEC } from '../src/core/clock';
import { NATIONS } from '../src/config/nations';
import { attackTarget, decideNormal, NO_STRATEGY } from '../src/ai/strategy';
import { teleport } from '../src/sim/entity';
import type { Entity } from '../src/sim/entity';
import { stepSimulation } from '../src/sim/step';
import type { GameState } from '../src/sim/state';
import { attemptCapture, captureCandidate } from '../src/sim/systems/capture';
import { eliminate, sendToJail } from '../src/sim/systems/jail';
import { forceEndByTime } from '../src/sim/systems/winCondition';
import {
  CAPTURE_SEC, CENTRAL, SECTORS, TRUCE_MS, answerTruce, atWar, frontPairs, held, isFrontline, neighbours, noteClash,
  proposeTruce, sectorAt, sectorPoint, trucesLeft, warTick,
} from '../src/sim/war';
import { find, newGame } from './helpers';

const byName = (name: string) => SECTORS.find((s) => s.name === name)!.id;

/** Everyone out of the way (far off, stunned), so only the people a test places matter. */
function quiet(state: GameState): void {
  state.nextEventAt = Infinity;
  state.nextMeetingAt = Infinity;
  for (const e of state.entities) { e.stunUntil = Infinity; teleport(e, NATIONS[e.nation].base.x, NATIONS[e.nation].base.z); }
  for (const n of ['sun', 'moon', 'star'] as const) state.factions[n].nextTickAt = Infinity;
}

function standOn(e: Entity, id: number, dx = 0): void {
  const p = sectorPoint(id);
  teleport(e, p.x + dx, p.z, p.y);
}

const tick = (state: GameState, sec: number) => { for (let t = 0; t < sec; t += 0.1) { state.time += 100; warTick(state, 0.1); } };

describe('sectors (戦区)', () => {
  it('nine sectors cover the loop; each nation starts with its home ground, the centre neutral', () => {
    const state = newGame();
    expect(SECTORS.length).toBe(9);
    expect(held(state, 'sun').length).toBe(3); // 新宿・渋谷・池袋 (the most exposed nation gets a rear to the north)
    for (const n of ['sun', 'moon', 'star'] as const) {
      expect(held(state, n).length).toBeGreaterThanOrEqual(2);
      expect(state.war.sectors[sectorAt(NATIONS[n].base.x, NATIONS[n].base.z)].owner).toBe(n);
    }
    expect(state.war.sectors[CENTRAL].owner).toBeNull();
    // The centre can be reached from every nation's ground.
    for (const n of ['sun', 'moon', 'star'] as const) expect(held(state, n).some((id) => neighbours(CENTRAL).has(id))).toBe(true);
  });

  it('a point is taken only by standing on it unopposed for a while', () => {
    const state = newGame('sun', 'soldier');
    quiet(state);
    const a = find(state, 'moon', 'soldier');
    a.stunUntil = 0;
    standOn(a, CENTRAL);
    tick(state, 1);
    expect(state.war.sectors[CENTRAL].owner).toBeNull(); // not in a moment
    expect(state.war.sectors[CENTRAL].capturer).toBe('moon');
    tick(state, CAPTURE_SEC);
    expect(state.war.sectors[CENTRAL].owner).toBe('moon');
    expect(state.events.some((e) => e.type === 'SECTOR_CAPTURED' && e.sector === CENTRAL && e.nation === 'moon')).toBe(true);
  });

  it('two nations on a point: CONTESTED, and the gauge stops', () => {
    const state = newGame('sun', 'soldier');
    quiet(state);
    const a = find(state, 'moon', 'soldier'), b = find(state, 'star', 'soldier');
    standOn(a, CENTRAL);
    tick(state, 4);
    const g = state.war.sectors[CENTRAL].progress;
    standOn(b, CENTRAL, 60);
    tick(state, 20);
    expect(state.war.sectors[CENTRAL].contested).toBe(true);
    expect(state.war.sectors[CENTRAL].owner).toBeNull();
    expect(state.war.sectors[CENTRAL].progress).toBeCloseTo(g, 5);
    expect(state.events.some((e) => e.type === 'SECTOR_CONTESTED' && e.sector === CENTRAL)).toBe(true);
  });

  it('an enemy sector changes hands; the holder standing on it pushes the gauge back', () => {
    const state = newGame('sun', 'soldier');
    quiet(state);
    const akiba = byName('秋葉原');
    const attacker = find(state, 'sun', 'sniper');
    standOn(attacker, akiba);
    tick(state, CAPTURE_SEC * 0.5);
    expect(state.war.sectors[akiba].capturer).toBe('sun');
    const p1 = state.war.sectors[akiba].progress;
    // The owner comes back alone: sun leaves, moon stands on it.
    teleport(attacker, NATIONS.sun.base.x, NATIONS.sun.base.z);
    standOn(find(state, 'moon', 'sniper'), akiba);
    tick(state, 2);
    expect(state.war.sectors[akiba].progress).toBeLessThan(p1);
    teleport(find(state, 'moon', 'sniper'), NATIONS.moon.base.x, NATIONS.moon.base.z);
    standOn(attacker, akiba);
    tick(state, CAPTURE_SEC * 1.2);
    expect(state.war.sectors[akiba].owner).toBe('sun');
    expect(state.events.some((e) => e.type === 'SECTOR_CAPTURED' && e.nation === 'sun' && e.from === 'moon')).toBe(true);
  });

  it('fronts: touching sectors of two different nations', () => {
    const state = newGame();
    const pairs = frontPairs(state);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [a, b] of pairs) {
      expect(state.war.sectors[a].owner).not.toBe(state.war.sectors[b].owner);
      expect(isFrontline(state, a) && isFrontline(state, b)).toBe(true);
    }
    // The neutral centre is never a front by itself.
    expect(isFrontline(state, CENTRAL)).toBe(false);
    // Taking the centre makes it one.
    state.war.sectors[CENTRAL].owner = 'moon';
    expect(isFrontline(state, CENTRAL)).toBe(true);
  });

  it('territory never decides the match: holding every sector does not win', () => {
    const state = newGame();
    for (const s of state.war.sectors) s.owner = 'star';
    for (let i = 0; i < 600; i++) stepSimulation(state, STEP_SEC);
    expect(state.over).toBe(false);
    // At time-up, kings and the old score decide, not sectors.
    const a = newGame(), b = newGame();
    for (const s of b.war.sectors) s.owner = 'moon';
    forceEndByTime(a);
    forceEndByTime(b);
    expect(b.winner).toBe(a.winner);
  });

  it('kings still decide: the last kingdom with a king wins', () => {
    const state = newGame();
    eliminate(state, find(state, 'sun', 'king'));
    expect(state.over).toBe(false);
    eliminate(state, find(state, 'moon', 'king'));
    expect(state.over).toBe(true);
    expect(state.winner).toBe('star');
  });
});

describe('national strategy (国家戦略)', () => {
  it('attacks a sector next to its own territory (or the centre)', () => {
    const state = newGame();
    for (const n of ['sun', 'moon', 'star'] as const) {
      const t = attackTarget(state, n, null)!;
      expect(t).not.toBeNull();
      expect(state.war.sectors[t.sector].owner).not.toBe(n);
      expect(t.sector === CENTRAL || held(state, n).some((id) => neighbours(t.sector).has(id))).toBe(true);
    }
  });

  it('defends a sector under attack first', () => {
    const state = newGame();
    const shinjuku = byName('新宿');
    state.war.sectors[shinjuku].capturer = 'star';
    state.war.sectors[shinjuku].progress = 0.5;
    const st = decideNormal(state, 'sun', NO_STRATEGY);
    expect(st.kind).toBe('DEFEND_SECTOR');
    expect(st.sector).toBe(shinjuku);
  });

  it('a third nation judges for itself: while two fight, it hits the one losing', () => {
    let picked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = newGame('sun', 'soldier', seed);
      // Star holds the centre; moon and sun are locked in a fight, and moon is losing (people in jail).
      state.war.sectors[CENTRAL].owner = 'star';
      for (let i = 0; i < 8; i++) noteClash(state, sectorPoint(byName('秋葉原')), 'moon', 'sun');
      for (const e of state.entities.filter((x) => x.nation === 'moon' && x.role !== 'king').slice(0, 3)) sendToJail(state, e, 'sun', null);
      const t = attackTarget(state, 'star', null);
      if (t?.enemy === 'moon') picked++;
    }
    expect(picked).toBeGreaterThan(10); // mostly, not always (it weighs other things too)
  });

  it('a captured king: victim RESCUE_KING, captor HOLD_KING, the third OPPORTUNIST', () => {
    const state = newGame('sun', 'communicator', 3, 15);
    state.nextEventAt = Infinity;
    state.nextMeetingAt = Infinity;
    sendToJail(state, find(state, 'moon', 'king'), 'star', null);
    for (let i = 0; i < 90; i++) stepSimulation(state, STEP_SEC);
    expect(state.factions.moon.strategy.kind).toBe('RESCUE_KING');
    expect(state.factions.star.strategy.kind).toBe('HOLD_KING');
    expect(state.factions.sun.strategy.kind).toBe('OPPORTUNIST');
    // The captor keeps part of its force on the front, not everyone at the jail.
    const star = state.entities.filter((e) => e.nation === 'star' && e.ai.task);
    expect(star.some((e) => e.ai.task!.kind === 'guardJail')).toBe(true);
    expect(star.some((e) => e.ai.task!.kind !== 'guardJail')).toBe(true);
  });

  it('commanders send people onto the war: attackers, overwatch snipers, keyholders on standby', () => {
    const state = newGame('sun', 'soldier', 5, 15);
    state.nextEventAt = Infinity;
    state.nextMeetingAt = Infinity;
    for (let i = 0; i < 90; i++) stepSimulation(state, STEP_SEC);
    const moon = state.entities.filter((e) => e.nation === 'moon');
    const kinds = new Set(moon.map((e) => e.ai.task?.kind));
    expect(kinds.has('assault') || kinds.has('defend') || kinds.has('takeTower')).toBe(true);
    expect(moon.filter((e) => e.role === 'sniper').every((e) => e.ai.task?.kind === 'overwatch')).toBe(true);
  });
});

describe('ceasefire (一時停戦)', () => {
  function dominated(state: GameState): void {
    // Star is far ahead: two extra sectors and the tower.
    state.war.sectors[CENTRAL].owner = 'star';
    state.war.sectors[byName('文京')].owner = 'star';
    state.war.sectors[byName('池袋')].owner = 'star';
    state.tower.owner = 'star';
  }

  it('the two weaker nations agree to stop capturing each other for a while', () => {
    const state = newGame('star', 'soldier');
    dominated(state);
    expect(proposeTruce(state, 'moon', 'sun')).toBe(true);
    expect(atWar(state, 'moon', 'sun')).toBe(false);
    expect(atWar(state, 'moon', 'star')).toBe(true);
    expect(state.events.some((e) => e.type === 'TRUCE_STARTED')).toBe(true);
    // No captures between them while it lasts…
    const a = find(state, 'sun', 'soldier'), t = find(state, 'moon', 'sniper');
    teleport(t, 0, 0); t.dirX = 0; t.dirZ = 1;
    teleport(a, 0, -40); // right behind
    expect(captureCandidate(state, a)).toBeNull();
    attemptCapture(state, a);
    expect(t.jailed).toBe(false);
    // …and back to normal after it ends.
    state.time += TRUCE_MS + 100;
    warTick(state, 0.2);
    expect(atWar(state, 'moon', 'sun')).toBe(true);
    expect(state.events.some((e) => e.type === 'TRUCE_ENDED')).toBe(true);
    a.cd.capture = 0;
    attemptCapture(state, a);
    expect(t.jailed).toBe(true);
  });

  it('is refused when nobody is dominating, and limited per match', () => {
    const state = newGame('star', 'soldier');
    proposeTruce(state, 'moon', 'sun');
    expect(atWar(state, 'moon', 'sun')).toBe(true);
    expect(state.events.some((e) => e.type === 'TRUCE_DECLINED')).toBe(true);
    dominated(state);
    proposeTruce(state, 'moon', 'sun');
    state.time += TRUCE_MS + 100;
    warTick(state, 0.2);
    proposeTruce(state, 'moon', 'sun');
    state.time += TRUCE_MS + 100;
    warTick(state, 0.2);
    expect(trucesLeft(state)).toBe(0);
    expect(proposeTruce(state, 'moon', 'sun')).toBe(false);
  });

  it('an offer to the player waits for an answer (no answer = no)', () => {
    const state = newGame('sun', 'soldier');
    dominated(state);
    proposeTruce(state, 'moon', 'sun');
    expect(state.war.proposal).not.toBeNull();
    expect(atWar(state, 'moon', 'sun')).toBe(true);
    answerTruce(state, true);
    expect(atWar(state, 'moon', 'sun')).toBe(false);
    const other = newGame('sun', 'soldier');
    dominated(other);
    proposeTruce(other, 'moon', 'sun');
    tick(other, 13);
    expect(other.war.proposal).toBeNull();
    expect(atWar(other, 'moon', 'sun')).toBe(true);
  });

  it('AI in a ceasefire does not chase its partner', async () => {
    const { canPerceive } = await import('../src/ai/perception');
    const state = newGame('star', 'soldier');
    dominated(state);
    proposeTruce(state, 'moon', 'sun');
    const a = find(state, 'sun', 'soldier'), t = find(state, 'moon', 'sniper');
    teleport(a, 0, 0); a.dirX = 0; a.dirZ = 1;
    teleport(t, 0, 60);
    expect(canPerceive(state, a, t)).toBe(false);
  });
});
