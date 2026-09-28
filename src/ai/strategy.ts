import type { NationId } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import type { GameState } from '../sim/state';
import { kingOf } from '../sim/state';
import type { SectorId } from '../sim/war';
import { CENTRAL, SECTORS, behind, held, hostility, isFrontline, neighbours, rearSectors, safeRear, sectorAt, sectorPoint, strength } from '../sim/war';

/**
 * FactionStrategy (国家戦略): what a kingdom as a whole is doing right now, decided
 * by its commander every so often from the war situation. Individual AIs keep
 * their own chase / search / flee brains; the strategy only decides where the
 * nation's weight goes (which sector to attack or hold, the tower, a king hunt).
 */
export type StrategyKind =
  | 'ATTACK_SECTOR' | 'DEFEND_SECTOR' | 'TAKE_TOWER' | 'HUNT_KING'
  | 'RESCUE_KING' | 'HOLD_KING' | 'OPPORTUNIST' | 'RECOVER';

export interface Strategy {
  kind: StrategyKind;
  sector: SectorId | null;
  /** The nation this strategy is aimed at, if any. */
  enemy: NationId | null;
  /** Game time to think again (sooner if the situation changes). */
  until: number;
}

export const NO_STRATEGY: Strategy = { kind: 'RECOVER', sector: null, enemy: null, until: 0 };

const others = (n: NationId) => NATION_IDS.filter((o) => o !== n);

/** An own sector someone is taking, or fighting over (the most urgent first). */
export function threatenedSector(state: GameState, n: NationId): SectorId | null {
  let best: SectorId | null = null, bs = 0.12;
  state.war.sectors.forEach((s, i) => {
    if (s.owner !== n) return;
    const enemyOn = others(n).some((o) => s.count[o] > 0);
    const score = (s.capturer && s.capturer !== n ? s.progress + 0.2 : 0) + (s.contested || enemyOn ? 0.3 : 0);
    if (score > bs) { bs = score; best = i; }
  });
  return best;
}

/**
 * Where a kingdom would attack: an enemy or neutral sector touching its own
 * territory (the centre is always in reach). Favoured: the centre, neutral ground,
 * nations that are weaker or already busy fighting someone else (漁夫の利), and
 * somewhere new; far-off sectors count against.
 */
export function attackTarget(state: GameState, n: NationId, avoid: SectorId | null): { sector: SectorId; enemy: NationId | null } | null {
  const mine = held(state, n);
  const reach = new Set<number>([CENTRAL]);
  for (const id of mine) for (const b of neighbours(id)) reach.add(b);
  const myStr = strength(state, n), base = NATIONS[n].base;
  let best: { sector: SectorId; enemy: NationId | null } | null = null, bs = -Infinity;
  for (const id of reach) {
    const s = state.war.sectors[id];
    if (s.owner === n) continue;
    const o = s.owner;
    if (o && !kingOf(state, o)?.alive) continue;
    let score = 1 + state.rng() * 0.8;
    if (!o) score += 0.6;
    if (id === CENTRAL) score += 0.7;
    if (o) {
      const rival = others(n).find((x) => x !== o)!;
      if (hostility(state, o, rival) > 1.5) {
        // It is fighting the third nation: hit it from behind, above all if it is losing that fight.
        score += 0.8;
        if (strength(state, o) < strength(state, rival)) score += 0.9;
      }
      const so = strength(state, o);
      if (so < myStr) score += 0.5 * Math.min(1, (myStr - so) / 3);
      if (state.war.sectors[id].count[o] >= 3) score -= 0.5; // well defended right now
    }
    const p = sectorPoint(id);
    score -= Math.hypot(p.x - base.x, p.z - base.z) / 5000;
    if (id === avoid) score -= 0.6;
    if (score > bs) { bs = score; best = { sector: id, enemy: o }; }
  }
  return best;
}

/** A king-like enemy someone saw recently (escorted, protected): where to hunt. */
function kingLead(state: GameState, n: NationId): { sector: SectorId; enemy: NationId } | null {
  const f = state.factions[n];
  let best: { sector: SectorId; enemy: NationId } | null = null, bb = 2.4;
  for (const [id, b] of f.belief) {
    const s = f.intel.get(id), t = state.entities[id];
    if (!s || b < bb || state.time - s.t > 9000 || !t.alive || t.jailed) continue;
    bb = b;
    best = { sector: sectorAt(s.x, s.z), enemy: t.nation };
  }
  return best;
}

/** The commander's plan in ordinary times (no king in a jail). */
export function decideNormal(state: GameState, n: NationId, prev: Strategy): Strategy {
  const until = state.time + 14000 + state.rng() * 8000;
  const people = state.entities.filter((e) => e.nation === n);
  const free = people.filter((e) => e.alive && !e.jailed).length / people.length;
  const threat = threatenedSector(state, n);
  if (threat !== null) return { kind: 'DEFEND_SECTOR', sector: threat, enemy: state.war.sectors[threat].capturer, until: state.time + 9000 };
  if (free < 0.45) {
    const rear = rearSectors(state, n);
    return { kind: 'RECOVER', sector: rear.length ? rear[0] : null, enemy: null, until: state.time + 12000 };
  }
  const lead = kingLead(state, n);
  if (lead && state.rng() < 0.7) return { kind: 'HUNT_KING', sector: lead.sector, enemy: lead.enemy, until: state.time + 12000 };
  const hasComm = people.some((e) => e.role === 'communicator' && e.alive && !e.jailed);
  if (state.tower.owner !== n && state.rng() < (hasComm ? 0.3 : 0.15)) return { kind: 'TAKE_TOWER', sector: CENTRAL, enemy: state.tower.owner, until };
  const t = attackTarget(state, n, prev.kind === 'ATTACK_SECTOR' ? prev.sector : null);
  if (t) return { kind: 'ATTACK_SECTOR', sector: t.sector, enemy: t.enemy, until };
  return { kind: 'RECOVER', sector: rearSectors(state, n)[0] ?? null, enemy: null, until };
}

/**
 * Third nation while two others are locked over a captured king: hit whichever of
 * them is weaker where it is thin on the ground, take the tower, or raid the jail.
 */
export function opportunistTarget(state: GameState, n: NationId, captor: NationId, victim: NationId): { sector: SectorId; enemy: NationId } | null {
  const mine = held(state, n);
  const reach = new Set<number>([CENTRAL]);
  for (const id of mine) for (const b of neighbours(id)) reach.add(b);
  let best: { sector: SectorId; enemy: NationId } | null = null, bs = -Infinity;
  for (const id of reach) {
    const o = state.war.sectors[id].owner;
    if (o !== captor && o !== victim) continue;
    // The victim sends everyone to the rescue; the captor guards its jail: both leave sectors thin.
    const score = (o === victim ? 1 : 0.7) - state.war.sectors[id].count[o] * 0.4 + state.rng() * 0.5;
    if (score > bs) { bs = score; best = { sector: id, enemy: o }; }
  }
  return best;
}

/** A spot to fall back to in the nation's rear (not its base: the king roams the rear). */
export function rearPoint(state: GameState, n: NationId): { x: number; z: number } {
  // With no safe sector (every one of ours is on a front), stay by the base.
  const rear = safeRear(state, n);
  const id = rear[Math.floor(state.rng() * rear.length)];
  return id === undefined ? NATIONS[n].base : sectorPoint(id);
}

/**
 * Where a king is safest now: the base or one of its own sectors, whichever has the
 * fewest fresh reports of enemies nearby and no fighting (kings avoid the front).
 */
export function kingRefuge(state: GameState, n: NationId): { x: number; z: number } {
  const f = state.factions[n];
  const fresh = [...f.intel.values()].filter((s) => state.time - s.t < 12000);
  const cands: { p: { x: number; z: number }; extra: number }[] = [{ p: NATIONS[n].base, extra: 0 }];
  for (const id of held(state, n)) {
    const s = state.war.sectors[id];
    const fronts = [...neighbours(id)].filter((b) => { const o = state.war.sectors[b].owner; return o && o !== n; }).length;
    cands.push({ p: behind(id, n, 150), extra: (s.contested ? 6 : 0) + (s.capturer && s.capturer !== n ? 4 : 0) + fronts * 0.6 });
  }
  let best = cands[0].p, bs = Infinity;
  for (const c of cands) {
    const near = fresh.filter((s) => Math.hypot(s.x - c.p.x, s.z - c.p.z) < 1100).length;
    const score = near * 2.5 + c.extra + state.rng() * 1.2;
    if (score < bs) { bs = score; best = c.p; }
  }
  return best;
}

/** Own sectors on the front (a little behind each point, toward home). */
export function frontSectors(state: GameState, n: NationId): SectorId[] {
  return held(state, n).filter((id) => isFrontline(state, id) || state.war.sectors[id].contested);
}

export { SECTORS };
