import { describe, expect, it } from 'vitest';
import { SITES, UENO_HILL, UPPER } from '../src/config/map';
import { NATIONS } from '../src/config/nations';
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
const W = SITES.walkup;

describe('stairs, slopes and upper floors (Tokyo)', () => {
  it('climbs the 歌舞伎町 building stairs to the roof terrace smoothly', () => {
    const state = soloPlayer();
    teleport(state.player, W.stairsFoot.x, W.stairsFoot.z);
    expect(state.player.y).toBeGreaterThan(0); // standing on the first steps
    const ys = walk(state, 1, 0, 1.2);
    expect(state.player.y).toBeCloseTo(UPPER, 0);
    expect(maxJump(ys)).toBeLessThan(6); // no warps
  });

  it('comes back down the same stairs', () => {
    const state = soloPlayer();
    teleport(state.player, W.terrace.x, W.terrace.z, UPPER);
    const ys = walk(state, -1, 0, 1.2);
    expect(state.player.y).toBeLessThan(12);
    expect(maxJump(ys)).toBeLessThan(10);
  });

  it('walks up the slope onto 上野の山', () => {
    const state = soloPlayer();
    teleport(state.player, SITES.hillSlopeFoot.x, SITES.hillSlopeFoot.z);
    const ys = walk(state, 0, -1, 0.9);
    expect(state.player.y).toBeCloseTo(UENO_HILL.top, 0);
    expect(maxJump(ys)).toBeLessThan(6);
  });

  it('cannot climb the hill cliff directly', () => {
    const state = soloPlayer();
    teleport(state.player, SITES.hillCliffFoot.x, SITES.hillCliffFoot.z);
    walk(state, 0, 1, 1.0);
    expect(state.player.y).toBe(0);
    expect(state.player.z).toBeLessThan(UENO_HILL.z - UENO_HILL.d / 2 - 13);
  });

  it('climbs Tokyo Tower to the observation deck', () => {
    const state = soloPlayer();
    teleport(state.player, SITES.towerStairsMid.x, SITES.towerStairsMid.z, SITES.towerStairsMid.y);
    walk(state, 0, -1, 0.6);
    expect(state.player.y).toBeCloseTo(UPPER, 0);
  });

  it('walks under the expressway and straight through the arcade', () => {
    const state = soloPlayer();
    teleport(state.player, SITES.underExpressway.x, SITES.underExpressway.z);
    walk(state, 1, 0, 0.8);
    expect(state.player.y).toBe(0);
    expect(state.player.x).toBeGreaterThan(-60); // passed under the 44-high deck
    teleport(state.player, SITES.arcadeSouth.x, SITES.arcadeSouth.z);
    walk(state, 0, -1, 1.2);
    expect(state.player.z).toBeLessThan(SITES.arcadeNorthEnd - 10); // through both doors
  });

  it('crosses the arched 聖橋 over the Kanda river but cannot wade', () => {
    const state = soloPlayer();
    teleport(state.player, SITES.bridgeSouth.x, SITES.bridgeSouth.z);
    walk(state, 0, -1, 1.4);
    expect(state.player.z).toBeLessThan(SITES.riverZ(SITES.bridgeSouth.x) - 100);
    teleport(state.player, SITES.riverBank.x, SITES.riverBank.z);
    walk(state, 0, -1, 1.0);
    expect(state.player.z).toBeGreaterThan(SITES.riverZ(SITES.riverBank.x) + 20);
  });

  it.each([
    ['Tokyo Tower stairs', SITES.towerStairsMid, -1, 0],
    ['愛宕山 stone stairs', SITES.atagoStairsMid, 0, 1],
    ['上野 stone stairs', SITES.uenoStairsMid, 0, -1],
    ['聖橋 slope', SITES.bridgeSlopeMid, 1, 0],
  ] as const)('stepping off the side of the %s does not leave you stuck', (_n, p, dx, dz) => {
    const state = soloPlayer();
    teleport(state.player, p.x, p.z, p.y);
    walk(state, dx, dz, 0.35); // step off and land beside the stairs
    expect(state.player.y).toBe(0);
    const a = { x: state.player.x, z: state.player.z };
    walk(state, dx, dz, 0.3); // keep going: must move freely
    expect(Math.hypot(state.player.x - a.x, state.player.z - a.z)).toBeGreaterThan(30);
  });

  it('falls off a ledge instead of floating', () => {
    const state = soloPlayer();
    teleport(state.player, SITES.hillTop.x, SITES.hillTop.z, SITES.hillTop.y);
    walk(state, 0, -1, 1.0); // off the north cliff
    expect(state.player.y).toBe(0);
  });
});

describe('height in the rules', () => {
  it('cannot capture someone on the floor above, even directly behind', () => {
    const state = soloPlayer();
    const enemy = find(state, 'moon', 'sniper');
    teleport(state.player, W.underFloor.x, W.underFloor.z, 0);
    teleport(enemy, W.underFloor.x, W.underFloor.z + 20, UPPER);
    enemy.dirX = 0;
    enemy.dirZ = 1; // back towards the player
    expect(captureCandidate(state, state.player)).toBeNull();
    attemptCapture(state, state.player);
    expect(enemy.jailed).toBe(false);
    // Same spot, same floor: captured.
    teleport(state.player, W.underFloor.x, W.underFloor.z - 20, UPPER);
    state.player.cd.capture = 0;
    attemptCapture(state, state.player);
    expect(enemy.jailed).toBe(true);
  });

  it('floors block sight: a ground-floor AI cannot see the player upstairs', () => {
    const state = soloPlayer();
    const ai = find(state, 'moon', 'soldier');
    teleport(ai, W.underFloor.x, W.underFloor.z - 20, 0);
    ai.dirX = 0;
    ai.dirZ = 1;
    teleport(state.player, W.underFloor.x, W.underFloor.z + 20, UPPER); // right above, in front
    expect(hasLineOfSight(ai, state.player)).toBe(false);
    expect(canPerceive(state, ai, state.player)).toBe(false);
  });

  it('high ground sees over buildings', () => {
    const state = soloPlayer();
    const low = find(state, 'moon', 'soldier');
    teleport(state.player, SITES.dietNorth.x, SITES.dietNorth.z, 0);
    teleport(low, SITES.dietSouth.x, SITES.dietSouth.z, 0); // the Diet building is between them
    expect(hasLineOfSight(state.player, low)).toBe(false);
    teleport(state.player, SITES.dietNorth.x, SITES.dietNorth.z, 140);
    expect(hasLineOfSight(state.player, low)).toBe(true);
  });

  it('AI does not see through buildings or behind itself (no wall-hacks)', () => {
    const state = soloPlayer();
    const ai = find(state, 'moon', 'soldier');
    teleport(ai, SITES.dietSouth.x, SITES.dietSouth.z);
    teleport(state.player, SITES.dietNorth.x, SITES.dietNorth.z);
    ai.dirX = 0;
    ai.dirZ = -1;
    ai.ai.alert = 0;
    expect(canPerceive(state, ai, state.player)).toBe(false); // building in between, even facing it
    // Open plaza, 160 apart (beyond earshot).
    teleport(ai, SITES.open.x, SITES.open.z + 80);
    teleport(state.player, SITES.open.x, SITES.open.z - 80);
    ai.dirZ = 1; // looking away; the player is behind
    expect(canPerceive(state, ai, state.player)).toBe(false);
    ai.dirZ = -1; // turn round
    expect(canPerceive(state, ai, state.player)).toBe(true);
  });
});

describe('navigation graph', () => {
  const from = { ...NATIONS.sun.base, y: 0 };
  it.each([
    ['歌舞伎町 roof terrace', { ...W.terrace, y: UPPER }],
    ['Tokyo Tower deck', SITES.towerDeck],
    ['上野の山', SITES.hillTop],
    ['皇居 (over the moat)', SITES.palaceTop],
    ['expressway deck', SITES.expresswayDeck],
    ['star base', { ...NATIONS.star.base, y: 0 }],
    ['moon base', { ...NATIONS.moon.base, y: 0 }],
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
