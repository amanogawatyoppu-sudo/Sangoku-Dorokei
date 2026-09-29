import type { NationId } from '../config/nations';
import type { Entity } from './entity';
import type { GameState } from './state';
import { emit } from './state';
import { visibleTo } from './systems/vision';
import { groundAt } from './systems/world';

/**
 * Pings (合図): a quick signal to your own nation at a spot.
 * - king:   ここに王！ — an enemy that looks like the king (commanders hunt there)
 * - help:   助けて！ — come here (the nearest free allies run over)
 * - gather: ここに集合 — your squad and a couple more gather here
 * - danger: 敵多数！ — many enemies here (reinforcements come, others know to avoid it)
 * Allies see a marker in the world, on the minimap and on screen; the AI reacts.
 */
export type PingKind = 'king' | 'help' | 'gather' | 'danger';
export const PING_KINDS: readonly PingKind[] = ['king', 'help', 'gather', 'danger'];
export const PING_LABEL: Record<PingKind, string> = { king: 'ここに王！', help: '助けて！', gather: 'ここに集合', danger: '敵多数！' };
export const PING_ICON: Record<PingKind, string> = { king: '♛', help: '!', gather: '⚑', danger: '⚠' };

export interface Ping { id: number; nation: NationId; by: number; kind: PingKind; x: number; y: number; z: number; t: number }

/** How long a ping stays up, how many a nation keeps, how often one person can ping. */
export const PING_TIME = 14000;
const PER_NATION = 4;
const PING_GAP = 1500;
const PING_AI_GAP = 20000;

let nextId = 1;

/** Where a ping aimed by `e` lands: the enemy it is looking at (king / danger), or its own spot. */
function aimPoint(state: GameState, e: Entity, kind: PingKind): { x: number; y: number; z: number; target: Entity | null } {
  if (kind === 'king' || kind === 'danger') {
    let best: Entity | null = null, bs = Infinity;
    for (const t of state.entities) {
      if (t.nation === e.nation || !t.alive || t.jailed || !visibleTo(state, t, e)) continue;
      const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz) || 1;
      if (d > 900) continue;
      const cos = (dx * e.dirX + dz * e.dirZ) / d;
      if (cos < 0.5) continue;
      const score = d * (2 - cos) - (kind === 'king' ? (state.factions[e.nation].belief.get(t.id) ?? 0) * 120 : 0);
      if (score < bs) { bs = score; best = t; }
    }
    if (best) return { x: best.x, y: best.y, z: best.z, target: best };
    // Nobody in sight: a little way ahead.
    const x = e.x + e.dirX * 220, z = e.z + e.dirZ * 220;
    return { x, y: groundAt(x, z, e.y + 40), z, target: null };
  }
  return { x: e.x, y: e.y, z: e.z, target: null };
}

/** Puts up a ping from `e` (a person or an AI). Returns it, or null if too soon. */
export function placePing(state: GameState, e: Entity, kind: PingKind, target?: Entity): Ping | null {
  if (!e.alive || e.jailed || state.over) return null;
  const last = state.pings.filter((p) => p.by === e.id).reduce((a, p) => Math.max(a, p.t), -Infinity);
  if (state.time - last < PING_GAP) return null;
  const at = target ? { x: target.x, y: target.y, z: target.z, target } : aimPoint(state, e, kind);
  const p: Ping = { id: nextId++, nation: e.nation, by: e.id, kind, x: at.x, y: at.y, z: at.z, t: state.time };
  state.pings.push(p);
  const mine = state.pings.filter((q) => q.nation === e.nation);
  if (mine.length > PER_NATION) state.pings.splice(state.pings.indexOf(mine[0]), 1);
  reactToPing(state, p, at.target);
  emit(state, { type: 'PING', pingId: p.id, by: e.id, kind });
  return p;
}

/** Drops pings that have run out. */
export function pingTick(state: GameState): void {
  if (state.pings.length && state.pings.some((p) => state.time - p.t > PING_TIME)) {
    state.pings = state.pings.filter((p) => state.time - p.t <= PING_TIME);
  }
}

/** The AI of the pinging nation answers the call. */
function reactToPing(state: GameState, p: Ping, target: Entity | null): void {
  const n = p.nation;
  const free = state.entities.filter((o) => o.nation === n && o.alive && !o.jailed && o.id !== p.by && !o.isPlayer && !o.remote && o.role !== 'king');
  const near = (k: number, roles?: string[]) => free
    .filter((o) => !roles || roles.includes(o.role))
    .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
    .slice(0, k);
  const go = (list: Entity[], ms: number) => {
    for (const o of list) {
      o.ai.searchCenter = { x: p.x, y: p.y, z: p.z };
      o.ai.searchUntil = state.time + ms;
      o.ai.goal = null;
      o.ai.path = null;
    }
  };
  if (p.kind === 'king') {
    if (target) state.factions[n].belief.set(target.id, Math.max(3.5, (state.factions[n].belief.get(target.id) ?? 0) + 2));
    state.teamFocus[n] = { x: p.x, z: p.z, t: state.time };
    go(near(3, ['soldier', 'ranger']), 15000);
  } else if (p.kind === 'help') {
    go(near(3, ['soldier', 'ranger', 'sniper']).filter((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1400), 10000);
  } else if (p.kind === 'gather') {
    const squad = free.filter((o) => o.ai.leaderId === p.by);
    go([...squad, ...near(2, ['soldier', 'ranger']).filter((o) => !squad.includes(o))], 12000);
  } else {
    go(near(4, ['soldier', 'ranger']).filter((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1600), 10000);
  }
}

/**
 * AI allies ping too, so a player hears from the team: a likely king in sight, or a
 * crowd of enemies. At most one AI ping per nation every 20 s.
 */
export function aiPings(state: GameState): void {
  for (const n of ['sun', 'moon', 'star'] as NationId[]) {
    const lastAi = state.pings.filter((p) => p.nation === n && !state.entities[p.by].isPlayer && !state.entities[p.by].remote).reduce((a, p) => Math.max(a, p.t), -Infinity);
    if (state.time - lastAi < PING_AI_GAP || state.time - state.lastAiPingCheck[n] < 1000) continue;
    state.lastAiPingCheck[n] = state.time;
    const f = state.factions[n];
    for (const e of state.entities) {
      if (e.nation !== n || !e.alive || e.jailed || e.isPlayer || e.remote) continue;
      const seen = e.ai.visible.map((id) => state.entities[id]).filter((t) => t.alive && !t.jailed);
      const king = seen.find((t) => (f.belief.get(t.id) ?? 0) >= 3);
      if (king && placePing(state, e, 'king', king)) break;
      if (seen.length >= 4 && placePing(state, e, 'danger', seen[0])) break;
    }
  }
}
