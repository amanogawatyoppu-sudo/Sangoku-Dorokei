import { BOUNDS, WORLD, insideLoop } from '../config/map';
import type { Body } from '../sim/systems/world';
import { blocked, canWalk, inWater, primsAt, supportHeight, topAt } from '../sim/systems/world';
import type { Waypoint } from './memory';

/**
 * Navigation graph generated from the world, not hand-placed: every standable
 * surface (ground, floors, stairs, slopes, bridges, rooftops) is sampled on a
 * grid, and neighbours are linked when a simulated walk actually gets there.
 * Stairs therefore appear as chains of rising nodes, and ledges become
 * one-way drops.
 */

export const NAV_SPACING = 50;

export interface NavNode extends Waypoint {
  id: number;
  gx: number;
  gz: number;
  edges: number[];
  costs: number[];
  /** In the main walkable network (not an unreachable wall top or roof). */
  reachable: boolean;
}

interface Graph {
  nodes: NavNode[];
  columns: Map<number, number[]>;
}

let graph: Graph | null = null;
const colKey = (gx: number, gz: number) => gx * 10007 + gz;
const gxOf = (x: number) => Math.round((x - BOUNDS.minX) / NAV_SPACING);
const gzOf = (z: number) => Math.round((z - BOUNDS.minZ) / NAV_SPACING);
const xOf = (gx: number) => BOUNDS.minX + gx * NAV_SPACING;
const zOf = (gz: number) => BOUNDS.minZ + gz * NAV_SPACING;

/**
 * The network is built in resumable phases (grid columns → narrow features → edges →
 * reachability), so it can be spread over idle moments on the title screen instead of
 * freezing the page for a second. `navGraph()` finishes whatever is left at once.
 */
interface Builder {
  nodes: NavNode[];
  columns: Map<number, number[]>;
  phase: 0 | 1 | 2 | 3 | 4;
  /** Where the current phase has got to. */
  i: number;
}

function newBuilder(): Builder {
  return { nodes: [], columns: new Map(), phase: 0, i: 0 };
}

/** Does some work; true when the graph is complete. `timeUp` says when to pause (the caller keeps the clock). */
function work(bd: Builder, timeUp: () => boolean): boolean {
  const { nodes, columns } = bd;
  const GX = gxOf(BOUNDS.maxX), GZ = gzOf(BOUNDS.maxZ);
  while (bd.phase < 4) {
    if (bd.phase === 0) {
      // Grid columns: every floor height you could rest at, with room to stand.
      for (; bd.i < (GX - 1) * (GZ - 1); bd.i++) {
        if ((bd.i & 63) === 0 && timeUp()) return false;
        const gx = 1 + Math.floor(bd.i / (GZ - 1)), gz = 1 + (bd.i % (GZ - 1));
        const x = xOf(gx), z = zOf(gz);
        if (!insideLoop(x, z, 0)) continue;
        const heights = [0];
        for (const p of primsAt(x, z)) {
          if (p.noFloor || Math.abs(x - p.x) >= p.w / 2 || Math.abs(z - p.z) >= p.d / 2) continue;
          heights.push(topAt(p, x, z));
        }
        const ids: number[] = [];
        const used: number[] = [];
        for (const h of heights) {
          if (supportHeight(x, z, h) !== h || blocked(x, z, h)) continue;
          if (used.some((u) => Math.abs(u - h) < 1)) continue;
          used.push(h);
          const n: NavNode = { id: nodes.length, x, y: h, z, gx, gz, edges: [], costs: [], reachable: false };
          nodes.push(n);
          ids.push(n.id);
        }
        if (ids.length) columns.set(colKey(gx, gz), ids);
      }
    } else if (bd.phase === 1) {
      // Centre-line nodes along narrow walkable features (stairs, slopes, skyways,
      // bridges, wall walks) so they connect regardless of grid alignment.
      for (; bd.i < WORLD.length; bd.i++) {
        if ((bd.i & 31) === 0 && timeUp()) return false;
        const p = WORLD[bd.i];
        if (p.noFloor) continue;
        const alongX = p.kind === 'ramp' ? p.axis === 'x' : p.w >= p.d;
        const narrow = alongX ? p.d : p.w, len = alongX ? p.w : p.d;
        if (p.kind === 'box' && (narrow > 100 || narrow < 2 * 14 + 4)) continue;
        const n = Math.max(2, Math.ceil(len / 20));
        for (let k = 0; k <= n; k++) {
          const t = -len / 2 + 6 + ((len - 12) * k) / n;
          const x = alongX ? p.x + t : p.x, z = alongX ? p.z : p.z + t;
          const h = topAt(p, x, z);
          if (supportHeight(x, z, h) !== h || blocked(x, z, h)) continue;
          const gx = gxOf(x), gz = gzOf(z);
          const node: NavNode = { id: nodes.length, x, y: h, z, gx, gz, edges: [], costs: [], reachable: false };
          nodes.push(node);
          const key = colKey(gx, gz);
          columns.set(key, [...(columns.get(key) ?? []), node.id]);
        }
      }
    } else if (bd.phase === 2) {
      // Edges: walk from each node to its neighbours.
      for (; bd.i < nodes.length; bd.i++) {
        if ((bd.i & 15) === 0 && timeUp()) return false;
        const n = nodes[bd.i];
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const mId of columns.get(colKey(n.gx + dx, n.gz + dz)) ?? []) {
              if (mId === n.id) continue;
              const m = nodes[mId];
              if (m.y - n.y > 30 || n.y - m.y > 80) continue;
              if (!canWalk(n, m.x, m.y, m.z)) continue;
              const drop = Math.max(0, n.y - m.y - 14);
              n.edges.push(m.id);
              n.costs.push(Math.hypot(m.x - n.x, m.y - n.y, m.z - n.z) + drop * 2);
            }
          }
        }
      }
    } else {
      markReachable(nodes);
    }
    bd.phase++;
    bd.i = 0;
  }
  return true;
}

/** Flags the largest set of nodes that can reach each other (the playable network). */
function markReachable(nodes: NavNode[]): void {
  // Reverse edges so "can get there AND back" (strongly connected) is found from a ground seed.
  const rev: number[][] = nodes.map(() => []);
  for (const n of nodes) for (const m of n.edges) rev[m].push(n.id);
  const seed = nodes.reduce((b, n) => (n.y === 0 && Math.hypot(n.x, n.z - 520) < Math.hypot(b.x, b.z - 520) ? n : b), nodes[0]);
  const bfs = (adj: (id: number) => number[]) => {
    const seen = new Uint8Array(nodes.length);
    const q = [seed.id];
    seen[seed.id] = 1;
    while (q.length) for (const m of adj(q.pop()!)) if (!seen[m]) { seen[m] = 1; q.push(m); }
    return seen;
  };
  const fwd = bfs((id) => nodes[id].edges), back = bfs((id) => rev[id]);
  for (const n of nodes) n.reachable = !!(fwd[n.id] && back[n.id]);
}

let pending: Builder | null = null;

export function navGraph(): Graph {
  if (!graph) {
    const bd = pending ?? newBuilder();
    work(bd, () => false);
    pending = null;
    graph = { nodes: bd.nodes, columns: bd.columns };
  }
  return graph;
}

/**
 * Builds part of the network until `timeUp()` says to stop; true once it is complete.
 * Call it again later to go on (the page does this in small slices so it stays responsive).
 */
export function buildNavGraphSome(timeUp: () => boolean): boolean {
  if (graph) return true;
  pending ??= newBuilder();
  if (!work(pending, timeUp)) return false;
  graph = { nodes: pending.nodes, columns: pending.columns };
  pending = null;
  return true;
}

/** Nearest node reachable by walking straight from `body`, or null. */
export function nearestNode(body: Body): NavNode | null {
  const { nodes, columns } = navGraph();
  const gx = gxOf(body.x), gz = gzOf(body.z);
  const cands: NavNode[] = [];
  for (let r = 0; r <= 3 && cands.length < 6; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const id of columns.get(colKey(gx + dx, gz + dz)) ?? []) cands.push(nodes[id]);
      }
    }
  }
  const score = (n: NavNode) => Math.hypot(n.x - body.x, (n.y - body.y) * 3, n.z - body.z);
  cands.sort((a, b) => score(a) - score(b));
  for (const n of cands.slice(0, 8)) {
    if (!n.reachable || Math.abs(n.y - body.y) > 20) continue;
    if (canWalk(body, n.x, n.y, n.z)) return n;
  }
  return cands.find((n) => n.reachable && Math.abs(n.y - body.y) <= 20) ?? cands.find((n) => n.reachable) ?? null;
}

/** Nearest node to a point on a given level (for goals), without a walk check. */
export function nodeNear(x: number, y: number, z: number): NavNode | null {
  const { nodes, columns } = navGraph();
  const gx = gxOf(x), gz = gzOf(z);
  let best: NavNode | null = null, bd = Infinity;
  for (let r = 0; r <= 4; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const id of columns.get(colKey(gx + dx, gz + dz)) ?? []) {
          const n = nodes[id];
          if (!n.reachable) continue;
          const d = Math.hypot(n.x - x, (n.y - y) * 2, n.z - z);
          if (d < bd) { bd = d; best = n; }
        }
      }
    }
    if (best && r >= 1) break;
  }
  return best;
}

// ---------------------------------------------------------------- A*
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < ids.length && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < ids.length && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m]; keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}

let gBuf = new Float64Array(0), fromBuf = new Int32Array(0), visitBuf = new Uint32Array(0);
let search = 0;

/** A* between two nodes. Returns node ids start→goal, or null if unreachable. */
export function findPath(startId: number, goalId: number, maxExpand = 40000): number[] | null {
  const { nodes } = navGraph();
  if (gBuf.length !== nodes.length) {
    gBuf = new Float64Array(nodes.length);
    fromBuf = new Int32Array(nodes.length);
    visitBuf = new Uint32Array(nodes.length);
  }
  search++;
  const goal = nodes[goalId];
  const h = (n: NavNode) => Math.hypot(n.x - goal.x, n.y - goal.y, n.z - goal.z);
  const open = new Heap();
  gBuf[startId] = 0;
  fromBuf[startId] = -1;
  visitBuf[startId] = search;
  open.push(startId, h(nodes[startId]));
  let expanded = 0;
  while (open.size && expanded++ < maxExpand) {
    const cur = open.pop();
    if (cur === goalId) {
      const out: number[] = [];
      for (let c = cur; c !== -1; c = fromBuf[c]) out.push(c);
      return out.reverse();
    }
    const n = nodes[cur];
    for (let k = 0; k < n.edges.length; k++) {
      const m = n.edges[k];
      const g = gBuf[cur] + n.costs[k];
      if (visitBuf[m] === search && g >= gBuf[m]) continue;
      visitBuf[m] = search;
      gBuf[m] = g;
      fromBuf[m] = cur;
      open.push(m, g + h(nodes[m]));
    }
  }
  return null;
}

/** Plans a walkable route from `body` to `goal` as waypoints (ending at the goal's node). */
export function planPath(body: Body, goal: Waypoint): Waypoint[] | null {
  const s = nearestNode(body);
  const g = nodeNear(goal.x, goal.y, goal.z);
  if (!s || !g) return null;
  const ids = findPath(s.id, g.id);
  if (!ids) return null;
  const { nodes } = navGraph();
  const pts: Waypoint[] = ids.map((id) => ({ x: nodes[id].x, y: nodes[id].y, z: nodes[id].z }));
  // String pulling: from each kept point, jump to the farthest later point on the same
  // level that can be walked straight to, so people cut corners instead of zig-zagging.
  const pulled: Waypoint[] = [];
  for (let i = 0; i < pts.length;) {
    pulled.push(pts[i]);
    let next = i + 1;
    for (let j = Math.min(pts.length - 1, i + 8); j > i + 1; j--) {
      const a = pts[i], b = pts[j];
      if (pts.slice(i, j + 1).some((p) => Math.abs(p.y - a.y) > 1) || Math.hypot(b.x - a.x, b.z - a.z) > 450) continue;
      if (canWalk(a, b.x, b.y, b.z)) { next = j; break; }
    }
    i = next;
  }
  pts.length = 0;
  pts.push(...pulled);
  // Drop collinear middle points on the same level to keep paths short.
  const out: Waypoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    if (a && c && a.y === b.y && b.y === c.y && Math.sign(b.x - a.x) === Math.sign(c.x - b.x) && Math.sign(b.z - a.z) === Math.sign(c.z - b.z)
      && (b.x - a.x) * (c.z - b.z) === (b.z - a.z) * (c.x - b.x)) continue;
    out.push(b);
  }
  return out;
}

/** Random standable point within `radius` of (x, z) on roughly the given level (for searches / patrols). */
/** The nearest walkable spot on dry land (someone who fell into the water climbs out there). */
export function dryNodeNear(x: number, z: number): NavNode | null {
  let best: NavNode | null = null, bd = Infinity;
  for (const n of navGraph().nodes) {
    if (!n.reachable || n.y > 40) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd && !inWater(n.x, n.z, n.y + 1)) { bd = d; best = n; }
  }
  return best;
}

let chokes: NavNode[] | null = null;

/**
 * Places a pursuer can cut someone off: the ends of stairs and ramps (a steep edge)
 * and narrow walkways such as bridges (few neighbours), one per ~150 units.
 */
export function chokePoints(): NavNode[] {
  if (chokes) return chokes;
  const { nodes } = navGraph();
  const taken = new Set<number>();
  chokes = [];
  for (const n of nodes) {
    if (!n.reachable) continue;
    const steep = n.edges.some((id) => Math.abs(nodes[id].y - n.y) > 18);
    const narrow = n.edges.length <= 2 && n.y > 20;
    if (!steep && !narrow) continue;
    const key = Math.round(n.x / 150) * 100003 + Math.round(n.z / 150) * 7 + Math.round(n.y / 60);
    if (taken.has(key)) continue;
    taken.add(key);
    chokes.push(n);
  }
  return chokes;
}

export function randomNodeNear(x: number, y: number, z: number, radius: number, rng: () => number): NavNode | null {
  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2, r = radius * Math.sqrt(rng());
    const n = nodeNear(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
    if (n) return n;
  }
  return nodeNear(x, y, z);
}
