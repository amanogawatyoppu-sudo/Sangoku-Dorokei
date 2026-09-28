import type { NationId } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import type { Entity } from '../sim/entity';
import { isHuman } from '../sim/entity';
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
  /** Where the latest capture attempt involving this nation happened (rangers go there). */
  fight: { x: number; y: number; z: number; t: number } | null;
  nextTickAt: number;
}

export function createFaction(): Faction {
  return { intel: new Map(), belief: new Map(), posture: 'NORMAL', lastAllyCapturedAt: -Infinity, nextTickAt: 0, fight: null };
}

const TICK_MS = 1000;
const HUNTER_ROLES = new Set(['soldier', 'ranger']);

/** AI members the commander can give tasks to (the player's own squad answers to the player). */
function aiMembers(state: GameState, n: NationId): Entity[] {
  return state.entities.filter((e) => e.nation === n && !isHuman(e) && e.alive && !e.jailed
    && (e.ai.leaderId === null || !isHuman(state.entities[e.ai.leaderId])));
}

/** Size of the player's squad for a nation of `n` people: 6 → 2, 10 → 3, 15 → 4. */
export function playerSquadSize(n: number): number {
  return Math.max(2, Math.round(n / 3.5));
}
/** AI squads: a leader and up to this many followers. */
const AI_SQUAD_FOLLOWERS = 2;

const squadable = (e: Entity) => !isHuman(e) && e.alive && !e.jailed && (e.role === 'soldier' || e.role === 'ranger' || e.role === 'sniper');

/**
 * Groups people into squads so they move and fight together instead of alone:
 * the player gets a few followers (soldiers first), and the rest of the free
 * hunters form AI squads of up to three. Anyone given a task leaves their squad;
 * snipers keep to their perches unless they are in the player's squad.
 */
function formSquads(state: GameState, n: NationId): void {
  const people = state.entities.filter((e) => e.nation === n && !isHuman(e));
  const followersOf = (L: Entity) => people.filter((e) => e.ai.leaderId === L.id);
  for (const e of people) {
    const L = e.ai.leaderId === null ? null : state.entities[e.ai.leaderId];
    if (!L) continue;
    const ok = squadable(e) && L.alive && !L.jailed
      && (isHuman(L) || (!e.ai.task && !L.ai.task && L.ai.leaderId === null && e.role === 'soldier'));
    if (!ok) e.ai.leaderId = null;
  }
  const free = (e: Entity) => squadable(e) && e.ai.leaderId === null && !e.ai.task && followersOf(e).length === 0;
  // Each person gets a squad (online, the nation's people share the followers).
  const humans = state.humans.map((id) => state.entities[id]).filter((h) => h.nation === n);
  for (const p of humans) {
    if (!p.alive || p.jailed) continue;
    const size = state.entities.filter((e) => e.nation === n).length;
    const want = Math.max(1, Math.ceil(playerSquadSize(size) / humans.length)) - followersOf(p).length;
    if (want > 0) {
      const rank = (e: Entity) => (e.role === 'sniper' ? 1 : 0) * 1e6 + dist(e, p);
      for (const e of people.filter(free).sort((a, b) => rank(a) - rank(b)).slice(0, want)) e.ai.leaderId = p.id;
    }
  }
  const leaders: Entity[] = people.filter((e) => squadable(e) && e.role === 'soldier' && e.ai.leaderId === null && !e.ai.task && followersOf(e).length > 0);
  for (const u of people.filter((e) => free(e) && e.role === 'soldier').sort((a, b) => a.id - b.id)) {
    if (leaders.includes(u)) continue;
    const L = leaders.filter((l) => l !== u && followersOf(l).length < AI_SQUAD_FOLLOWERS && dist(l, u) < 1600).sort((a, b) => dist(a, u) - dist(b, u))[0];
    if (L) u.ai.leaderId = L.id;
    else leaders.push(u);
  }
  // Formation slots in id order.
  for (const L of [...leaders, ...humans]) followersOf(L).sort((a, b) => a.id - b.id).forEach((e, i) => { e.ai.slot = i; });
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
    // Every keyholder heads for the jail (the nearest one usually gets there first).
    for (const kh of members.filter((e) => e.role === 'keyholder')) kh.ai.task = { kind: 'rescueKing', jail };
    // Rescue party: keyholder + escort + sniper overwatch. Rangers always go (they get there first).
    const rangers = hunters.filter((e) => e.role === 'ranger');
    for (const r of rangers) r.ai.task = { kind: 'rescueEscort', jail };
    const soldiers = hunters.filter((e) => e.role !== 'ranger');
    take(byDistance(soldiers, j), Math.max(2 - rangers.length, Math.ceil(soldiers.length * 0.5)), { kind: 'rescueEscort', jail });
    for (const sn of members.filter((e) => e.role === 'sniper')) sn.ai.task = { kind: 'rescueEscort', jail };
    return;
  }
  if (heldKing) {
    // We hold an enemy king: defend the jail until the execution.
    f.posture = 'HOLD_KING';
    const j = NATIONS[n].jail;
    const rest = take(byDistance(hunters, j), Math.max(2, Math.ceil(hunters.length * 0.35)), { kind: 'guardJail' });
    for (const sn of members.filter((e) => e.role === 'sniper')) sn.ai.task = { kind: 'guardJail' };
    take(rest, 9, { kind: 'hunt', nation: heldKing.nation });
    return;
  }
  if (otherCapture?.capturedBy) {
    // Two other kingdoms are locked in a jail fight: exploit it.
    f.posture = 'OPPORTUNIST';
    const captor = otherCapture.capturedBy;
    let rest = take(byDistance(hunters, NATIONS[captor].jail), Math.max(1, Math.round(hunters.length * 0.25)), { kind: 'raidJail', jail: captor });
    if (state.tower.owner !== n) rest = take(rest, 1, { kind: 'takeTower' });
    take(rest, 9, { kind: 'hunt', nation: captor });
    return;
  }
  f.posture = 'NORMAL';
  if (myKing?.alive && !myKing.jailed) {
    const escorts = Math.floor(hunters.length / 4) + (state.time - f.lastAllyCapturedAt < 15000 ? 2 : 1);
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
    formSquads(state, n);
  }
}

/** Called when one of a nation's characters is captured. */
export function noteAllyCaptured(state: GameState, n: NationId): void {
  state.factions[n].lastAllyCapturedAt = state.time;
  state.factions[n].nextTickAt = state.time; // react right away
}
