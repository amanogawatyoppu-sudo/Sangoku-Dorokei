import { describe, expect, it } from 'vitest';
import { PLAYER_QUICK_TURN_RATE, PLAYER_TURN_RATE } from '../src/config/constants';
import { STEP_SEC } from '../src/core/clock';
import { teleport } from '../src/sim/entity';
import { openMeeting } from '../src/meeting/meetingSystem';
import { queueCommand } from '../src/sim/state';
import { captureCandidate, captureTier } from '../src/sim/systems/capture';
import { BACKWARD_FACTOR, turnBy, turnToward } from '../src/sim/systems/movement';
import { stepSimulation } from '../src/sim/step';
import { SPOT, find, freezeOthers, newGame, placeAtBase } from './helpers';

const angle = (x: number, z: number) => Math.atan2(x, z);
const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function setup() {
  const state = newGame('sun', 'soldier');
  state.nextEventAt = Infinity;
  freezeOthers(state, [state.player]);
  teleport(state.player, SPOT.x, SPOT.z);
  state.player.dirX = 0;
  state.player.dirZ = 1;
  return state;
}

function steps(state: ReturnType<typeof setup>, n: number) {
  for (let i = 0; i < n; i++) stepSimulation(state, STEP_SEC);
}

describe('turn helpers', () => {
  it('turnToward turns by at most maxRad and reports when aligned', () => {
    const e = { dirX: 0, dirZ: 1 };
    expect(turnToward(e, 1, 0, 0.1)).toBe(false);
    expect(angle(e.dirX, e.dirZ)).toBeCloseTo(0.1, 6);
    expect(turnToward(e, 1, 0, 10)).toBe(true);
    expect(angle(e.dirX, e.dirZ)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('turnBy: positive is a right (clockwise from above) turn', () => {
    const e = { dirX: 0, dirZ: 1 };
    turnBy(e, Math.PI / 2);
    expect(e.dirX).toBeCloseTo(-1, 9); // facing +z, right is -x (see camera tests)
  });
});

describe('player controls (character-relative)', () => {
  it('A/D turn smoothly at the turn rate, not instantly', () => {
    const state = setup();
    state.input = { forward: 0, turn: 1, dash: false };
    steps(state, 1);
    expect(angleDiff(angle(state.player.dirX, state.player.dirZ), 0)).toBeCloseTo(PLAYER_TURN_RATE * STEP_SEC, 6);
    steps(state, 29); // 0.5 s
    expect(angleDiff(angle(state.player.dirX, state.player.dirZ), 0)).toBeCloseTo(PLAYER_TURN_RATE * 0.5, 4);
  });

  it('W walks along the facing; the drawn facing is the rule facing', () => {
    const state = setup();
    const z0 = state.player.z;
    state.input = { forward: 1, turn: 0, dash: false };
    steps(state, 30);
    expect(state.player.z - z0).toBeGreaterThan(140);
    expect(Math.abs(state.player.x - SPOT.x)).toBeLessThan(1e-6);
  });

  it('S backs away without turning, at reduced speed', () => {
    const state = setup();
    const z0 = state.player.z;
    state.input = { forward: -1, turn: 0, dash: false };
    steps(state, 30);
    const moved = z0 - state.player.z;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(150 * BACKWARD_FACTOR + 5);
    expect(state.player.dirZ).toBeCloseTo(1, 9);
  });

  it('keeps its facing when no key is held', () => {
    const state = setup();
    state.input = { forward: 1, turn: -1, dash: false };
    steps(state, 20);
    const a = angle(state.player.dirX, state.player.dirZ);
    state.input = { forward: 0, turn: 0, dash: false };
    steps(state, 60);
    expect(angleDiff(angle(state.player.dirX, state.player.dirZ), a)).toBeLessThan(1e-9);
  });

  it('Q (face command) makes a quick half-turn without moving', () => {
    const state = setup();
    const { x, z } = state.player;
    queueCommand(state, { type: 'face', x: 0, z: -1 });
    steps(state, Math.ceil(Math.PI / PLAYER_QUICK_TURN_RATE / STEP_SEC) + 2);
    expect(angleDiff(angle(state.player.dirX, state.player.dirZ), Math.PI)).toBeLessThan(1e-9);
    expect(state.player.x).toBe(x);
    expect(state.player.z).toBe(z);
    expect(state.playerFaceTarget).toBeNull();
  });

  it('turning by hand cancels a pending half-turn', () => {
    const state = setup();
    queueCommand(state, { type: 'face', x: 0, z: -1 });
    steps(state, 1);
    state.input = { forward: 0, turn: 1, dash: false };
    steps(state, 1);
    expect(state.playerFaceTarget).toBeNull();
  });

  it('the capture rule uses the same facing that is drawn', () => {
    const state = setup();
    const enemy = find(state, 'moon', 'soldier');
    teleport(enemy, state.player.x - 60, state.player.z); // to the player's right (-x)
    expect(captureTier(state.player, enemy)).toBe('side');
    state.input = { forward: 0, turn: 1, dash: false };
    steps(state, Math.round((Math.PI / 2) / PLAYER_TURN_RATE / STEP_SEC));
    expect(captureTier(state.player, enemy)).toBe('front');
  });
});

describe('commands during a meeting', () => {
  it('are refused while a meeting is open', () => {
    const state = newGame('sun', 'soldier');
    placeAtBase(state.player);
    expect(queueCommand(state, { type: 'capture' })).toBe(true);
    state.commands = [];
    openMeeting(state);
    expect(queueCommand(state, { type: 'capture' })).toBe(false);
    expect(queueCommand(state, { type: 'special' })).toBe(false);
    expect(queueCommand(state, { type: 'face', x: 1, z: 0 })).toBe(false);
    expect(state.commands).toHaveLength(0);
  });
});

describe('captureCandidate', () => {
  it('names the enemy a capture would take, and nobody from the front', () => {
    const state = setup();
    const enemy = find(state, 'moon', 'sniper');
    teleport(enemy, state.player.x, state.player.z + 60);
    enemy.dirX = 0;
    enemy.dirZ = 1;
    expect(captureCandidate(state, state.player)).toBe(enemy);
    enemy.dirZ = -1;
    expect(captureCandidate(state, state.player)).toBeNull();
  });
});
