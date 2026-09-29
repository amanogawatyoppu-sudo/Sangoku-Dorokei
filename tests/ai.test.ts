import { describe, expect, it } from 'vitest';
import { AI_TURN_RATE, CR, GAME_TIME } from '../src/config/constants';
import { NATIONS } from '../src/config/nations';
import { STEP_SEC } from '../src/core/clock';
import { openMeeting } from '../src/meeting/meetingSystem';
import { teleport } from '../src/sim/entity';
import { sendToJail } from '../src/sim/systems/jail';
import { separate } from '../src/sim/systems/movement';
import { stepSimulation } from '../src/sim/step';
import type { GameState } from '../src/sim/state';
import { drainEvents } from '../src/sim/state';
import { SITES } from '../src/config/map';
import { find, freezeOthers, newGame, placeAtBase, runFrames } from './helpers';

const O = SITES.open;

function steps(state: GameState, sec: number) {
  for (let t = 0; t < sec; t += STEP_SEC) stepSimulation(state, STEP_SEC);
}

describe('AI movement', () => {
  it('snipers climb to a perch (stairs / slopes) on their own', () => {
    const state = newGame('star', 'communicator', 3);
    state.nextEventAt = Infinity;
    const sun = find(state, 'sun', 'sniper'), moon = find(state, 'moon', 'sniper');
    freezeOthers(state, [sun, moon]);
    let sunHigh = 0, moonHigh = 0;
    for (let t = 0; t < 60; t += 0.5) {
      steps(state, 0.5);
      sunHigh = Math.max(sunHigh, sun.y);
      moonHigh = Math.max(moonHigh, moon.y);
    }
    // Perches include 上野の山 (24) and 愛宕山 (28), not only rooftops.
    expect(sunHigh).toBeGreaterThan(20);
    expect(moonHigh).toBeGreaterThan(20);
  });

  it('never stays stuck on walls for long during full matches', () => {
    for (const seed of [11, 12, 13]) {
      const state = newGame('moon', 'keyholder', seed);
      state.player.stunUntil = Infinity;
      runFrames(state, 120_000);
      for (const e of state.entities) if (!e.isPlayer) expect(e.ai.maxStuckSec).toBeLessThan(5);
    }
  }, 30_000);

  it('keeps characters from stacking on the same spot', () => {
    const state = newGame();
    const [a, b, c] = [find(state, 'moon', 'soldier'), find(state, 'star', 'soldier'), find(state, 'sun', 'sniper')];
    for (const e of [a, b, c]) teleport(e, O.x, O.z);
    for (let i = 0; i < 20; i++) separate(state);
    for (const [p, q] of [[a, b], [a, c], [b, c]]) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(CR * 2 - 1);
  });
});

describe('AI turning', () => {
  it('AI bodies turn smoothly: never faster than the turn rate, even while chasing', () => {
    const state = newGame('sun', 'soldier', 31);
    state.player.stunUntil = Infinity;
    const limit = AI_TURN_RATE * STEP_SEC + 1e-6;
    let worst = 0;
    const prev = state.entities.map((e) => Math.atan2(e.dirX, e.dirZ));
    for (let i = 0; i < 60 * 40; i++) {
      stepSimulation(state, STEP_SEC);
      state.entities.forEach((e, k) => {
        const a = Math.atan2(e.dirX, e.dirZ);
        if (!e.isPlayer && e.alive && !e.jailed && e.stunUntil <= state.time) {
          worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(a - prev[k]), Math.cos(a - prev[k]))));
        }
        prev[k] = a;
      });
    }
    expect(worst).toBeLessThanOrEqual(limit);
  });
});

describe('AI pursuit', () => {
  function chaseSetup() {
    const state = newGame('sun', 'sniper', 5);
    state.nextEventAt = Infinity;
    const hunter = find(state, 'moon', 'soldier');
    freezeOthers(state, [hunter, state.player]);
    // One AI on its own (no commander sending it off on an operation).
    for (const n of ['sun', 'moon', 'star'] as const) state.factions[n].nextTickAt = Infinity;
    teleport(hunter, O.x, O.z + 180); // open plaza, clear line of sight
    hunter.dirX = 0;
    hunter.dirZ = -1;
    teleport(state.player, O.x, O.z - 170); // 350 in front of the hunter
    state.player.dirX = 0;
    state.player.dirZ = -1; // walking away
    return { state, hunter };
  }

  it('chases an enemy it can see', () => {
    const { state, hunter } = chaseSetup();
    steps(state, 0.9); // after the AI's reaction time
    expect(hunter.ai.state === 'CHASE' || hunter.ai.state === 'INTERCEPT').toBe(true);
    expect(hunter.ai.targetId).toBe(state.player.id);
  });

  it('when it loses sight, searches the last known position instead of giving up', () => {
    const { state, hunter } = chaseSetup();
    steps(state, 0.9); // after the AI's reaction time
    const last = { x: state.player.x, z: state.player.z };
    // The player vanishes behind the town (far and out of sight).
    teleport(state.player, NATIONS.star.base.x, NATIONS.star.base.z);
    state.player.stunUntil = Infinity;
    steps(state, 0.8);
    expect(hunter.ai.state).toBe('SEARCH');
    expect(Math.hypot(hunter.ai.searchCenter!.x - last.x, hunter.ai.searchCenter!.z - last.z)).toBeLessThan(200);
  });

  it('several chasers split into different roles (not one conga line)', () => {
    const state = newGame('sun', 'sniper', 8);
    state.nextEventAt = Infinity;
    const hunters = [find(state, 'moon', 'soldier'), find(state, 'moon', 'ranger')];
    freezeOthers(state, [...hunters, state.player]);
    teleport(hunters[0], O.x, O.z + 200);
    teleport(hunters[1], O.x + 60, O.z + 220);
    for (const h of hunters) { h.dirX = 0; h.dirZ = -1; }
    teleport(find(state, 'moon', 'king'), O.x + 40, O.z + 250); // the escort's king is right here
    teleport(state.player, O.x, O.z + 30);
    state.player.dirX = 0;
    state.player.dirZ = -1;
    // Both have already noticed the player (reaction time spent).
    const p = state.player;
    for (const h of hunters) {
      h.ai.seen.set(p.id, { id: p.id, x: p.x, y: p.y, z: p.z, t: state.time, vx: 0, vz: 0, since: state.time - 1000 });
      h.ai.visible = [p.id];
    }
    const chasing = () => hunters.every((h) => h.ai.state === 'CHASE' || h.ai.state === 'INTERCEPT');
    for (let t = 0; t < 1.5 && !chasing(); t += 0.05) steps(state, 0.05);
    expect(chasing()).toBe(true);
    const roles = hunters.map((h) => h.ai.chaseRole);
    expect(new Set(roles).size).toBe(2);
    expect(Math.hypot(hunters[0].ai.goal!.x - hunters[1].ai.goal!.x, hunters[0].ai.goal!.z - hunters[1].ai.goal!.z)).toBeGreaterThan(60);
  });
});

describe('kingdom commanders', () => {
  it('a king capture turns the victim to rescue, the captor to defence, the third nation opportunist', () => {
    const state = newGame('star', 'communicator', 4, 15);
    state.nextEventAt = Infinity;
    const sunKing = find(state, 'sun', 'king');
    sendToJail(state, sunKing, 'moon', find(state, 'moon', 'soldier'));
    steps(state, 1.2);
    expect(state.factions.sun.posture).toBe('RESCUE_KING');
    expect(state.factions.moon.posture).toBe('HOLD_KING');
    expect(state.factions.star.posture).toBe('OPPORTUNIST');
    expect(find(state, 'sun', 'keyholder').ai.task).toEqual({ kind: 'rescueKing', jail: 'moon' });
    const sunTasks = state.entities.filter((e) => e.nation === 'sun' && !e.jailed).map((e) => e.ai.task?.kind);
    expect(sunTasks.filter((k) => k === 'rescueEscort').length).toBeGreaterThanOrEqual(2);
    expect(find(state, 'sun', 'ranger').ai.task).toEqual({ kind: 'rescueEscort', jail: 'moon' }); // rangers rush to help
    const moonTasks = state.entities.filter((e) => e.nation === 'moon').map((e) => e.ai.task?.kind);
    expect(moonTasks.filter((k) => k === 'guardJail').length).toBeGreaterThanOrEqual(2);
    const starTasks = state.entities.filter((e) => e.nation === 'star' && !e.isPlayer).map((e) => e.ai.task?.kind);
    expect(starTasks).toContain('raidJail');
    // Everyone can see the jail fight for a while.
    expect(state.jailReveal.moon).toBeGreaterThan(state.time);
  });

  it('the rescue force actually converges on the captor jail', () => {
    const state = newGame('star', 'communicator', 6);
    state.nextEventAt = Infinity;
    const sunKing = find(state, 'sun', 'king');
    sendToJail(state, sunKing, 'moon', null);
    const kh = find(state, 'sun', 'keyholder');
    const j = NATIONS.moon.jail;
    const d0 = Math.hypot(kh.x - j.x, kh.z - j.z);
    steps(state, 8);
    expect(Math.hypot(kh.x - j.x, kh.z - j.z)).toBeLessThan(d0 - 1000);
  });

  it('kings get escorts, and more of them right after an ally is captured', () => {
    const state = newGame('star', 'communicator', 9);
    state.nextEventAt = Infinity;
    steps(state, 1.1);
    const escorts = () => state.entities.filter((e) => e.nation === 'sun' && e.ai.task?.kind === 'escortKing').length;
    expect(escorts()).toBe(1);
    sendToJail(state, find(state, 'sun', 'sniper'), 'moon', null);
    steps(state, 0.1);
    expect(escorts()).toBe(2);
  });
});

describe('meeting pause (whole world)', () => {
  it('AI, movement and timers all stop while a meeting is open', () => {
    const state = newGame('sun', 'soldier', 2);
    runFrames(state, 5000);
    placeAtBase(state.player);
    openMeeting(state);
    const snap = state.entities.map((e) => [e.x, e.y, e.z, e.ai.state]);
    const t = state.time;
    runFrames(state, 20000);
    expect(state.time).toBe(t);
    expect(state.entities.map((e) => [e.x, e.y, e.z, e.ai.state])).toEqual(snap);
  });
});

describe('full match', () => {
  it('produces chases, captures and rescues with three-way fighting', () => {
    const state = newGame('star', 'communicator', 21);
    state.player.stunUntil = Infinity;
    const pairs = new Set<string>();
    let chaseSec = 0;
    for (let t = 0; t < GAME_TIME && !state.over; t++) {
      runFrames(state, 1000);
      for (const ev of drainEvents(state)) {
        if (ev.type === 'JAILED') pairs.add(ev.capNation + '>' + state.entities[ev.entityId].nation);
      }
      chaseSec += state.entities.filter((e) => e.ai.state === 'CHASE' || e.ai.state === 'INTERCEPT').length;
    }
    expect(chaseSec).toBeGreaterThan(20);
    expect(pairs.size).toBeGreaterThanOrEqual(3); // more than one front
  }, 30_000);
});
