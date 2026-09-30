import { tuning } from './difficulty';
import type { NationId } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import type { Entity } from '../sim/entity';
import { isHuman } from '../sim/entity';
import type { GameState } from '../sim/state';
import { kingOf } from '../sim/state';
import { dist } from '../sim/systems/collision';
import type { Sighting, Task, Waypoint } from './memory';
import { emit } from '../sim/state';
import type { SectorId } from '../sim/war';
import { CENTRAL, POINT_R, proposeTruce, rearSectors, sectorAt, sectorPoint, strength, trucesLeft } from '../sim/war';
import { chokePoints } from './nav';
import type { Strategy } from './strategy';
import { NO_STRATEGY, decideNormal, frontSectors, kingHaunt, kingTarget, opportunistTarget, threatenedSector } from './strategy';
import { canRescue } from '../sim/systems/rescue';
import { beaconPhase, canLightKings, lightKings } from '../sim/systems/tower';
import { timeLeftSec } from '../sim/state';
import { TOWER } from '../config/map';

/**
 * Each kingdom is an independent commander. Once a second it reads the
 * situation (whose king is where, who holds whom) and hands out jobs to its AI
 * members. Nothing here treats the player's nation specially.
 */

export type Posture = 'NORMAL' | 'RESCUE_KING' | 'HOLD_KING' | 'OPPORTUNIST' | 'ALL_OUT';

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
  /** The kingdom's current plan (国家戦略). */
  strategy: Strategy;
  nextTickAt: number;
  /** Since when the commander could have lit the enemy kings but waited for its hunters. */
  lightWaitFrom: number | null;
}

export function createFaction(): Faction {
  return { intel: new Map(), belief: new Map(), posture: 'NORMAL', lastAllyCapturedAt: -Infinity, nextTickAt: 0, lightWaitFrom: null, fight: null, strategy: { ...NO_STRATEGY } };
}

/**
 * Whether unit number u of an operation takes the high route (stairs, footbridge, high ground):
 * every `base`-th unit on 標準 (as before), none on 初級, one more often on 上級.
 */
const highRoute = (state: GameState, u: number, base: number) => {
  const lv = tuning(state).highRouteEvery;
  if (lv === 0) return false;
  const k = lv < 3 ? Math.max(2, base - 1) : base;
  return u % k === k - 1;
};
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

/** A follower stays with its leader when neither has a job, or both are on the same attack or king hunt. */
const sameAssault = (e: Entity, L: Entity) => {
  const a = e.ai.task, b = L.ai.task;
  if (!a || !b) return !a && !b;
  if (a.kind === 'assault' && b.kind === 'assault') return a.sector === b.sector;
  return a.kind === 'huntKing' && b.kind === 'huntKing' && a.nation === b.nation;
};
/** Jobs a squad can do together. */
const squadTask = (e: Entity) => !e.ai.task || e.ai.task.kind === 'assault' || e.ai.task.kind === 'huntKing';
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
      && (isHuman(L) || (sameAssault(e, L) && L.ai.leaderId === null && e.role === 'soldier'));
    if (!ok) e.ai.leaderId = null;
  }
  const free = (e: Entity) => squadable(e) && e.ai.leaderId === null && squadTask(e) && followersOf(e).length === 0;
  // A person's squad comes first: any free-standing hunter or sniper may be called (not the king's escort).
  const freeForPerson = (e: Entity) => squadable(e) && e.ai.leaderId === null && followersOf(e).length === 0 && e.ai.task?.kind !== 'escortKing';
  // Each person gets a squad (online, the nation's people share the followers).
  const humans = state.humans.map((id) => state.entities[id]).filter((h) => h.nation === n);
  for (const p of humans) {
    if (!p.alive || p.jailed) continue;
    const size = state.entities.filter((e) => e.nation === n).length;
    const want = Math.max(1, Math.ceil(playerSquadSize(size) / humans.length)) - followersOf(p).length;
    if (want > 0) {
      const rank = (e: Entity) => (e.role === 'sniper' ? 1 : 0) * 1e6 + dist(e, p);
      for (const e of people.filter(freeForPerson).sort((a, b) => rank(a) - rank(b)).slice(0, want)) { e.ai.leaderId = p.id; e.ai.task = null; }
    }
  }
  const leaders: Entity[] = people.filter((e) => squadable(e) && e.role === 'soldier' && e.ai.leaderId === null && squadTask(e) && followersOf(e).length > 0);
  for (const u of people.filter((e) => free(e) && e.role === 'soldier').sort((a, b) => a.id - b.id)) {
    if (leaders.includes(u)) continue;
    const L = leaders.filter((l) => l !== u && sameAssault(u, l) && followersOf(l).length < AI_SQUAD_FOLLOWERS && dist(l, u) < 1600).sort((a, b) => dist(a, u) - dist(b, u))[0];
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

/** Hunters grouped as they move: each squad leader with its followers, and everyone alone. */
function units(hunters: Entity[]): Entity[][] {
  const out: Entity[][] = [];
  const inUnit = new Set<Entity>();
  for (const L of hunters) {
    if (L.ai.leaderId !== null && hunters.some((h) => h.id === L.ai.leaderId)) continue;
    const u = [L, ...hunters.filter((f) => f.ai.leaderId === L.id)];
    u.forEach((x) => inUnit.add(x));
    out.push(u);
  }
  for (const h of hunters) if (!inUnit.has(h)) out.push([h]);
  return out;
}

/** A second way in (歩道橋・階段・高台) for a flanking group: a stair end or high walkway near the point. */
const viaCache = new Map<string, Waypoint | null>();
function flankRoute(sector: SectorId, variant: number): Waypoint | null {
  const key = sector + ':' + variant;
  if (viaCache.has(key)) return viaCache.get(key)!;
  const p = sectorPoint(sector);
  const cands = chokePoints().filter((c) => { const d = Math.hypot(c.x - p.x, c.z - p.z); return d > 220 && d < 750; })
    .sort((a, b) => b.y - a.y || a.id - b.id);
  const w = cands.length ? cands[variant % Math.min(3, cands.length)] : null;
  const via = w ? { x: w.x, y: w.y, z: w.z } : null;
  viaCache.set(key, via);
  return via;
}

/** Sends whole units (a squad stays a squad) on a task until about `k` people are on it. */
function sendUnits(pool: Entity[][], k: number, make: (u: number) => Task): Entity[][] {
  let n = 0, u = 0;
  const rest: Entity[][] = [];
  for (const unit of pool) {
    if (n >= k) { rest.push(unit); continue; }
    const task = make(u++);
    for (const e of unit) e.ai.task = { ...task };
    n += unit.length;
  }
  return rest;
}

/** Announces a change of plan (the nation's own people hear it; others via the tower). */
function setStrategy(state: GameState, n: NationId, st: Strategy): void {
  const f = state.factions[n], old = f.strategy;
  f.strategy = st;
  if (old.kind !== st.kind || old.sector !== st.sector) emit(state, { type: 'STRATEGY', nation: n, kind: st.kind, sector: st.sector });
}

function assign(state: GameState, n: NationId): void {
  const f = state.factions[n];
  const members = aiMembers(state, n);
  for (const e of members) e.ai.task = null;
  const hunters = members.filter((e) => HUNTER_ROLES.has(e.role));
  const snipers = members.filter((e) => e.role === 'sniper');
  const keyholders = members.filter((e) => e.role === 'keyholder');
  const comms = members.filter((e) => e.role === 'communicator');
  const take = (list: Entity[], k: number, task: Task) => {
    const picked = list.slice(0, k);
    for (const e of picked) e.ai.task = { ...task };
    return list.filter((e) => !picked.includes(e));
  };
  const myKing = kingOf(state, n);
  const heldKing = state.entities.find((e) => e.role === 'king' && e.jailed && e.capturedBy === n);
  const otherCapture = state.entities.find((e) => e.role === 'king' && e.jailed && e.nation !== n && e.capturedBy !== n);
  const front = frontSectors(state, n);
  const threat = threatenedSector(state, n);
  const defendSpot = threat ?? front[0] ?? null;

  if (myKing?.alive && myKing.jailed && myKing.capturedBy
    && !state.entities.some((e) => e.nation === n && e.alive && !e.jailed && canRescue(state, e)) && members.length) {
    // Our king is jailed and nobody left can open a lock (keyholders all caught): a rescue
    // is hopeless, so everyone goes all out for an enemy king instead (the jailer's first).
    f.posture = 'ALL_OUT';
    const t = kingTarget(state, n, myKing.capturedBy, 12000, 1.6);
    if (!t) { take(hunters, 99, { kind: 'hunt', nation: myKing.capturedBy }); return; }
    const sector = t.lead ? sectorAt(t.lead.x, t.lead.z) : kingHaunt(state, t.nation);
    setStrategy(state, n, { kind: 'ALL_OUT', sector, enemy: t.nation, until: 0 });
    let rest = hunters;
    // With no lead in the last third, the tower's beacon is the quickest way to find a king.
    if (!t.lead && beaconPhase(state) && state.tower.owner !== n) {
      rest = take(byDistance(rest, TOWER), 2, { kind: 'takeTower' });
      for (const c of comms) c.ai.task = { kind: 'takeTower' };
    }
    sendUnits(units(rest), Infinity, () => ({ kind: 'huntKing', nation: t.nation, lead: t.lead }));
    for (const sn of snipers) sn.ai.task = { kind: 'overwatch', sector };
    return;
  }
  if (myKing?.alive && myKing.jailed && myKing.capturedBy) {
    // Our king is in someone's jail: the war stops for the rescue.
    f.posture = 'RESCUE_KING';
    setStrategy(state, n, { kind: 'RESCUE_KING', sector: sectorAt(NATIONS[myKing.capturedBy].jail.x, NATIONS[myKing.capturedBy].jail.z), enemy: myKing.capturedBy, until: 0 });
    const jail = myKing.capturedBy;
    const j = NATIONS[jail].jail;
    // Every keyholder heads for the jail (the nearest one usually gets there first).
    for (const kh of keyholders) kh.ai.task = { kind: 'rescueKing', jail };
    // Rescue party: keyholder + escort + sniper overwatch. Rangers always go (they get there first).
    const rangers = hunters.filter((e) => e.role === 'ranger');
    for (const r of rangers) r.ai.task = { kind: 'rescueEscort', jail };
    const soldiers = hunters.filter((e) => e.role !== 'ranger');
    const rest = take(byDistance(soldiers, j), Math.max(2 - rangers.length, Math.ceil(soldiers.length * 0.6)) + tuning(state).rescueExtra, { kind: 'rescueEscort', jail });
    // The rest hold the line (the front shrinks, it is not abandoned).
    if (defendSpot !== null) take(rest, 9, { kind: 'defend', sector: defendSpot });
    for (const sn of snipers) sn.ai.task = { kind: 'rescueEscort', jail };
    return;
  }
  if (heldKing) {
    // We hold an enemy king: guard the jail, but keep the front manned too.
    f.posture = 'HOLD_KING';
    setStrategy(state, n, { kind: 'HOLD_KING', sector: sectorAt(NATIONS[n].jail.x, NATIONS[n].jail.z), enemy: heldKing.nation, until: 0 });
    const j = NATIONS[n].jail;
    let rest = take(byDistance(hunters, j), Math.max(2, Math.ceil(hunters.length * 0.4)), { kind: 'guardJail' });
    snipers.forEach((sn, i) => { sn.ai.task = i % 2 === 0 || defendSpot === null ? { kind: 'guardJail' } : { kind: 'overwatch', sector: defendSpot }; });
    if (defendSpot !== null) rest = take(rest, Math.ceil(rest.length / 2), { kind: 'defend', sector: defendSpot });
    take(rest, 9, { kind: 'hunt', nation: heldKing.nation });
    return;
  }
  if (otherCapture?.capturedBy) {
    // Two other kingdoms are locked in a jail fight: exploit it (漁夫の利).
    f.posture = 'OPPORTUNIST';
    const captor = otherCapture.capturedBy, victim = otherCapture.nation;
    // Pick the target once and stick to it for a while (not a new one every second).
    let t: { sector: SectorId; enemy: NationId } | null = f.strategy.kind === 'OPPORTUNIST' && f.strategy.sector !== null && state.time < f.strategy.until
      && state.war.sectors[f.strategy.sector].owner !== n ? { sector: f.strategy.sector, enemy: f.strategy.enemy ?? captor } : null;
    if (!t) {
      t = opportunistTarget(state, n, captor, victim);
      setStrategy(state, n, { kind: 'OPPORTUNIST', sector: t?.sector ?? null, enemy: t?.enemy ?? captor, until: state.time + 15000 });
    }
    // The jail fight is the biggest event of the match: a real party goes to crash it.
    let rest = take(byDistance(hunters, NATIONS[captor].jail), Math.max(2, Math.round(hunters.length * 0.5)), { kind: 'raidJail', jail: captor });
    if (state.tower.owner !== n) rest = take(rest, 1, { kind: 'takeTower' });
    if (t) {
      const left = sendUnits(units(rest), Math.ceil(rest.length * 0.6), (u) => ({ kind: 'assault', sector: t.sector, via: highRoute(state, u, 3) ? flankRoute(t.sector, u) : null }));
      rest = left.flat();
      snipers.forEach((sn, i) => { sn.ai.task = { kind: 'overwatch', sector: i % 2 ? t.sector : sectorAt(NATIONS[captor].jail.x, NATIONS[captor].jail.z) }; });
    }
    take(rest, 9, { kind: 'hunt', nation: captor });
    return;
  }

  f.posture = 'NORMAL';
  if (state.time >= f.strategy.until || f.strategy.kind === 'RESCUE_KING' || f.strategy.kind === 'HOLD_KING' || f.strategy.kind === 'OPPORTUNIST'
    || (f.strategy.kind === 'ATTACK_SECTOR' && f.strategy.sector !== null && state.war.sectors[f.strategy.sector].owner === n)
    || (f.strategy.kind !== 'DEFEND_SECTOR' && threat !== null)) {
    setStrategy(state, n, decideNormal(state, n, f.strategy));
  }
  const st = f.strategy;
  let pool = hunters;
  if (myKing?.alive && !myKing.jailed) {
    // One loose escort (more after a scare, or when protecting a lead): a crowd around the king gives it away.
    const escorts = (state.time - f.lastAllyCapturedAt < 15000 ? 2 : 1) + Math.floor(hunters.length / 10) + (st.kind === 'HOLD_LEAD' ? 1 : 0);
    pool = take(byDistance(pool, myKing), escorts, { kind: 'escortKing' });
  }
  const target = st.sector;
  let rest = units(pool);
  if (target !== null) {
    switch (st.kind) {
      case 'HUNT_KING': {
        // Go where the king was last seen (or lit up), not just to a sector's point; re-aimed every tick.
        const t = st.enemy ? kingTarget(state, n, st.enemy, 20000, 1.6) : null;
        const lead = t && t.nation === st.enemy ? t.lead : null;
        rest = sendUnits(rest, Math.ceil(pool.length * 0.8), () => ({ kind: 'huntKing', nation: st.enemy ?? t?.nation ?? 'sun', lead }));
        break;
      }
      case 'ATTACK_SECTOR':
        rest = sendUnits(rest, Math.ceil(pool.length * 0.8), (u) => ({ kind: 'assault', sector: target, via: highRoute(state, u, 3) ? flankRoute(target, u) : null }));
        break;
      case 'HOLD_LEAD':
        rest = sendUnits(rest, Math.ceil(pool.length * 0.5), () => ({ kind: 'defend', sector: target }));
        break;
      case 'TAKE_TOWER':
        rest = sendUnits(rest, Math.ceil(pool.length * 0.3), () => ({ kind: 'takeTower' }));
        rest = sendUnits(rest, Math.ceil(pool.length * 0.3), (u) => ({ kind: 'assault', sector: CENTRAL, via: highRoute(state, u, 2) ? flankRoute(CENTRAL, u) : null }));
        break;
      case 'DEFEND_SECTOR': case 'RECOVER':
        rest = sendUnits(rest, Math.ceil(pool.length * (st.kind === 'RECOVER' ? 0.5 : 0.6)), () => ({ kind: 'defend', sector: target }));
        break;
    }
    for (const sn of snipers) sn.ai.task = { kind: 'overwatch', sector: target };
    for (const kh of keyholders) kh.ai.task = { kind: 'standby', sector: target };
  }
  // Whatever the plan, a few always look for an enemy king (that is how the match is won):
  // they sweep the rear of the most exposed kingdom instead of wandering.
  if (st.kind !== 'HUNT_KING' && st.kind !== 'HOLD_LEAD' && st.kind !== 'RECOVER') {
    const k = Math.round(pool.length * tuning(state).kingHunt);
    const t = k > 0 ? kingTarget(state, n, st.enemy) : null;
    if (t) rest = sendUnits(rest, k, () => ({ kind: 'huntKing', nation: t.nation, lead: t.lead }));
  }
  // A second group holds a threatened front while the main force attacks elsewhere.
  if (threat !== null && st.kind !== 'DEFEND_SECTOR') sendUnits(rest, 2, () => ({ kind: 'defend', sector: threat }));
  // Communicators: the tower if it can be held, else support from the rear.
  if (state.tower.owner && state.tower.owner !== n && st.kind !== 'TAKE_TOWER') {
    const rear = rearSectors(state, n);
    for (const c of comms) if (rear.length) c.ai.task = { kind: 'rear', sector: rear[0] };
  }
}

/**
 * The tower with a communicator on our side (通信士×管制塔): reports of every enemy
 * fighting over a strategic point, or where a capture was just tried, reach the
 * whole nation (the commander plans with them; the AIs go and check).
 */
function towerIntel(state: GameState, n: NationId): void {
  if (state.tower.owner !== n || !state.entities.some((e) => e.nation === n && e.role === 'communicator' && e.alive && !e.jailed)) return;
  const f = state.factions[n];
  state.war.sectors.forEach((s, i) => {
    if (!s.contested && state.time - s.lastClashAt > 6000) return;
    const p = sectorPoint(i);
    for (const e of state.entities) {
      if (e.nation === n || !e.alive || e.jailed || Math.hypot(e.x - p.x, e.z - p.z) > POINT_R * 2.5) continue;
      const prev = f.intel.get(e.id);
      if (prev && state.time - prev.t < 1000) continue;
      f.intel.set(e.id, { id: e.id, x: e.x, y: e.y, z: e.z, vx: 0, vz: 0, t: state.time, since: state.time });
    }
  });
}

/**
 * Diplomacy (外交): when one kingdom is clearly ahead, the weakest may offer the
 * other a short ceasefire so both can turn on the leader. Rare by design: at most
 * twice a match, and never while one is already on.
 */
function diplomacy(state: GameState): void {
  const w = state.war;
  if (state.time < w.nextTruceCheckAt || w.proposal || trucesLeft(state) <= 0) return;
  w.nextTruceCheckAt = state.time + 30000;
  if (w.truces.some((t) => t.until > state.time)) return;
  const alive = NATION_IDS.filter((n) => kingOf(state, n)?.alive && !kingOf(state, n)?.jailed);
  if (alive.length < 3) return;
  const byStr = [...alive].sort((a, b) => strength(state, b) - strength(state, a));
  const [top, mid, low] = byStr;
  if (state.time < 90000 || strength(state, top) < Math.max(strength(state, mid) * 1.6, strength(state, mid) + 4)) return;
  proposeTruce(state, low, mid);
}

/**
 * When a commander (a nation with no people in it) lights the enemy kings: right away on
 * 初級; otherwise once a few hunters are out near enemy ground (the light lasts only
 * seconds, so it is wasted on hunters at home), with time running out, or after waiting 30 s.
 */
function maybeLightKings(state: GameState, n: NationId): void {
  if (state.humans.some((id) => state.entities[id].nation === n) || !canLightKings(state, n)) return;
  const f = state.factions[n];
  if (f.lightWaitFrom === null) f.lightWaitFrom = state.time;
  const enemyGround: { x: number; z: number }[] = state.war.sectors.map((s, i) => ({ s, i })).filter(({ s }) => s.owner && s.owner !== n).map(({ i }) => sectorPoint(i));
  for (const o of NATION_IDS) if (o !== n) enemyGround.push(NATIONS[o].base);
  const staged = state.entities.filter((e) => e.nation === n && e.alive && !e.jailed && HUNTER_ROLES.has(e.role)
    && enemyGround.some((p) => Math.hypot(p.x - e.x, p.z - e.z) < 1600)).length;
  if (tuning(state).kingHunt < 0.2 || staged >= 2 || timeLeftSec(state) < 40 || state.time - f.lightWaitFrom > 30000) {
    lightKings(state, n);
    f.lightWaitFrom = null;
  }
}

/** Runs each nation's commander once per second. */
export function factionTick(state: GameState): void {
  diplomacy(state);
  for (const n of NATION_IDS) {
    const f = state.factions[n];
    if (state.time < f.nextTickAt) continue;
    f.nextTickAt = state.time + tuning(state).strategyTickMs;
    maybeLightKings(state, n);
    towerIntel(state, n);
    updateBelief(state, n);
    formSquads(state, n); // people's squads first (the commander then leaves them alone)
    assign(state, n);
    formSquads(state, n);
  }
}

/** Called when one of a nation's characters is captured. */
export function noteAllyCaptured(state: GameState, n: NationId): void {
  state.factions[n].lastAllyCapturedAt = state.time;
  state.factions[n].nextTickAt = state.time; // react right away
}
