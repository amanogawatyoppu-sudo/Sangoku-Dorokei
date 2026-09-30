import type { Point } from '../config/nations';
import type { NationId } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import { HOTSPOTS, PERCHES as MAP_PERCHES, TOWER } from '../config/map';
import { AI_SPEED, AI_TURN_RATE, CAP_RANGE, SPRINT_SPEED } from '../config/constants';
import { tuning } from './difficulty';
import type { Entity } from '../sim/entity';
import { isHuman } from '../sim/entity';
import type { GameState } from '../sim/state';
import { elapsedSec, kingOf, speedMul, squadCommandOf } from '../sim/state';
import { SNIPE_RANGE, useSpecial } from '../sim/systems/abilities';
import { attemptCapture, captureCandidate } from '../sim/systems/capture';
import { SAME_LEVEL, dist, dist3 } from '../sim/systems/collision';
import { accelerate, moveToward, turnBy, turnToward } from '../sim/systems/movement';
import { lastStanding, tryStartRescue } from '../sim/systems/rescue';
import { kingLit } from '../sim/systems/tower';
import { canUseDecoy, decoyOf, useDecoy } from '../sim/decoy';
import { blocked, canWalk, inWater, supportHeight } from '../sim/systems/world';
import type { AiState, Sighting, Waypoint } from './memory';
import { chokePoints, navGraph, planPath, randomNodeNear } from './nav';
import { behind, neighbours, sectorPoint } from '../sim/war';
import { frontSectors, kingRefuge, rearPoint } from './strategy';
import { PERCEIVE_MS, perceive, predict } from './perception';

const THINK_MS = 220;

export function jailedAlly(state: GameState, e: Entity): Entity | null {
  const king = state.entities.find((t) => t.nation === e.nation && t.jailed && t.role === 'king');
  return king ?? state.entities.find((t) => t.nation === e.nation && t.jailed) ?? null;
}

/** Enemy search radius that widens as the match goes on (v6 idea, larger map). */
export function aggroRange(elapsed: number): number {
  return Math.min(900, 520 + elapsed * 1.3);
}

/** Places a sniper can shoot from: the two plateaus and the watch platforms. */
const PERCHES: readonly Waypoint[] = MAP_PERCHES;

// ---------------------------------------------------------------- movement plumbing

function setGoal(state: GameState, e: Entity, goal: Waypoint, st: AiState): void {
  const ai = e.ai;
  ai.state = st;
  const g = ai.goal;
  if (g && Math.hypot(g.x - goal.x, g.z - goal.z) < 45 && Math.abs(g.y - goal.y) < 20 && ai.path) return;
  ai.goal = goal;
  ai.path = null;
  ai.progressX = e.x;
  ai.progressZ = e.z;
  ai.progressAt = state.time;
}

function stop(e: Entity, st: AiState): void {
  e.ai.state = st;
  e.ai.goal = null;
  e.ai.path = null;
}

function plan(state: GameState, e: Entity): void {
  const ai = e.ai;
  if (!ai.goal || ai.path || state.time < ai.replanAt) return;
  ai.replanAt = state.time + 450;
  const g = ai.goal;
  if (Math.hypot(g.x - e.x, g.z - e.z) < 280 && Math.abs(g.y - e.y) < 8 && canWalk(e, g.x, g.y, g.z)) {
    ai.path = { points: [g], i: 0, goal: g };
    return;
  }
  const pts = planPath(e, g);
  ai.path = { points: pts && pts.length ? [...pts, g] : [g], i: 0, goal: g };
}

function speedFor(st: AiState): number {
  switch (st) {
    case 'CHASE': case 'INTERCEPT': case 'FLEE': case 'RESCUE': return 1;
    // Searching jogs, patrols and guards walk briskly: people only sprint when it matters.
    case 'SEARCH': case 'INVESTIGATE': case 'ESCORT': return 0.8;
    case 'PATROL': return 0.55;
    default: return 0.42;
  }
}

/** Follows the current path one step; handles waypoints, stuck detection and recovery. */
function follow(state: GameState, e: Entity, dt: number, speed: number): void {
  const ai = e.ai, now = state.time;
  plan(state, e);
  const path = ai.path;
  if (!path) { ai.progressAt = now; return; }
  let wp = path.points[path.i];
  // Passing points on the way count from a little further off (the turning circle at a run is wider
  // than 12 units: aiming for the exact spot makes people circle it); the destination itself is exact.
  while (wp && Math.hypot(wp.x - e.x, wp.z - e.z) < (path.i < path.points.length - 1 ? 26 : 12) && Math.abs(wp.y - e.y) < 24) {
    path.i++;
    wp = path.points[path.i];
  }
  if (!wp) {
    // Arrived: on a patrol or search, stop for a moment and look around, as a person would.
    if (ai.state === 'PATROL' || ai.state === 'SEARCH') ai.idleUntil = now + 500 + state.rng() * 1800;
    ai.path = null; ai.goal = null; ai.progressAt = now;
    return;
  }
  // A waypoint it has been near for a while without reaching (a ledge, a crowd): move on.
  if (path.i !== ai.wpIndex) { ai.wpIndex = path.i; ai.wpAt = now; }
  else if (now - ai.wpAt > 1200 && Math.hypot(wp.x - e.x, wp.z - e.z) < 60 && path.i + 1 < path.points.length) {
    path.i++;
    ai.wpIndex = path.i;
    ai.wpAt = now;
    wp = path.points[path.i];
  }
  moveToward(e, wp.x, wp.z, dt, speed);
  if (Math.hypot(e.x - ai.progressX, e.z - ai.progressZ) > 20) {
    ai.progressX = e.x;
    ai.progressZ = e.z;
    ai.progressAt = now;
  } else {
    const stuck = (now - ai.progressAt) / 1000;
    ai.maxStuckSec = Math.max(ai.maxStuckSec, stuck);
    if (stuck > 1.2) {
      // Unstick: step to a random nearby node, then replan to the real goal.
      const n = randomNodeNear(e.x, e.y, e.z, 90, state.rng);
      ai.path = n ? { points: [{ x: n.x, y: n.y, z: n.z }, ...(ai.goal ? [ai.goal] : [])], i: 0, goal: ai.goal ?? n } : null;
      ai.progressX = e.x;
      ai.progressZ = e.z;
      ai.progressAt = now;
      if (!n) ai.replanAt = 0;
    }
  }
}

// ---------------------------------------------------------------- targeting helpers

/** Enemies in view that this AI has had time to react to. */
function visibleEnemies(state: GameState, e: Entity): Entity[] {
  const now = state.time;
  return e.ai.visible
    .filter((id) => now - (e.ai.seen.get(id)?.since ?? now) >= tuning(state).reactionMs)
    .map((id) => state.entities[id])
    .filter((t) => t.alive && !t.jailed);
}

/** An enemy in view that this AI has not reacted to yet (nearest), if any. */
function noticing(state: GameState, e: Entity): Entity | null {
  const now = state.time;
  let best: Entity | null = null, bd = Infinity;
  for (const id of e.ai.visible) {
    const s = e.ai.seen.get(id);
    if (!s || now - s.since >= tuning(state).reactionMs) continue;
    const t = state.entities[id], d = dist(e, t);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function nearestVisible(state: GameState, e: Entity, range: number, near: Point = e): Entity | null {
  let best: Entity | null = null, bd = range;
  for (const t of visibleEnemies(state, e)) {
    const d = dist(t, near);
    if (d < bd) { best = t; bd = d; }
  }
  return best;
}

/** Choose whom to chase: close, king-like (nation belief), and from the nation we are hunting. */
function pickPrey(state: GameState, e: Entity, range: number): Entity | null {
  const belief = state.factions[e.nation].belief;
  const task = e.ai.task;
  const hunt = task?.kind === 'hunt' || task?.kind === 'huntKing' ? task.nation : null;
  const kingHunt = task?.kind === 'huntKing';
  let best: Entity | null = null, bs = Infinity;
  for (const t of visibleEnemies(state, e)) {
    const d = dist3(t, e);
    if (d > range) continue;
    // A king hunter looks past the small fry: king-like and lit-up enemies count for much more.
    const s = d - (belief.get(t.id) ?? 0) * (kingHunt ? 110 : 60) - (hunt === t.nation ? 150 : 0)
      - (kingLit(state, t, e.nation) ? 600 : 0) + (Math.abs(t.y - e.y) > SAME_LEVEL ? 120 : 0);
    if (s < bs) { bs = s; best = t; }
  }
  return best;
}

function chaseRank(state: GameState, e: Entity, targetId: number): number {
  const mates = state.entities
    .filter((o) => o.nation === e.nation && !isHuman(o) && o.alive && !o.jailed && (o.ai.state === 'CHASE' || o.ai.state === 'INTERCEPT') && o.ai.targetId === targetId)
    .sort((a, b) => a.id - b.id);
  const i = mates.indexOf(e);
  return i < 0 ? mates.length : i;
}

/**
 * Pursuit with roles: the first chaser goes for the back, the second cuts off
 * the predicted escape, others come in from the side.
 */
function chase(state: GameState, e: Entity, t: Entity): void {
  const ai = e.ai;
  ai.targetId = t.id;
  const rank = chaseRank(state, e, t.id);
  const s = ai.seen.get(t.id)!;
  const d = dist(e, t);
  const tdx = t.dirX, tdz = t.dirZ;
  let goal: Waypoint;
  let st: AiState = 'CHASE';
  const tn = tuning(state);
  const ambusher = tn.ambush === 'rangersAndSoldiers' ? e.role === 'ranger' || (e.role === 'soldier' && rank > 1) : tn.ambush === 'rangers' && e.role === 'ranger';
  const ambush = ambusher && rank > 0 && d >= 130 ? ambushSpot(e, t, s) : null;
  // On easy, followers often just run after the target instead of cutting it off.
  const plain = rank > 0 && (e.id * 7919 + rank * 31 + Math.floor(state.time / 4000)) % 100 >= tn.flankChance * 100;
  if (ambush) {
    // Rangers don't chase from behind when others already are: they cut ahead to a stair exit or bridge.
    ai.chaseRole = 'ambush';
    st = 'INTERCEPT';
    goal = ambush;
    if (e.cd.special <= 0 && Math.hypot(ambush.x - e.x, ambush.z - e.z) > 250) useSpecial(state, e);
  } else if (rank === 0 || d < 130 || plain) {
    ai.chaseRole = 'direct';
    goal = d < 200 ? { x: t.x - tdx * 34, y: t.y, z: t.z - tdz * 34 } : { x: t.x, y: t.y, z: t.z };
  } else if (rank === 1) {
    ai.chaseRole = 'intercept';
    st = 'INTERCEPT';
    const speed = Math.hypot(s.vx, s.vz);
    const ahead = speed > 60 ? Math.min(320, speed * 1.4) : 120;
    const ux = speed > 60 ? s.vx / speed : tdx, uz = speed > 60 ? s.vz / speed : tdz;
    goal = { x: t.x + ux * ahead, y: t.y, z: t.z + uz * ahead };
  } else {
    ai.chaseRole = 'flank';
    st = 'INTERCEPT';
    ai.flankSide = rank % 2 ? 1 : -1;
    goal = { x: t.x - tdz * 110 * ai.flankSide + tdx * 40, y: t.y, z: t.z + tdx * 110 * ai.flankSide + tdz * 40 };
  }
  setGoal(state, e, goal, st);
  if (ai.path && ai.path.points.length === 1) ai.path.points[0] = goal;
}

/**
 * Where a ranger can get ahead of a fleeing enemy: a stair exit, ramp end or bridge
 * a little along the enemy's way, that the ranger can reach first.
 */
function ambushSpot(e: Entity, t: Entity, s: Sighting): Waypoint | null {
  const speed = Math.hypot(s.vx, s.vz);
  if (speed < 60) return null;
  const ux = s.vx / speed, uz = s.vz / speed;
  let best: Waypoint | null = null, bs = Infinity;
  for (const c of chokePoints()) {
    const ax = c.x - t.x, az = c.z - t.z;
    const along = ax * ux + az * uz;
    if (along < 80 || along > 700) continue;
    const off = Math.abs(ax * uz - az * ux);
    if (off > 220) continue;
    const mine = Math.hypot(c.x - e.x, c.z - e.z), theirs = Math.hypot(ax, az);
    if (mine > theirs * 1.4 + 100) continue; // can't get there first
    const score = off + along * 0.4 + mine * 0.3;
    if (score < bs) { bs = score; best = { x: c.x, y: c.y, z: c.z }; }
  }
  return best;
}

/** Rangers answer fights: the latest capture attempt or the freshest report of an enemy. */
function respond(state: GameState, e: Entity): boolean {
  const f = state.factions[e.nation];
  let spot: Waypoint | null = null;
  if (f.fight && state.time - f.fight.t < 10000 && Math.hypot(f.fight.x - e.x, f.fight.z - e.z) < 2600) spot = { x: f.fight.x, y: f.fight.y, z: f.fight.z };
  else {
    let bt = -Infinity;
    for (const s of f.intel.values()) {
      const t = state.entities[s.id];
      if (state.time - s.t > 5000 || !t.alive || t.jailed || s.t <= bt || Math.hypot(s.x - e.x, s.z - e.z) > 2200) continue;
      bt = s.t;
      spot = predict(s, state.time);
    }
  }
  if (!spot) return false;
  if (Math.hypot(spot.x - e.x, spot.z - e.z) < 60) return false;
  if (e.cd.special <= 0 && Math.hypot(spot.x - e.x, spot.z - e.z) > 450) useSpecial(state, e);
  setGoal(state, e, spot, 'INVESTIGATE');
  return true;
}

function startSearch(state: GameState, e: Entity, s: Sighting): void {
  const p = predict(s, state.time);
  e.ai.searchCenter = p;
  e.ai.searchUntil = state.time + tuning(state).searchMs;
  e.ai.targetId = s.id;
  setGoal(state, e, p, 'SEARCH');
}

function continueSearch(state: GameState, e: Entity): boolean {
  const ai = e.ai;
  if (!ai.searchCenter || state.time > ai.searchUntil) { ai.searchCenter = null; return false; }
  if (!ai.goal) {
    const c = ai.searchCenter;
    const n = randomNodeNear(c.x, c.y, c.z, 190, state.rng);
    if (n) setGoal(state, e, { x: n.x, y: n.y, z: n.z }, 'SEARCH');
  } else ai.state = 'SEARCH';
  return true;
}

function patrol(state: GameState, e: Entity): void {
  const ai = e.ai;
  if (ai.state === 'PATROL' && ai.goal) return;
  const focus = state.teamFocus[e.nation];
  const hunt = ai.task?.kind === 'hunt' ? ai.task.nation : null;
  let p: Point;
  const r = state.rng();
  const front = frontSectors(state, e.nation);
  if (front.length && state.rng() < 0.45) {
    // Free hands drift to the front: between an own front point and the enemy's.
    const id = front[Math.floor(state.rng() * front.length)];
    const enemyNb = [...neighbours(id)].filter((b) => { const o = state.war.sectors[b].owner; return o && o !== e.nation; });
    const a = sectorPoint(id), b = enemyNb.length ? sectorPoint(enemyNb[Math.floor(state.rng() * enemyNb.length)]) : a;
    const k = 0.3 + state.rng() * 0.3;
    p = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  } else if (focus && r < 0.6) p = focus;
  else if (hunt && r < 0.6) p = NATIONS[hunt].base;
  else if (r < 0.8) {
    const total = HOTSPOTS.reduce((a, h) => a + h.weight, 0);
    let k = state.rng() * total;
    p = HOTSPOTS.find((h) => (k -= h.weight) < 0) ?? HOTSPOTS[0];
  } else {
    const others = NATION_IDS.filter((n) => n !== e.nation);
    p = NATIONS[others[Math.floor(state.rng() * others.length)]].base;
  }
  const n = randomNodeNear(p.x, 0, p.z, 150, state.rng);
  if (n) setGoal(state, e, { x: n.x, y: n.y, z: n.z }, 'PATROL');
}

/** Investigate a fresh report from allies (not something this AI saw itself). */
function investigate(state: GameState, e: Entity): boolean {
  let best: Sighting | null = null, bd = 1400;
  for (const s of state.factions[e.nation].intel.values()) {
    if (state.time - s.t > 6000) continue;
    const t = state.entities[s.id];
    if (!t.alive || t.jailed) continue;
    // Something I am looking at right now but have not reacted to yet: not a report.
    if (e.ai.visible.includes(s.id)) continue;
    const d = Math.hypot(s.x - e.x, s.z - e.z);
    if (d > bd) continue;
    const already = state.entities.filter((o) => o !== e && o.nation === e.nation && o.ai.targetId === s.id && o.ai.state !== 'PATROL').length;
    if (already >= 2) continue;
    best = s;
    bd = d;
  }
  if (!best) return false;
  e.ai.targetId = best.id;
  setGoal(state, e, predict(best, state.time), 'INVESTIGATE');
  return true;
}

/** Flee to a reachable spot away from the threat, preferring allies' direction. */
function flee(state: GameState, e: Entity, threat: Entity): void {
  const allies = state.entities.filter((o) => o.nation === e.nation && o !== e && o.alive && !o.jailed);
  let best: Waypoint | null = null, bs = -Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = e.x + Math.cos(a) * 260, z = e.z + Math.sin(a) * 260;
    const n = randomNodeNear(x, e.y, z, 40, state.rng);
    if (!n) continue;
    const away = Math.hypot(n.x - threat.x, n.z - threat.z);
    const ally = allies.length ? Math.min(...allies.map((o) => Math.hypot(o.x - n.x, o.z - n.z))) : 800;
    const score = away - ally * 0.35;
    if (score > bs) { bs = score; best = { x: n.x, y: n.y, z: n.z }; }
  }
  if (best) setGoal(state, e, best, 'FLEE');
}

function around(p: Point, e: Entity, r: number, y = 0): Waypoint {
  const a = e.id * 2.39996;
  return { x: p.x + Math.cos(a) * r, y, z: p.z + Math.sin(a) * r };
}

// ---------------------------------------------------------------- role brains

/** Reacts to enemies in view; returns true if it took a hostile action. */
function engage(state: GameState, e: Entity, range: number, near?: Point): boolean {
  const t = near ? nearestVisible(state, e, range, near) : pickPrey(state, e, range);
  if (!t) return false;
  chase(state, e, t);
  // Rangers sprint to close a gap.
  if (e.role === 'ranger' && e.cd.special <= 0 && dist(e, t) > 180) useSpecial(state, e);
  return true;
}

/** Whether a sniper takes an aligned shot now (always on 標準/上級; on 初級 it often hesitates). */
function steadyHands(state: GameState): boolean {
  const c = tuning(state).sniperFireChance;
  return c >= 1 || state.rng() < c;
}

function lostTargetSearch(state: GameState, e: Entity): boolean {
  const ai = e.ai;
  if ((ai.state === 'CHASE' || ai.state === 'INTERCEPT') && ai.targetId !== null) {
    const s = ai.seen.get(ai.targetId);
    if (s && state.time - s.t < tuning(state).followUpMs) { startSearch(state, e, s); return true; }
  }
  return ai.state === 'SEARCH' && continueSearch(state, e);
}

function hunterThink(state: GameState, e: Entity, aggro: number): void {
  const task = e.ai.task ?? (e.guardUntil > state.time ? { kind: 'guardJail' as const } : null);
  switch (task?.kind) {
    case 'guardJail': {
      const j = NATIONS[e.nation].jail;
      if (engage(state, e, 280, j)) return;
      setGoal(state, e, around(j, e, 90), 'GUARD');
      return;
    }
    case 'rescueEscort': case 'raidJail': {
      const j = NATIONS[task.jail].jail;
      if (task.kind === 'rescueEscort' && escortKeyholder(state, e, j)) return;
      if (engage(state, e, 300, j)) return;
      setGoal(state, e, around(j, e, task.kind === 'raidJail' ? 200 : 80), task.kind === 'raidJail' ? 'INVESTIGATE' : 'RESCUE');
      return;
    }
    case 'escortKing': {
      // While the king's double stands in, the screen goes with the double.
      const king = decoyOf(state, e.nation) ?? kingOf(state, e.nation);
      if (king && engage(state, e, 230, king)) return;
      // Still on the way back to a distant king: deal with enemies met en route.
      if (king && dist(e, king) > 400 && engage(state, e, 260, e)) return;
      // A loose screen, not a ring of bodyguards (that would give the king away).
      if (king) setGoal(state, e, { x: king.x - king.dirX * 110 + (e.id % 2 ? 90 : -90), y: king.y, z: king.z - king.dirZ * 110 }, 'ESCORT');
      return;
    }
    case 'assault': case 'defend': {
      const p = sectorPoint(task.sector);
      // Fight whoever is on or near the point, and anyone met on the way.
      if (engage(state, e, task.kind === 'defend' ? 420 : 380, p)) return;
      if (engage(state, e, aggro)) return; // anyone met on the way, as usual
      if (lostTargetSearch(state, e)) return;
      // Rangers answer a fight first (then rejoin the operation).
      if (e.role === 'ranger' && respond(state, e)) return;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      // A flanking group goes round by the second route first (stairs, footbridge, high ground).
      if (task.kind === 'assault' && task.via && d > 380 && Math.hypot(task.via.x - e.x, task.via.z - e.z) > 60) {
        setGoal(state, e, task.via, 'INVESTIGATE');
        return;
      }
      if (task.kind === 'assault' && task.via && Math.hypot(task.via.x - e.x, task.via.z - e.z) <= 60) task.via = null;
      if (d > 140) {
        if (e.role === 'ranger' && e.cd.special <= 0 && d > 600) useSpecial(state, e);
        setGoal(state, e, around(p, e, 70, p.y), 'INVESTIGATE');
      } else if (!e.ai.goal || state.rng() < 0.08) {
        // On the point: hold it, moving about a little and watching.
        setGoal(state, e, around(p, e, 40 + ((e.id * 37) % 90), p.y), 'GUARD');
      }
      return;
    }
    case 'huntKing': {
      // Anyone met is fair game (the king first, see pickPrey); a lost target is looked for as usual.
      if (engage(state, e, aggro + 60)) return;
      if (lostTargetSearch(state, e)) return;
      const lead = task.lead;
      if (lead) {
        const d = Math.hypot(lead.x - e.x, lead.z - e.z);
        if (d > 90) {
          if (e.role === 'ranger' && e.cd.special <= 0 && d > 500) useSpecial(state, e);
          setGoal(state, e, around(lead, e, Math.min(60, d / 4), lead.y), 'INVESTIGATE');
          return;
        }
        // At the lead and nobody in sight: comb the streets around it.
        startSearch(state, e, { id: -1, x: lead.x, y: lead.y, z: lead.z, t: state.time, since: state.time, vx: 0, vz: 0 });
        e.ai.targetId = null;
        return;
      }
      // No lead: sweep the places that nation's king keeps to (its rear and base), each hunter its own.
      const spot = sweepSpot(state, e, task.nation);
      const g = e.ai.goal;
      if (e.ai.state === 'INVESTIGATE' && g && Math.hypot(g.x - spot.x, g.z - spot.z) < 320) return;
      if (e.role === 'ranger' && e.cd.special <= 0 && Math.hypot(spot.x - e.x, spot.z - e.z) > 700) useSpecial(state, e);
      const n = randomNodeNear(spot.x, 0, spot.z, 260, state.rng);
      setGoal(state, e, n ? { x: n.x, y: n.y, z: n.z } : { x: spot.x, y: 0, z: spot.z }, 'INVESTIGATE');
      return;
    }
    case 'takeTower':
      if (engage(state, e, 240)) return;
      setGoal(state, e, around(TOWER, e, 60), 'GUARD');
      return;
    default:
  }
  if (engage(state, e, aggro)) return;
  if (lostTargetSearch(state, e)) return;
  // A jailed ally nearby is worth checking on.
  if (e.role === 'ranger' && respond(state, e)) return;
  const ally = jailedAlly(state, e);
  if (ally && ally.capturedBy && dist(e, NATIONS[ally.capturedBy].jail) < 900 && state.rng() < 0.5) {
    setGoal(state, e, around(NATIONS[ally.capturedBy].jail, e, 120), 'RESCUE');
    return;
  }
  if (e.ai.state !== 'INVESTIGATE' || !e.ai.goal) {
    if (investigate(state, e)) return;
  } else return;
  patrol(state, e);
}

/**
 * Where a king hunter without a lead looks: the places that nation's king keeps to
 * (its base and the sectors behind its front), a different one per hunter, moving on
 * every 25 s or so, so a search party spreads out instead of piling onto one spot.
 */
function sweepSpot(state: GameState, e: Entity, o: NationId): Point {
  const cands: Point[] = [NATIONS[o].base];
  for (const id of state.war.sectors.map((_s, i) => i).filter((i) => state.war.sectors[i].owner === o)) cands.push(behind(id, o, 150));
  return cands[(e.id + Math.floor(state.time / 25000)) % cands.length];
}

/**
 * Rescue escorts travel with the keyholder until it is near the jail (it is the
 * only one who can open it), dealing with anyone who comes for it on the way.
 */
function escortKeyholder(state: GameState, e: Entity, j: Point): boolean {
  const kh = state.entities.find((o) => o.nation === e.nation && o.role === 'keyholder' && o.alive && !o.jailed);
  if (!kh || dist(kh, j) < 420) return false;
  if (engage(state, e, 260, kh)) return true;
  const side = e.id % 2 ? 1 : -1;
  setGoal(state, e, { x: kh.x - kh.dirZ * 45 * side + kh.dirX * 30, y: kh.y, z: kh.z + kh.dirX * 45 * side + kh.dirZ * 30 }, 'ESCORT');
  return true;
}

const overwatchCache = new Map<string, Waypoint>();
/** High ground covering a sector's point: a perch within reach, else the highest walkable spot nearby, else behind the point. */
function overwatchSpot(sector: number, id: number): Waypoint {
  const key = sector + ':' + (id % 2);
  const hit = overwatchCache.get(key);
  if (hit) return hit;
  const p = sectorPoint(sector);
  const perches = PERCHES.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 800).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
  let spot: Waypoint | null = perches.length ? { ...perches[id % 2 % perches.length] } : null;
  if (!spot) {
    const high = navGraph().nodes.filter((c) => c.reachable && c.y >= 25 && Math.hypot(c.x - p.x, c.z - p.z) > 150 && Math.hypot(c.x - p.x, c.z - p.z) < 900)
      .sort((a, b) => b.y - a.y || a.id - b.id);
    if (high.length) spot = { x: high[id % 2 % high.length].x, y: high[id % 2 % high.length].y, z: high[id % 2 % high.length].z };
  }
  if (!spot) spot = { x: p.x + (id % 2 ? 260 : -260), y: p.y, z: p.z + 180 };
  overwatchCache.set(key, spot);
  return spot;
}

function sniperThink(state: GameState, e: Entity): void {
  const threat = nearestVisible(state, e, 130);
  if (threat && Math.abs(threat.y - e.y) < SAME_LEVEL) { flee(state, e, threat); return; }
  const target = nearestVisible(state, e, SNIPE_RANGE);
  if (target) {
    // Swing round toward the target (not instantly) and fire only once lined up.
    const dx = target.x - e.x, dz = target.z - e.z;
    e.ai.lookAt = { x: target.x, z: target.z };
    e.ai.aimId = target.id;
    const d = Math.hypot(dx, dz) || 1;
    if ((e.dirX * dx + e.dirZ * dz) / d > 0.997 && e.cd.special <= 0 && steadyHands(state)) useSpecial(state, e);
  } else { e.ai.lookAt = null; e.ai.aimId = null; }
  const task = e.ai.task;
  if (task?.kind === 'rescueEscort') {
    if (escortKeyholder(state, e, NATIONS[task.jail].jail)) return;
    setGoal(state, e, around(NATIONS[task.jail].jail, e, 200), 'RESCUE');
    return;
  }
  if (task?.kind === 'guardJail') { setGoal(state, e, around(NATIONS[e.nation].jail, e, 160), 'GUARD'); return; }
  if (task?.kind === 'overwatch') {
    // Cover the sector from high ground near it (a rooftop perch, footbridge, expressway or hill), not from the point itself.
    const spot = overwatchSpot(task.sector, e.id);
    if (Math.hypot(spot.x - e.x, spot.z - e.z) > 40 || Math.abs(spot.y - e.y) > 10) setGoal(state, e, spot, 'HOLD');
    else stop(e, 'HOLD');
    return;
  }
  const base = NATIONS[e.nation].base;
  const perch = [...PERCHES].sort((a, b) => Math.hypot(a.x - base.x, a.z - base.z) - Math.hypot(b.x - base.x, b.z - base.z))[e.id % 2];
  if (Math.hypot(perch.x - e.x, perch.z - e.z) > 70 || Math.abs(perch.y - e.y) > 10) setGoal(state, e, perch, 'HOLD');
  else stop(e, 'HOLD');
}

function communicatorThink(state: GameState, e: Entity): void {
  const threat = nearestVisible(state, e, 120);
  if (threat && dist(e, TOWER) > TOWER.r) { flee(state, e, threat); return; }
  const task = e.ai.task;
  if (task?.kind === 'rear') {
    // The tower is the enemy's: pass on what we can from a safe spot in the rear.
    const p = sectorPoint(task.sector);
    if (Math.hypot(p.x - e.x, p.z - e.z) > 200) setGoal(state, e, around(p, e, 120, p.y), 'HOLD');
    return;
  }
  if (dist(e, TOWER) > TOWER.r - 10) setGoal(state, e, around(TOWER, e, 58), 'HOLD');
  else { stop(e, 'HOLD'); useSpecial(state, e); }
}

function keyholderThink(state: GameState, e: Entity): void {
  const task = e.ai.task;
  const king = kingOf(state, e.nation);
  const ally = task?.kind === 'rescueKing' && king?.jailed ? king : jailedAlly(state, e);
  const threat = nearestVisible(state, e, 110);
  if (threat && (!ally || dist(e, ally) > 70)) { flee(state, e, threat); return; }
  if (ally && ally.capturedBy) {
    if (dist3(e, ally) < 42) { stop(e, 'RESCUE'); if (!e.channeling) tryStartRescueQuiet(state, e); return; }
    const j = NATIONS[ally.capturedBy].jail;
    // Don't walk into the guards alone: wait at a staging point until an escort
    // is fighting at the jail (or no guard is in sight).
    const guarded = visibleEnemies(state, e).some((t) => dist(t, j) < 200);
    const escortIn = state.entities.some((o) => o.nation === e.nation && o !== e && o.alive && !o.jailed
      && (o.ai.task?.kind === 'rescueEscort' || isHuman(o)) && dist(o, j) < 230);
    const dj = dist(e, j);
    if (dj < 380 && guarded && !escortIn) {
      const k = 340 / (dj || 1);
      setGoal(state, e, { x: j.x + (e.x - j.x) * k, y: 0, z: j.z + (e.z - j.z) * k }, 'RESCUE');
      return;
    }
    setGoal(state, e, { x: ally.x + (e.x < ally.x ? -28 : 28), y: ally.y, z: ally.z }, 'RESCUE');
    return;
  }
  // Not needed yet: wait a little behind the fighting (or at home), ready to go.
  const b = task?.kind === 'standby' ? behind(task.sector, e.nation, 420) : NATIONS[e.nation].base;
  if (!e.ai.goal || Math.hypot(e.ai.goal.x - b.x, e.ai.goal.z - b.z) > 260) {
    const n = randomNodeNear(b.x, 0, b.z, 120, state.rng);
    if (n) setGoal(state, e, { x: n.x, y: n.y, z: n.z }, 'GUARD');
  }
}

function tryStartRescueQuiet(state: GameState, e: Entity): void {
  if (e.cd.special > 0) return;
  tryStartRescue(state, e);
}

function kingThink(state: GameState, e: Entity): void {
  const persona = e.kingPersona ?? 'cautious';
  const threat = nearestVisible(state, e, persona === 'aggressive' ? 110 : 240);
  // Chased: stand a double in (once a match) and slip away.
  if (threat && dist(e, threat) < 200 && canUseDecoy(state, e) && state.rng() < 0.3) useDecoy(state, e);
  if (threat) {
    if (persona === 'aggressive' && dist(e, threat) < CAP_RANGE && state.rng() < 0.3) attemptCapture(state, e);
    if (persona !== 'aggressive' || dist(e, threat) < 70) { flee(state, e, threat); return; }
  }
  if (e.ai.state === 'FLEE' && e.ai.goal) return;
  // Kings can open a lock too: free a jailed ally when the jail is close and nobody is around.
  const pal = jailedAlly(state, e);
  if (pal && !threat && dist(e, pal) < 320) {
    if (dist3(e, pal) < 42) { stop(e, 'RESCUE'); if (!e.channeling) tryStartRescueQuiet(state, e); }
    else setGoal(state, e, { x: pal.x + (e.x < pal.x ? -28 : 28), y: pal.y, z: pal.z }, 'RESCUE');
    return;
  }
  if (e.ai.goal && e.ai.state !== 'FLEE') return;
  // Kings keep to their own rear territory (not only the base), moving about; bolder ones
  // go as far as their own front sectors, never beyond.
  let anchor: Point = state.rng() < 0.6 ? kingRefuge(state, e.nation) : rearPoint(state, e.nation);
  if (persona === 'commander' && state.tower.owner === e.nation && state.rng() < 0.5) anchor = TOWER;
  if (persona === 'aggressive' || persona === 'lurker') {
    const front = frontSectors(state, e.nation);
    if (front.length && state.rng() < (persona === 'aggressive' ? 0.5 : 0.25)) anchor = behind(front[Math.floor(state.rng() * front.length)], e.nation, 350);
    else anchor = rearPoint(state, e.nation);
  }
  const n = randomNodeNear(anchor.x, 0, anchor.z, persona === 'cautious' ? 160 : 220, state.rng);
  if (n) setGoal(state, e, { x: n.x, y: n.y, z: n.z }, 'PATROL');
}

// ---------------------------------------------------------------- squads

/** Formation spots behind the leader: [units back, units to the right]. */
const FORMATION: readonly [number, number][] = [[-48, 42], [-48, -42], [-95, 20], [-95, -20]];
/** Sector each slot watches when the squad stops (radians from the leader's facing): front-right, front-left, rear, rear. */
/** 周りを警戒 (C): followers ring the person this far out, each facing outward. */
const RING_R = 62;
const ringOrder = (state: GameState, L: Entity) => isHuman(L) && squadCommandOf(state, L).order === 'spread';
/** A follower's direction (world yaw) from the leader in the ring: evenly spaced. */
function ringAngle(state: GameState, e: Entity, L: Entity): number {
  const n = Math.max(1, state.entities.filter((o) => o.ai.leaderId === L.id && o.alive && !o.jailed).length);
  // Fixed compass directions, so turning on the spot doesn't send everyone running round.
  return ((e.ai.slot % n) + 0.5) * ((Math.PI * 2) / n);
}
const WATCH: readonly number[] = [0.6, -0.6, Math.PI, Math.PI - 0.6];

/** The leader this character follows, if the squad is still valid. */
function leaderOf(state: GameState, e: Entity): Entity | null {
  const id = e.ai.leaderId;
  if (id === null) return null;
  const L = state.entities[id];
  return L && L.alive && !L.jailed ? L : null;
}

/**
 * The floor height of a spot someone could stand on next to the leader — no wall, a floor
 * near the leader's level (not thin air beside a bridge or a walkway; slopes are fine), not
 * in the water — or null.
 */
function standAt(x: number, z: number, y: number): number | null {
  const h = supportHeight(x, z, y + 15);
  if (h < y - 22 || blocked(x, z, h) || inWater(x, z, h)) return null;
  return h;
}

/** Where a follower should stand: its slot behind the leader, else straight behind, else right where the leader is. */
function formationSpot(state: GameState, e: Entity, L: Entity): Waypoint {
  if (ringOrder(state, L)) {
    // 周りを警戒: stand in a ring around the leader.
    const a = ringAngle(state, e, L);
    const x = L.x + Math.sin(a) * RING_R, z = L.z + Math.cos(a) * RING_R;
    const h = standAt(x, z, L.y);
    if (h !== null) return { x, y: h, z };
  }
  const [back, side] = FORMATION[e.ai.slot % FORMATION.length];
  const rx = -L.dirZ, rz = L.dirX;
  const x = L.x + L.dirX * back + rx * side, z = L.z + L.dirZ * back + rz * side;
  const h = standAt(x, z, L.y);
  if (h !== null) return { x, y: h, z };
  const bx = L.x + L.dirX * back, bz = L.z + L.dirZ * back;
  const hb = standAt(bx, bz, L.y);
  if (hb !== null) return { x: bx, y: hb, z: bz };
  return { x: L.x, y: L.y, z: L.z };
}

/**
 * A squad member's decision: fight what the squad sees, help with the leader's
 * chase or search, carry out the player's order (follow / spread / hold), and
 * otherwise keep formation. Returns false when there is no squad to follow.
 */
function squadThink(state: GameState, e: Entity, L: Entity, aggro: number): boolean {
  const ai = e.ai;
  if (e.role === 'sniper') {
    // A sniper in the squad still shoots from where it stands.
    const t = nearestVisible(state, e, SNIPE_RANGE);
    ai.aimId = t ? t.id : null;
    ai.lookAt = t ? { x: t.x, z: t.z } : null;
    if (t && (e.dirX * (t.x - e.x) + e.dirZ * (t.z - e.z)) / (dist(e, t) || 1) > 0.997 && e.cd.special <= 0 && steadyHands(state)) useSpecial(state, e);
    if (t && dist(e, t) < 380) { stop(e, 'HOLD'); return true; }
  } else {
    if (engage(state, e, isHuman(L) ? (ringOrder(state, L) ? 520 : 420) : Math.min(aggro, 520))) return true;
    if (dist(e, L) < 600 && lostTargetSearch(state, e)) return true;
  }
  if (isHuman(L)) {
    const cmd = squadCommandOf(state, L);
    const a = cmd.anchor ?? L;
    if (cmd.order === 'hold') {
      const ang = e.ai.slot * 2.1;
      setGoal(state, e, { x: a.x + Math.cos(ang) * 70, y: a.y, z: a.z + Math.sin(ang) * 70 }, 'GUARD');
      return true;
    }
  } else {
    // Help the leader with its chase or search.
    const lt = L.ai.targetId;
    if (lt !== null && (L.ai.state === 'CHASE' || L.ai.state === 'INTERCEPT' || L.ai.state === 'SEARCH' || L.ai.state === 'INVESTIGATE')) {
      const s = ai.seen.get(lt) ?? state.factions[e.nation].intel.get(lt);
      if (s && state.time - s.t < 6000) {
        ai.targetId = lt;
        setGoal(state, e, predict(s, state.time), 'INVESTIGATE');
        return true;
      }
    }
  }
  if (ai.state !== 'SQUAD') { ai.goal = null; ai.path = null; }
  ai.state = 'SQUAD';
  return true;
}

/** Keep formation: walk straight to the slot when it is close and clear, else take a route; catch up when behind. */
function squadMove(state: GameState, e: Entity, L: Entity, dt: number): void {
  const ai = e.ai, now = state.time;
  const spot = formationSpot(state, e, L);
  // A walking leader: aim a little ahead of where it is going.
  const lead = Math.max(0, L.speed) * 0.35;
  if (lead > 5 && !blocked(spot.x + L.dirX * lead, spot.z + L.dirZ * lead, L.y)) { spot.x += L.dirX * lead; spot.z += L.dirZ * lead; }
  const d = Math.hypot(spot.x - e.x, spot.z - e.z);
  // A person's squad runs to keep up (people walk as fast as the AI and dash faster).
  const catchUp = isHuman(L) ? Math.max(0.4, Math.min(1.75, 0.35 + d / 160)) : Math.max(0.4, Math.min(1.05, 0.35 + d / 220));
  const speed = AI_SPEED * e.gait * speedMul(state) * catchUp;
  if (now >= ai.directAt) {
    ai.directAt = now + 300;
    ai.directOk = d < 450 && Math.abs(L.y - e.y) < 20 && canWalk(e, spot.x, e.y, spot.z, 16);
  }
  if (ai.directOk) ai.bestSpotD = Infinity;
  if (!ai.directOk) {
    // The spot moves with the leader: keep the route and move its end along, rather than
    // dropping it every time the leader moves on — but only while the route's last real
    // waypoint is still near the spot (stretched further, its last leg would cut through
    // buildings, so a fresh route is planned instead).
    const g = ai.goal, path = ai.path;
    const lastNav = path && path.points.length > 1 ? path.points[path.points.length - 2] : null;
    const stretchable = !lastNav || (Math.hypot(lastNav.x - spot.x, lastNav.z - spot.z) < 250 && Math.abs(lastNav.y - spot.y) < 20);
    if (g && path && ai.state === 'SQUAD' && stretchable && Math.hypot(g.x - spot.x, g.z - spot.z) < 200 && Math.abs(g.y - spot.y) < 20) {
      ai.goal = spot;
      path.goal = spot;
      path.points[path.points.length - 1] = spot;
    } else setGoal(state, e, spot, 'SQUAD');
    if (ai.path) { follow(state, e, dt, speed); return; }
    // No route: head straight for the spot (quickest when the leader is just ahead), and plan a
    // route once that stops getting anywhere or the leader is far. (A route used to be planned
    // only inside follow(), which a follower with no route never reached: it walked into walls
    // and bridge railings for ever.)
    moveToward(e, spot.x, spot.z, dt, speed);
    // Progress means getting closer to the spot (sliding along a wall is not).
    if (d < ai.bestSpotD - 10) { ai.bestSpotD = d; ai.progressAt = now; }
    if (d > 300 || Math.abs(spot.y - e.y) > 20 || now - ai.progressAt > 500) plan(state, e);
    return;
  }
  ai.goal = null;
  ai.path = null;
  ai.progressAt = now;
  if (d > 14) { moveToward(e, spot.x, spot.z, dt, speed); return; }
  // In place: watch this slot's sector, sweeping a little.
  const a = (ringOrder(state, L) ? ringAngle(state, e, L) : Math.atan2(L.dirX, L.dirZ) + WATCH[ai.slot % WATCH.length]) + Math.sin(now / 1300 + e.id) * 0.35;
  turnToward(e, Math.sin(a), Math.cos(a), AI_TURN_RATE * 0.5 * dt);
}

function think(state: GameState, e: Entity, aggro: number): void {
  const ai = e.ai;
  if (ai.path && ai.path.i + 1 < ai.path.points.length) {
    const nx = ai.path.points[ai.path.i + 1];
    if (Math.abs(nx.y - e.y) < 6 && canWalk(e, nx.x, nx.y, nx.z)) ai.path.i++;
  }
  // The last of a nation still free goes to open the jails, whatever its role.
  if (e.role !== 'keyholder' && lastStanding(state, e) && jailedAlly(state, e)) { keyholderThink(state, e); return; }
  const leader = leaderOf(state, e);
  if (leader && squadThink(state, e, leader, aggro)) return;
  switch (e.role) {
    case 'king': kingThink(state, e); break;
    case 'sniper': sniperThink(state, e); break;
    case 'communicator': communicatorThink(state, e); break;
    case 'keyholder': keyholderThink(state, e); break;
    default: hunterThink(state, e, aggro);
  }
}

/** Grab whoever is in reach from behind (hunters, and anyone escorting or guarding). */
function opportunisticCapture(state: GameState, e: Entity): void {
  if (e.role !== 'soldier' && e.role !== 'ranger') return;
  if (e.cd.capture > 0) return;
  const t = captureCandidate(state, e);
  if (!t || dist(t, e) > CAP_RANGE * 0.75) return;
  // Only grab what it is actually facing (and has noticed).
  const d = dist(t, e) || 1;
  if ((e.dirX * (t.x - e.x) + e.dirZ * (t.z - e.z)) / d < 0.3) return;
  if (!visibleEnemies(state, e).includes(t)) return;
  attemptCapture(state, e);
}

/** One simulation step of AI for one character. */
export function aiTick(state: GameState, e: Entity, dt: number, aggro: number): void {
  const now = state.time;
  if (!e.alive || e.jailed) return;
  if (e.y > 20) e.ai.highSec += dt;
  if (e.channeling || e.stunUntil > now) { e.speed = 0; return; }
  const ai = e.ai;
  if (now >= ai.perceiveAt) {
    ai.perceiveAt = now + PERCEIVE_MS + ((e.id * 37) % 60);
    perceive(state, e);
  }
  if (now >= ai.thinkAt) {
    ai.thinkAt = now + THINK_MS + ((e.id * 53) % 80);
    think(state, e, aggro);
  }
  const speed = AI_SPEED * e.gait * speedMul(state) * (e.sprintUntil > now ? SPRINT_SPEED : 1) * speedFor(ai.state) * (e.role === 'king' && ai.state !== 'FLEE' ? 0.75 : 1);
  e.movedThisStep = false;
  // Close pursuit steers straight at the live position (only while it is in view).
  const t = ai.targetId !== null ? state.entities[ai.targetId] : null;
  const glimpse = noticing(state, e);
  if (glimpse && (ai.state === 'PATROL' || ai.state === 'GUARD')) {
    // Something caught its eye but it has not reacted yet: stop and look (a tell for the player).
    turnToward(e, glimpse.x - e.x, glimpse.z - e.z, AI_TURN_RATE * 0.6 * dt);
  } else if (ai.state === 'CHASE' && t && ai.visible.includes(t.id) && dist(e, t) < 170 && Math.abs(t.y - e.y) < SAME_LEVEL) {
    moveToward(e, t.x - t.dirX * 30, t.z - t.dirZ * 30, dt, speed);
    ai.progressAt = now;
  } else if (ai.state === 'SQUAD' && leaderOf(state, e)) {
    squadMove(state, e, leaderOf(state, e)!, dt);
  } else if (ai.state === 'PATROL' && !ai.visible.length && squadStraggles(state, e)) {
    // A squad leader waits for a follower who fell behind.
    turnBy(e, Math.sin(now / 900 + e.id) * 0.6 * dt);
    ai.progressAt = now;
  } else if (now < ai.idleUntil && (ai.state === 'PATROL' || ai.state === 'SEARCH') && !ai.visible.length) {
    // Pausing: look left and right before moving on.
    turnBy(e, Math.sin(now / 650 + e.id) * 1.1 * dt);
    ai.progressAt = now;
  } else follow(state, e, dt, speed);
  if (!e.movedThisStep) accelerate(e, 0, dt);
  // Standing still with something to aim at: swing round smoothly.
  if (!ai.path && ai.lookAt) turnToward(e, ai.lookAt.x - e.x, ai.lookAt.z - e.z, AI_TURN_RATE * dt);
  opportunisticCapture(state, e);
}

/** A leader's follower is far behind (on the same level). */
function squadStraggles(state: GameState, L: Entity): boolean {
  for (const o of state.entities) {
    if (o.ai.leaderId === L.id && o.alive && !o.jailed && Math.hypot(o.x - L.x, o.z - L.z) > 280) return true;
  }
  return false;
}

export function aggroFor(state: GameState): number {
  return aggroRange(elapsedSec(state));
}
