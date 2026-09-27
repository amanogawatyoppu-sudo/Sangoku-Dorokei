import { describe, expect, it } from 'vitest';
import { STEP_SEC } from '../src/core/clock';
import { planPath } from '../src/ai/nav';
import { canPerceive } from '../src/ai/perception';
import { teleport } from '../src/sim/entity';
import { captureCandidate, attemptCapture } from '../src/sim/systems/capture';
import { hasLineOfSight } from '../src/sim/systems/vision';
import { stepSimulation } from '../src/sim/step';
import { canWalk, supportHeight, walkLine } from '../src/sim/systems/world';
import type { GameState } from '../src/sim/state';
import { find, freezeOthers, newGame } from './helpers';

function soloPlayer(): GameState {
  const state = newGame('sun', 'soldier');
  state.nextEventAt = Infinity;
  freezeOthers(state, [state.player]);
  return state;
}

/** Walks the player forward along (dx, dz) for `sec`, returning the height trace. */
function walk(state: GameState, dx: number, dz: number, sec: number): number[] {
  const p = state.player;
  const l = Math.hypot(dx, dz);
  p.dirX = dx / l;
  p.dirZ = dz / l;
  state.input = { forward: 1, turn: 0, dash: false };
  const ys: number[] = [];
  for (let t = 0; t < sec; t += STEP_SEC) {
    stepSimulation(state, STEP_SEC);
    ys.push(p.y);
  }
  state.input = { forward: 0, turn: 0, dash: false };
  return ys;
}

const maxJump = (ys: number[]) => ys.slice(1).reduce((m, y, i) => Math.max(m, Math.abs(y - ys[i])), 0);

describe('stairs, slopes and upper floors', () => {
  it('climbs the west hall stairs to the second floor smoothly', () => {
    const state = soloPlayer();
    teleport(state.player, -455, -640);
    expect(state.player.y).toBeGreaterThan(0); // standing on the first steps
    const ys = walk(state, 1, 0, 1.2);
    expect(state.player.y).toBeCloseTo(64, 0);
    expect(maxJump(ys)).toBeLessThan(6); // no warps
  });

  it('comes back down the same stairs', () => {
    const state = soloPlayer();
    teleport(state.player, -315, -640, 64);
    const ys = walk(state, -1, 0, 1.2);
    expect(state.player.y).toBeLessThan(12);
    expect(maxJump(ys)).toBeLessThan(10);
  });

  it('walks up the slope onto the west plateau', () => {
    const state = soloPlayer();
    teleport(state.player, -1150, -240);
    const ys = walk(state, 0, -1, 0.9);
    expect(state.player.y).toBeCloseTo(44, 0);
    expect(maxJump(ys)).toBeLessThan(6);
  });

  it('cannot climb the plateau cliff directly', () => {
    const state = soloPlayer();
    teleport(state.player, -1150, -700); // north of the plateau
    walk(state, 0, 1, 1.0);
    expect(state.player.y).toBe(0);
    expect(state.player.z).toBeLessThan(-650 - 13);
  });

  it('walks under the skyway and through the centre hall', () => {
    const state = soloPlayer();
    teleport(state.player, -185, -520);
    walk(state, 0, -1, 0.8);
    expect(state.player.y).toBe(0);
    expect(state.player.z).toBeLessThan(-700); // passed under the 64-high skyway
    teleport(state.player, -40, -500);
    walk(state, 0, -1, 1.0);
    expect(state.player.z).toBeLessThan(-690); // through both hall doors
  });

  it('crosses the arched bridge over the river but cannot wade', () => {
    const state = soloPlayer();
    teleport(state.player, 0, 60);
    walk(state, 0, 1, 1.4);
    expect(state.player.z).toBeGreaterThan(300);
    teleport(state.player, 400, 120);
    walk(state, 0, 1, 1.2);
    expect(state.player.z).toBeLessThan(170 - 13);
  });

  it('falls off a ledge instead of floating', () => {
    const state = soloPlayer();
    teleport(state.player, -1150, -520, 44);
    walk(state, 0, -1, 1.2); // off the north cliff
    expect(state.player.y).toBe(0);
  });
});

describe('height in the rules', () => {
  it('cannot capture someone on the floor above, even directly behind', () => {
    const state = soloPlayer();
    const enemy = find(state, 'moon', 'sniper');
    teleport(state.player, -400, -560, 0);
    teleport(enemy, -400, -540, 64);
    enemy.dirX = 0;
    enemy.dirZ = 1; // back towards the player
    expect(captureCandidate(state, state.player)).toBeNull();
    attemptCapture(state, state.player);
    expect(enemy.jailed).toBe(false);
    // Same spot, same floor: captured.
    teleport(state.player, -400, -600, 64);
    state.player.cd.capture = 0;
    attemptCapture(state, state.player);
    expect(enemy.jailed).toBe(true);
  });

  it('floors block sight: a ground-floor AI cannot see the player upstairs', () => {
    const state = soloPlayer();
    const ai = find(state, 'moon', 'soldier');
    teleport(ai, -400, -600, 0);
    ai.dirX = 0;
    ai.dirZ = 1;
    teleport(state.player, -400, -540, 64); // right above, in front of the AI's view
    expect(hasLineOfSight(ai, state.player)).toBe(false);
    expect(canPerceive(state, ai, state.player)).toBe(false);
  });

  it('high ground sees over low walls', () => {
    const state = soloPlayer();
    const low = find(state, 'moon', 'soldier');
    teleport(state.player, -400, -190, 0);
    teleport(low, -60, -190, 0); // the 55-high wall at x=-230 is between them
    expect(hasLineOfSight(state.player, low)).toBe(false);
    teleport(state.player, -400, -190, 120);
    expect(hasLineOfSight(state.player, low)).toBe(true);
  });

  it('AI does not see through walls or behind itself (no wall-hacks)', () => {
    const state = soloPlayer();
    const ai = find(state, 'moon', 'soldier');
    teleport(ai, -60, -190);
    teleport(state.player, -400, -190);
    ai.dirX = -1;
    ai.dirZ = 0;
    ai.ai.alert = 0;
    expect(canPerceive(state, ai, state.player)).toBe(false); // wall in between, even facing it
    // Open field, 160 apart (beyond earshot).
    teleport(ai, -600, 460);
    teleport(state.player, -600, 300);
    ai.dirX = 0;
    ai.dirZ = 1; // looking away (+z); the player is behind at -z
    expect(canPerceive(state, ai, state.player)).toBe(false);
    ai.dirZ = -1; // turn round
    expect(canPerceive(state, ai, state.player)).toBe(true);
  });
});

describe('navigation graph', () => {
  const from = { x: -1560, y: 0, z: 800 };
  it.each([
    ['west hall 2F', { x: -320, y: 64, z: 570 * -1 }],
    ['centre roof', { x: 0, y: 64, z: -600 }],
    ['east plateau', { x: 1150, y: 44, z: -520 }],
    ['sun watch platform', { x: -1180, y: 64, z: 620 }],
    ['wall walk', { x: -500, y: 44, z: -900 }],
    ['star base', { x: 0, y: 0, z: -1030 }],
  ])('finds a walkable route to the %s', (_name, goal) => {
    const pts = planPath(from, goal)!;
    expect(pts).not.toBeNull();
    // Walk it for real: each leg must be walkable from where the previous one ended.
    let b = { ...from };
    for (const p of pts) {
      expect(canWalk(b, p.x, p.y, p.z)).toBe(true);
      b = walkLine(b, p.x, p.z);
      b.y = supportHeight(b.x, b.z, b.y);
    }
    expect(Math.abs(b.y - goal.y)).toBeLessThan(2);
  });
});
