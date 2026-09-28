import type { NationId, Point } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import { HOTSPOTS, PERCHES as MAP_PERCHES, TOWER } from '../config/map';
import { AI_REACTION_MS, AI_SPEED, AI_TURN_RATE, CAP_RANGE, SPRINT_SPEED } from '../config/constants';
import type { Entity } from '../sim/entity';
import { isHuman } from '../sim/entity';
import type { GameState } from '../sim/state';
import { elapsedSec, kingOf, speedMul, squadCommandOf } from '../sim/state';
import { SNIPE_RANGE, useSpecial } from '../sim/systems/abilities';
import { attemptCapture, captureCandidate } from '../sim/systems/capture';
import { SAME_LEVEL, dist, dist3 } from '../sim/systems/collision';
import { accelerate, moveToward, turnBy, turnToward } from '../sim/systems/movement';
import { tryStartRescue } from '../sim/systems/rescue';
import { blocked, canWalk } from '../sim/systems/world';
import type { AiState, Sighting, Waypoint } from './memory';
import { chokePoints, planPath, randomNodeNear } from './nav';
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
  while (wp && Math.hypot(wp.x - e.x, wp.z - e.z) < 12 && Math.abs(wp.y - e.y) < 24) {
    path.i++;
    wp = path.points[path.i];
  }
  if (!wp) {
    // Arrived: on a patrol or search, stop for a moment and look around, as a person would.
    if (ai.state === 'PATROL' || ai.state === 'SEARCH') ai.idleUntil = now + 500 + state.rng() * 1800;
    ai.path = null; ai.goal = null; ai.progressAt = now;
    return;
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
    .filter((id) => now - (e.ai.seen.get(id)?.since ?? now) >= AI_REACTION_MS)
    .map((id) => state.entities[id])
    .filter((t) => t.alive && !t.jailed);
}

/** An enemy in view that this AI has not reacted to yet (nearest), if any. */
function noticing(state: GameState, e: Entity): Entity | null {
  const now = state.time;
  let best: Entity | null = null, bd = Infinity;
  for (const id of e.ai.visible) {
    const s = e.ai.seen.get(id);
    if (!s || now - s.since >= AI_REACTION_MS) continue;
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
  const hunt = e.ai.task?.kind === 'hunt' ? e.ai.task.nation : null;
  let best: Entity | null = null, bs = Infinity;
  for (const t of visibleEnemies(state, e)) {
    const d = dist3(t, e);
    if (d > range) continue;
    const s = d - (belief.get(t.id) ?? 0) * 60 - (hunt === t.nation ? 150 : 0) + (Math.abs(t.y - e.y) > SAME_LEVEL ? 120 : 0);
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
  const ambush = e.role === 'ranger' && rank > 0 && d >= 130 ? ambushSpot(e, t, s) : null;
  if (ambush) {
    // Rangers don't chase from behind when others already are: they cut ahead to a stair exit or bridge.
    ai.chaseRole = 'ambush';
    st = 'INTERCEPT';
    goal = ambush;
    if (e.cd.special <= 0 && Math.hypot(ambush.x - e.x, ambush.z - e.z) > 250) useSpecial(state, e);
  } else if (rank === 0 || d < 130) {
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
  e.ai.searchUntil = state.time + 6500;
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
  if (focus && r < 0.6) p = focus;
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

function lostTargetSearch(state: GameState, e: Entity): boolean {
  const ai = e.ai;
  if ((ai.state === 'CHASE' || ai.state === 'INTERCEPT') && ai.targetId !== null) {
    const s = ai.seen.get(ai.targetId);
    if (s && state.time - s.t < 7000) { startSearch(state, e, s); return true; }
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
      const king = kingOf(state, e.nation);
      if (king && engage(state, e, 230, king)) return;
      // Still on the way back to a distant king: deal with enemies met en route.
      if (king && dist(e, king) > 400 && engage(state, e, 260, e)) return;
      if (king) setGoal(state, e, { x: king.x - king.dirX * 40 + (e.id % 2 ? 30 : -30), y: king.y, z: king.z - king.dirZ * 40 }, 'ESCORT');
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
    if ((e.dirX * dx + e.dirZ * dz) / d > 0.9 && e.cd.special <= 0) useSpecial(state, e);
  } else { e.ai.lookAt = null; e.ai.aimId = null; }
  const task = e.ai.task;
  if (task?.kind === 'rescueEscort') {
    if (escortKeyholder(state, e, NATIONS[task.jail].jail)) return;
    setGoal(state, e, around(NATIONS[task.jail].jail, e, 200), 'RESCUE');
    return;
  }
  if (task?.kind === 'guardJail') { setGoal(state, e, around(NATIONS[e.nation].jail, e, 160), 'GUARD'); return; }
  const base = NATIONS[e.nation].base;
  const perch = [...PERCHES].sort((a, b) => Math.hypot(a.x - base.x, a.z - base.z) - Math.hypot(b.x - base.x, b.z - base.z))[e.id % 2];
  if (Math.hypot(perch.x - e.x, perch.z - e.z) > 70 || Math.abs(perch.y - e.y) > 10) setGoal(state, e, perch, 'HOLD');
  else stop(e, 'HOLD');
}

function communicatorThink(state: GameState, e: Entity): void {
  const threat = nearestVisible(state, e, 120);
  if (threat && dist(e, TOWER) > TOWER.r) { flee(state, e, threat); return; }
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
  const b = NATIONS[e.nation].base;
  if (!e.ai.goal) {
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
  if (threat) {
    if (persona === 'aggressive' && dist(e, threat) < CAP_RANGE && state.rng() < 0.3) attemptCapture(state, e);
    if (persona !== 'aggressive' || dist(e, threat) < 70) { flee(state, e, threat); return; }
  }
  if (e.ai.state === 'FLEE' && e.ai.goal) return;
  if (e.ai.goal && e.ai.state !== 'FLEE') return;
  let anchor: Point = NATIONS[e.nation].base;
  if (persona === 'commander' && state.tower.owner === e.nation) anchor = TOWER;
  if (persona === 'lurker') anchor = HOTSPOTS[Math.floor(state.rng() * HOTSPOTS.length)];
  if (persona === 'aggressive') {
    const others = NATION_IDS.filter((n) => n !== e.nation) as NationId[];
    anchor = state.rng() < 0.5 ? HOTSPOTS[Math.floor(state.rng() * HOTSPOTS.length)] : NATIONS[others[Math.floor(state.rng() * 2)]].base;
  }
  const n = randomNodeNear(anchor.x, 0, anchor.z, persona === 'cautious' ? 110 : 170, state.rng);
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

/** Where a follower should stand: its slot behind the leader (or straight behind, if that spot is inside a wall). */
function formationSpot(state: GameState, e: Entity, L: Entity): Waypoint {
  if (ringOrder(state, L)) {
    // 周りを警戒: stand in a ring around the leader.
    const a = ringAngle(state, e, L);
    const x = L.x + Math.sin(a) * RING_R, z = L.z + Math.cos(a) * RING_R;
    if (!blocked(x, z, L.y)) return { x, y: L.y, z };
  }
  const [back, side] = FORMATION[e.ai.slot % FORMATION.length];
  const rx = -L.dirZ, rz = L.dirX;
  const x = L.x + L.dirX * back + rx * side, z = L.z + L.dirZ * back + rz * side;
  if (!blocked(x, z, L.y)) return { x, y: L.y, z };
  return { x: L.x + L.dirX * back, y: L.y, z: L.z + L.dirZ * back };
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
    if (t && (e.dirX * (t.x - e.x) + e.dirZ * (t.z - e.z)) / (dist(e, t) || 1) > 0.9 && e.cd.special <= 0) useSpecial(state, e);
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

/** Keep formation: walk straight to the slot when it is close and clear, else take a path; catch up when behind. */
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
  if (!ai.directOk) {
    // The spot moves with the leader: keep the path and stretch its end, rather than
    // dropping it (and standing still until the next plan) every time the leader moves on.
    const g = ai.goal, path = ai.path;
    if (g && path && ai.state === 'SQUAD' && Math.hypot(g.x - spot.x, g.z - spot.z) < 200 && Math.abs(g.y - spot.y) < 20) {
      ai.goal = spot;
      path.goal = spot;
      path.points[path.points.length - 1] = spot;
    } else setGoal(state, e, spot, 'SQUAD');
    if (ai.path) follow(state, e, dt, speed);
    else moveToward(e, spot.x, spot.z, dt, speed); // until the plan is ready
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
