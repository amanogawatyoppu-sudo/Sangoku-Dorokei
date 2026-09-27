import { beforeEach, describe, expect, it } from 'vitest';
import { NATIONS } from '../src/config/nations';
import { CAPTURE_CD } from '../src/config/roles';
import { KING_RESCUE_ALERT_TIME, KING_REVEAL_TIME } from '../src/config/constants';
import type { Entity } from '../src/sim/entity';
import { teleport } from '../src/sim/entity';
import type { GameState } from '../src/sim/state';
import { attemptCapture, captureTier } from '../src/sim/systems/capture';
import { SPOT, find, newGame } from './helpers';


function face(e: Entity, dirX: number, dirZ: number) {
  e.dirX = dirX;
  e.dirZ = dirZ;
}

describe('captureTier', () => {
  let state: GameState;
  beforeEach(() => { state = newGame(); });

  it('classifies attacker position relative to the target facing', () => {
    const t = find(state, 'moon', 'sniper'), a = find(state, 'sun', 'soldier');
    teleport(t, SPOT.x, SPOT.z);
    face(t, 0, 1);
    teleport(a, SPOT.x, SPOT.z + 50);
    expect(captureTier(t, a)).toBe('front');
    teleport(a, SPOT.x + 50, SPOT.z);
    expect(captureTier(t, a)).toBe('side');
    teleport(a, SPOT.x + 40, SPOT.z - 40);
    expect(captureTier(t, a)).toBe('back');
    teleport(a, SPOT.x, SPOT.z - 50);
    expect(captureTier(t, a)).toBe('deepback');
  });
});

describe('attemptCapture', () => {
  let state: GameState, attacker: Entity, target: Entity;
  beforeEach(() => {
    state = newGame('sun', 'soldier');
    attacker = find(state, 'sun', 'soldier');
    target = find(state, 'moon', 'sniper');
    teleport(target, SPOT.x, SPOT.z);
    face(target, 0, 1);
  });

  it('captures from behind and sends the target to the capturer’s jail', () => {
    teleport(attacker, SPOT.x, SPOT.z - 50);
    attemptCapture(state, attacker);
    expect(target.jailed).toBe(true);
    expect(target.capturedBy).toBe('sun');
    expect(target.jailedAt).toBe(state.time);
    const j = NATIONS.sun.jail;
    expect(Math.abs(target.x - j.x)).toBeLessThanOrEqual(20);
    expect(Math.abs(target.z - j.z)).toBeLessThanOrEqual(5);
    expect(attacker.capturesMade).toBe(1);
    expect(state.natStats.sun.cap).toBe(1);
    const types = state.events.map((e) => e.type);
    expect(types).toContain('CAPTURE');
    expect(types).toContain('JAILED');
  });

  it('cannot capture from the front, but the cooldown is still spent', () => {
    teleport(attacker, SPOT.x, SPOT.z + 50);
    attemptCapture(state, attacker);
    expect(target.jailed).toBe(false);
    expect(attacker.cd.capture).toBe(CAPTURE_CD);
  });

  it('does nothing while on cooldown or out of range', () => {
    teleport(attacker, SPOT.x, SPOT.z - 50);
    attacker.cd.capture = 0.5;
    attemptCapture(state, attacker);
    expect(target.jailed).toBe(false);
    attacker.cd.capture = 0;
    teleport(attacker, SPOT.x, SPOT.z - 200);
    attemptCapture(state, attacker);
    expect(target.jailed).toBe(false);
  });

  it('a soldier endures hits until its last hp', () => {
    const soldier = find(state, 'moon', 'soldier');
    teleport(soldier, SPOT.x + 300, SPOT.z);
    face(soldier, 0, 1);
    teleport(attacker, SPOT.x + 300, SPOT.z - 50);
    attemptCapture(state, attacker);
    expect(soldier.hp).toBe(2);
    expect(soldier.jailed).toBe(false);
    attacker.cd.capture = 0;
    attemptCapture(state, attacker);
    expect(soldier.hp).toBe(1);
    attacker.cd.capture = 0;
    attemptCapture(state, attacker);
    expect(soldier.jailed).toBe(true);
    expect(soldier.hp).toBe(3);
  });

  it('capturing a king reveals it and triggers the rescue alert', () => {
    const king = find(state, 'moon', 'king');
    teleport(king, SPOT.x, SPOT.z);
    face(king, 0, 1);
    king.cd.dodge = 99; // disable the random dodge
    teleport(target, SPOT.x + 400, SPOT.z);
    teleport(attacker, SPOT.x, SPOT.z - 50);
    attemptCapture(state, attacker);
    expect(king.jailed).toBe(true);
    expect(king.revealUntil).toBe(state.time + KING_REVEAL_TIME);
    expect(state.rescueUntil.moon).toBe(state.time + KING_RESCUE_ALERT_TIME);
    expect(attacker.kingCaptures).toBe(1);
    expect(state.events.map((e) => e.type)).toContain('KING_CAPTURED');
  });
});
