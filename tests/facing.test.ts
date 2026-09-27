import { describe, expect, it } from 'vitest';
import { PLAYER_TURN_RATE } from '../src/config/constants';
import { STEP_SEC } from '../src/core/clock';
import { teleport } from '../src/sim/entity';
import { openMeeting } from '../src/meeting/meetingSystem';
import { queueCommand } from '../src/sim/state';
import { captureCandidate, captureTier } from '../src/sim/systems/capture';
import { turnToward } from '../src/sim/systems/movement';
import { stepSimulation } from '../src/sim/step';
import { find, freezeOthers, newGame, placeAtBase } from './helpers';

const angle = (x: number, z: number) => Math.atan2(x, z);
const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function setup() {
  const state = newGame('sun', 'soldier');
  state.nextEventAt = Infinity;
  freezeOthers(state, [state.player]);
  teleport(state.player, 0, 380); // open ground
  state.player.dirX = 0;
  state.player.dirZ = 1;
  return state;
}

function steps(state: ReturnType<typeof setup>, n: number) {
  for (let i = 0; i < n; i++) stepSimulation(state, STEP_SEC);
}

describe('turnToward', () => {
  it('turns by at most maxRad and reports when aligned', () => {
    const e = { dirX: 0, dirZ: 1 } as Parameters<typeof turnToward>[0];
    expect(turnToward(e, 1, 0, 0.1)).toBe(false);
    expect(angle(e.dirX, e.dirZ)).toBeCloseTo(0.1, 6);
    expect(turnToward(e, 1, 0, 10)).toBe(true);
    expect(angle(e.dirX, e.dirZ)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('takes the short way round', () => {
    const e = { dirX: Math.sin(3), dirZ: Math.cos(3) } as Parameters<typeof turnToward>[0];
    turnToward(e, Math.sin(-3), Math.cos(-3), 0.1);
    expect(angle(e.dirX, e.dirZ)).toBeCloseTo(3.1, 6);
  });
});

describe('player facing', () => {
  it('turns smoothly toward the movement direction instead of snapping', () => {
    const state = setup();
    state.input = { mx: 1, mz: 0, dash: false };
    steps(state, 1);
    const a = angle(state.player.dirX, state.player.dirZ);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(Math.PI / 2);
    expect(a).toBeCloseTo(PLAYER_TURN_RATE * STEP_SEC, 6);
    // 90° at 720°/s takes 0.125s ≈ 8 steps.
    steps(state, 8);
    expect(angleDiff(angle(state.player.dirX, state.player.dirZ), Math.PI / 2)).toBeLessThan(1e-9);
  });

  it('moves immediately even while the body is still turning', () => {
    const state = setup();
    const x0 = state.player.x;
    state.input = { mx: 1, mz: 0, dash: false };
    steps(state, 1);
    expect(state.player.x).toBeGreaterThan(x0);
  });

  it('keeps its last facing when the player stops', () => {
    const state = setup();
    state.input = { mx: -1, mz: 0, dash: false };
    steps(state, 30);
    state.input = { mx: 0, mz: 0, dash: false };
    steps(state, 60);
    expect(angleDiff(angle(state.player.dirX, state.player.dirZ), -Math.PI / 2)).toBeLessThan(1e-9);
  });

  it('turns in place with the face command without moving', () => {
    const state = setup();
    const { x, z } = state.player;
    queueCommand(state, { type: 'face', x: 0, z: -1 });
    steps(state, 30);
    expect(angleDiff(angle(state.player.dirX, state.player.dirZ), Math.PI)).toBeLessThan(1e-9);
    expect(state.player.x).toBe(x);
    expect(state.player.z).toBe(z);
    expect(state.playerFaceTarget).toBeNull();
  });

  it('moving cancels a pending in-place turn', () => {
    const state = setup();
    queueCommand(state, { type: 'face', x: 0, z: -1 });
    steps(state, 1);
    state.input = { mx: 1, mz: 0, dash: false };
    steps(state, 20);
    expect(state.playerFaceTarget).toBeNull();
    expect(angleDiff(angle(state.player.dirX, state.player.dirZ), Math.PI / 2)).toBeLessThan(1e-9);
  });

  it('the capture rule uses the same facing that is drawn', () => {
    const state = setup();
    const enemy = find(state, 'moon', 'soldier');
    // Enemy stands east of the player; the player first faces north (+z).
    teleport(enemy, state.player.x + 60, state.player.z);
    expect(captureTier(state.player, enemy)).toBe('side');
    queueCommand(state, { type: 'face', x: 1, z: 0 });
    steps(state, 30);
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
    enemy.dirZ = 1; // facing away from the player
    expect(captureCandidate(state, state.player)).toBe(enemy);
    enemy.dirZ = -1; // facing the player
    expect(captureCandidate(state, state.player)).toBeNull();
  });
});
