import type { NationId } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { kingOf } from '../sim/state';
import { dist } from '../sim/systems/collision';
import type { Sighting, Task } from './memory';

/**
 * Each kingdom is an independent commander. Once a second it reads the
 * situation (whose king is where, who holds whom) and hands out jobs to its AI
 * members. Nothing here treats the player's nation specially.
 */

export type Posture = 'NORMAL' | 'RESCUE_KING' | 'HOLD_KING' | 'OPPORTUNIST';

export interface Faction {
  /** Shared, possibly stale reports of enemies (what allies have seen). */
  intel: Map<number, Sighting>;
  /** How king-like each enemy has looked to this nation (escorted, protected). */
  belief: Map<number, number>;
  posture: Posture;
  /** Last time one of ours was captured (escorts double for a while). */
  lastAllyCapturedAt: number;
  nextTickAt: number;
}

export function createFaction(): Faction {
  return { intel: new Map(), belief: new Map(), posture: 'NORMAL', lastAllyCapturedAt: -Infinity, nextTickAt: 0 };
}

const TICK_MS = 1000;
const HUNTER_ROLES = new Set(['soldier', 'impostor']);

function aiMembers(state: GameState, n: NationId): Entity[] {
  return state.entities.filter((e) => e.nation === n && !e.isPlayer && e.alive && !e.jailed);
}

function byDistance<T extends { x: number; z: number }>(list: Entity[], p: T): Entity[] {
  return [...list].sort((a, b) => dist(a, p) - dist(b, p));
}

/** Updates beliefs from shared intel: enemies seen surrounded by their own allies look like kings. */
function updateBelief(state: GameState, n: NationId): void {
  const f = state.factions[n];
  const fresh = [...f.intel.values()].filter((s) => state.time - s.t < 1500);
  for (const s of fresh) {
    const t = state.entities[s.id];
    if (!t) continue;
    const guards = fresh.filter((o) => o.id !== s.id && state.entities[o.id].nation === t.nation && Math.hypot(o.x - s.x, o.z - s.z) < 90).length;
    if (guards >= 2) f.belief.set(s.id, Math.min(5, (f.belief.get(s.id) ?? 0) + 1));
  }
  for (const [id, b] of f.belief) f.belief.set(id, b * 0.97);
  for (const [id, s] of f.intel) if (state.time - s.t > 15000) f.intel.delete(id);
}

function assign(state: GameState, n: NationId): void {
  const f = state.factions[n];
  const members = aiMembers(state, n);
  for (const e of members) e.ai.task = null;
  const hunters = members.filter((e) => HUNTER_ROLES.has(e.role));
  const take = (list: Entity[], k: number, task: Task) => {
    const picked = list.slice(0, k);
    for (const e of picked) e.ai.task = task;
    return list.filter((e) => !picked.includes(e));
  };
  const myKing = kingOf(state, n);
  const heldKing = state.entities.find((e) => e.role === 'king' && e.jailed && e.capturedBy === n);
  const otherCapture = state.entities.find((e) => e.role === 'king' && e.jailed && e.nation !== n && e.capturedBy !== n);

  if (myKing?.alive && myKing.jailed && myKing.capturedBy) {
    // Our king is in someone's jail: everything turns into the rescue.
    f.posture = 'RESCUE_KING';
    const jail = myKing.capturedBy;
    const j = NATIONS[jail].jail;
    const kh = members.find((e) => e.role === 'keyholder');
    if (kh) kh.ai.task = { kind: 'rescueKing', jail };
    let rest = take(byDistance(hunters, j), 2, { kind: 'rescueEscort', jail });
    const imp = rest.find((e) => e.role === 'impostor');
    if (imp) { imp.ai.task = { kind: 'decoy', toward: jail }; rest = rest.filter((e) => e !== imp); }
    take(rest, 9, { kind: 'hunt', nation: jail });
    const sn = members.find((e) => e.role === 'sniper');
    if (sn) sn.ai.task = { kind: 'rescueEscort', jail };
    return;
  }
  if (heldKing) {
    // We hold an enemy king: defend the jail until the execution.
    f.posture = 'HOLD_KING';
    const j = NATIONS[n].jail;
    const rest = take(byDistance(hunters, j), 2, { kind: 'guardJail' });
    const sn = members.find((e) => e.role === 'sniper');
    if (sn) sn.ai.task = { kind: 'guardJail' };
    take(rest, 9, { kind: 'hunt', nation: heldKing.nation });
    return;
  }
  if (otherCapture?.capturedBy) {
    // Two other kingdoms are locked in a jail fight: exploit it.
    f.posture = 'OPPORTUNIST';
    const captor = otherCapture.capturedBy;
    let rest = take(byDistance(hunters, NATIONS[captor].jail), 1, { kind: 'raidJail', jail: captor });
    if (state.tower.owner !== n) rest = take(rest, 1, { kind: 'takeTower' });
    take(rest, 9, { kind: 'hunt', nation: captor });
    return;
  }
  f.posture = 'NORMAL';
  if (myKing?.alive && !myKing.jailed) {
    const escorts = state.time - f.lastAllyCapturedAt < 15000 ? 2 : 1;
    take(byDistance(hunters, myKing), escorts, { kind: 'escortKing' });
  }
}

/** Runs each nation's commander once per second. */
export function factionTick(state: GameState): void {
  for (const n of NATION_IDS) {
    const f = state.factions[n];
    if (state.time < f.nextTickAt) continue;
    f.nextTickAt = state.time + TICK_MS;
    updateBelief(state, n);
    assign(state, n);
  }
}

/** Called when one of a nation's characters is captured. */
export function noteAllyCaptured(state: GameState, n: NationId): void {
  state.factions[n].lastAllyCapturedAt = state.time;
  state.factions[n].nextTickAt = state.time; // react right away
}
