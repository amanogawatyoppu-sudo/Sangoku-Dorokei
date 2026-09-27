import type { NationId, Point } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import { HOTSPOTS, SNIPE, TOWER, UPPER } from '../config/map';
import { AI_SPEED, CAP_RANGE } from '../config/constants';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { elapsedSec, kingOf, speedMul } from '../sim/state';
import { SNIPE_RANGE, useSpecial } from '../sim/systems/abilities';
import { attemptCapture, captureCandidate } from '../sim/systems/capture';
import { SAME_LEVEL, dist, dist3 } from '../sim/systems/collision';
import { moveToward } from '../sim/systems/movement';
import { tryStartRescue } from '../sim/systems/rescue';
import { canWalk } from '../sim/systems/world';
import type { AiState, Sighting, Waypoint } from './memory';
import { planPath, randomNodeNear } from './nav';
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
const PERCHES: Waypoint[] = [
  ...SNIPE.map((s) => ({ x: s.x, y: 44, z: s.z })),
  { x: -1180, y: UPPER, z: 620 }, { x: 1180, y: UPPER, z: 620 }, { x: 420, y: UPPER, z: -930 },
];

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
    case 'SEARCH': case 'INVESTIGATE': case 'ESCORT': return 0.88;
    case 'PATROL': return 0.75;
    default: return 0.6;
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
  if (!wp) { ai.path = null; ai.goal = null; ai.progressAt = now; return; }
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

function visibleEnemies(state: GameState, e: Entity): Entity[] {
  return e.ai.visible.map((id) => state.entities[id]).filter((t) => t.alive && !t.jailed);
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
    .filter((o) => o.nation === e.nation && !o.isPlayer && o.alive && !o.jailed && (o.ai.state === 'CHASE' || o.ai.state === 'INTERCEPT') && o.ai.targetId === targetId)
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
  if (rank === 0 || d < 130) {
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
  if (e.role === 'impostor' && e.fakeUntil <= state.time && dist(e, t) < 220 && state.rng() < 0.12) useSpecial(state, e);
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
    case 'decoy': {
      if (e.fakeUntil <= state.time) useSpecial(state, e);
      if (engage(state, e, 260)) return;
      setGoal(state, e, around(NATIONS[task.toward].base, e, 160), 'INVESTIGATE');
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

function sniperThink(state: GameState, e: Entity): void {
  const threat = nearestVisible(state, e, 130);
  if (threat && Math.abs(threat.y - e.y) < SAME_LEVEL) { flee(state, e, threat); return; }
  const target = nearestVisible(state, e, SNIPE_RANGE);
  if (target) {
    const dx = target.x - e.x, dz = target.z - e.z, d = Math.hypot(dx, dz) || 1;
    e.dirX = dx / d;
    e.dirZ = dz / d;
    useSpecial(state, e);
  }
  const task = e.ai.task;
  if (task?.kind === 'rescueEscort') { setGoal(state, e, around(NATIONS[task.jail].jail, e, 200), 'RESCUE'); return; }
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

function think(state: GameState, e: Entity, aggro: number): void {
  const ai = e.ai;
  if (ai.path && ai.path.i + 1 < ai.path.points.length) {
    const nx = ai.path.points[ai.path.i + 1];
    if (Math.abs(nx.y - e.y) < 6 && canWalk(e, nx.x, nx.y, nx.z)) ai.path.i++;
  }
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
  if (e.role !== 'soldier' && e.role !== 'impostor') return;
  if (e.cd.capture > 0) return;
  const t = captureCandidate(state, e);
  if (t && dist(t, e) < CAP_RANGE * 0.9) attemptCapture(state, e);
}

/** One simulation step of AI for one character. */
export function aiTick(state: GameState, e: Entity, dt: number, aggro: number): void {
  const now = state.time;
  if (!e.alive || e.jailed) return;
  if (e.y > 20) e.ai.highSec += dt;
  if (e.channeling || e.stunUntil > now) return;
  const ai = e.ai;
  if (now >= ai.perceiveAt) {
    ai.perceiveAt = now + PERCEIVE_MS + ((e.id * 37) % 60);
    perceive(state, e);
  }
  if (now >= ai.thinkAt) {
    ai.thinkAt = now + THINK_MS + ((e.id * 53) % 80);
    think(state, e, aggro);
  }
  const speed = AI_SPEED * speedMul(state) * speedFor(ai.state) * (e.role === 'king' && ai.state !== 'FLEE' ? 0.75 : 1);
  // Close pursuit steers straight at the live position (only while it is in view).
  const t = ai.targetId !== null ? state.entities[ai.targetId] : null;
  if (ai.state === 'CHASE' && t && ai.visible.includes(t.id) && dist(e, t) < 170 && Math.abs(t.y - e.y) < SAME_LEVEL) {
    moveToward(e, t.x - t.dirX * 30, t.z - t.dirZ * 30, dt, speed);
    ai.progressAt = now;
  } else follow(state, e, dt, speed);
  opportunisticCapture(state, e);
}

export function aggroFor(state: GameState): number {
  return aggroRange(elapsedSec(state));
}
