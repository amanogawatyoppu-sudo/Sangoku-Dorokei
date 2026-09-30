import type { NationId, Point } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import { BOUNDS } from '../config/map';
import { navGraph } from '../ai/nav';
import type { Entity } from './entity';
import type { GameState, PerNation } from './state';
import { emit, kingOf } from './state';

/**
 * The war for Tokyo (v7.13): the city inside the Yamanote loop is split into
 * sectors (戦区). Each has a strategic point (戦略拠点) that a nation takes by
 * standing on it unopposed for a while; sectors held by two different nations
 * that touch form the front (前線). Territory never decides the match (only kings
 * do): it tells the kingdoms' commanders where to fight, rally and search.
 */

export interface SectorDef {
  id: number;
  name: string;
  /** Voronoi centre: a spot belongs to the sector whose centre is nearest. */
  center: Point;
  /** Where the strategic point should be (snapped to walkable ground). */
  pointNear: Point & { y?: number };
  pointName: string;
  /** Who holds it at the start (null = neutral). */
  home: NationId | null;
  /** How fighting there feels (shown on entering). */
  style: string;
}

export const SECTORS: readonly SectorDef[] = [
  { id: 0, name: '新宿', center: { x: -2900, z: -900 }, pointNear: { x: -2847, z: -474 }, pointName: '新宿御苑前', home: 'sun', style: '高層ビルと屋上・2階の歩道。立体戦と待ち伏せ' },
  { id: 1, name: '渋谷', center: { x: -2750, z: 2450 }, pointNear: { x: -3067, z: 2220 }, pointName: 'スクランブル交差点', home: 'sun', style: '狭い道と大交差点。乱戦と逃走' },
  { id: 2, name: '池袋', center: { x: -1900, z: -5100 }, pointNear: { x: -2255, z: -5328 }, pointName: '池袋駅前広場', home: 'sun', style: '入り組んだ街路と多い逃げ道。追跡と待ち伏せ' },
  { id: 3, name: '文京', center: { x: 150, z: -3200 }, pointNear: { x: 1073, z: -2592 }, pointName: '東京ドーム前', home: null, style: '川と橋と坂。北の要衝' },
  { id: 4, name: '上野', center: { x: 2700, z: -4700 }, pointNear: { x: 2750, z: -4089, y: 130 }, pointName: '上野の山（高台）', home: 'moon', style: '公園の高台と坂。見晴らしがよく偵察と狙撃向き' },
  { id: 5, name: '秋葉原', center: { x: 2550, z: -2150 }, pointNear: { x: 2661, z: -2142 }, pointName: '電気街', home: 'moon', style: '路地と高架と屋上。機動戦' },
  { id: 6, name: '中央', center: { x: 1350, z: 100 }, pointNear: { x: 1150, z: 850 }, pointName: '日比谷公園', home: null, style: '管制塔・広場・堀の橋。3勢力が集まる最大の激戦地' },
  { id: 7, name: '東京タワー', center: { x: 100, z: 2500 }, pointNear: { x: 487, z: 2825 }, pointName: '東京タワー下', home: 'star', style: '高台と塔。広く見渡せる' },
  { id: 8, name: '品川', center: { x: -400, z: 5300 }, pointNear: { x: 300, z: 4600 }, pointName: '品川駅前', home: 'star', style: '広い道路と高架。高速移動と大規模戦' },
];

export const CENTRAL = 6;
/** Standing within this of a strategic point (on its level) counts toward taking it. */
export const POINT_R = 170;
/** Seconds one person needs to take a point alone (more people are faster, up to ~2.5×). */
export const CAPTURE_SEC = 10;
/** A capture is announced to everyone; contests and battles at most this often per sector. */
const NOTIFY_MS = 45000;

export type SectorId = number;

export interface SectorState {
  owner: NationId | null;
  /** Nation filling the gauge, and how far (0..1). */
  capturer: NationId | null;
  progress: number;
  contested: boolean;
  /** People of each nation on the point right now. */
  count: PerNation<number>;
  lastClashAt: number;
  notifiedAt: number;
}

export interface Truce {
  a: NationId;
  b: NationId;
  until: number;
}

export interface TruceProposal {
  from: NationId;
  to: NationId;
  /** Game time the offer lapses (declined). */
  expires: number;
}

export interface WarState {
  sectors: SectorState[];
  /** How much each pair of nations has been fighting lately (decays). */
  hostility: Record<string, number>;
  truces: Truce[];
  trucesHeld: number;
  proposal: TruceProposal | null;
  nextTruceCheckAt: number;
  tickAcc: number;
  lastBattleNotifyAt: number;
}

const pairKey = (a: NationId, b: NationId) => (a < b ? a + b : b + a);

export function createWar(): WarState {
  return {
    sectors: SECTORS.map((s) => ({ owner: s.home, capturer: null, progress: 0, contested: false, count: { sun: 0, moon: 0, star: 0 }, lastClashAt: -Infinity, notifiedAt: -Infinity })),
    hostility: {}, truces: [], trucesHeld: 0, proposal: null, nextTruceCheckAt: 60000, tickAcc: 0, lastBattleNotifyAt: -Infinity,
  };
}

export function sectorAt(x: number, z: number): SectorId {
  let best = 0, bd = Infinity;
  for (const s of SECTORS) {
    const d = (s.center.x - x) ** 2 + (s.center.z - z) ** 2;
    if (d < bd) { bd = d; best = s.id; }
  }
  return best;
}

let adjacency: Set<number>[] | null = null;
/** Sectors that share a border (sampled over the map). */
export function neighbours(id: SectorId): Set<number> {
  if (!adjacency) {
    adjacency = SECTORS.map(() => new Set<number>());
    const step = 120;
    for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += step) {
      for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += step) {
        const a = sectorAt(x, z);
        for (const b of [sectorAt(x + step, z), sectorAt(x, z + step)]) {
          if (a !== b) { adjacency[a].add(b); adjacency[b].add(a); }
        }
      }
    }
  }
  return adjacency[id];
}

let points: (Point & { y: number })[] | null = null;
/** Each sector's strategic point: the nearest walkable spot to where it should be (same on every device). */
export function sectorPoint(id: SectorId): Point & { y: number } {
  if (!points) {
    const nodes = navGraph().nodes.filter((n) => n.reachable);
    points = SECTORS.map((s) => {
      const wantY = s.pointNear.y ?? 0;
      let best = nodes[0], bd = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x - s.pointNear.x, n.z - s.pointNear.z) + Math.abs(n.y - wantY) * 4;
        if (d < bd) { bd = d; best = n; }
      }
      return { x: best.x, y: best.y, z: best.z };
    });
  }
  return points[id];
}

/** Sectors a nation holds. */
export function held(state: GameState, n: NationId): SectorId[] {
  return state.war.sectors.flatMap((s, i) => (s.owner === n ? [i] : []));
}

/** A front: two touching sectors held by different nations. */
export function isFrontline(state: GameState, id: SectorId): boolean {
  const o = state.war.sectors[id].owner;
  if (!o) return false;
  for (const b of neighbours(id)) {
    const ob = state.war.sectors[b].owner;
    if (ob && ob !== o) return true;
  }
  return false;
}

/** Border segments between sectors of two different nations. */
export function frontPairs(state: GameState): [SectorId, SectorId][] {
  const out: [SectorId, SectorId][] = [];
  for (const s of SECTORS) {
    for (const b of neighbours(s.id)) {
      if (b <= s.id) continue;
      const oa = state.war.sectors[s.id].owner, ob = state.war.sectors[b].owner;
      if (oa && ob && oa !== ob) out.push([s.id, b]);
    }
  }
  return out;
}

/** Two nations are at war unless a ceasefire (一時停戦) is on between them. */
export function atWar(state: GameState, a: NationId, b: NationId): boolean {
  if (a === b) return false;
  return !state.war.truces.some((t) => t.until > state.time && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}

export function hostility(state: GameState, a: NationId, b: NationId): number {
  return state.war.hostility[pairKey(a, b)] ?? 0;
}

/** A capture attempt between two nations: they are fighting here. */
export function noteClash(state: GameState, at: Point, a: NationId, b: NationId): void {
  const w = state.war, k = pairKey(a, b);
  w.hostility[k] = (w.hostility[k] ?? 0) + 1;
  const id = sectorAt(at.x, at.z), s = w.sectors[id];
  s.lastClashAt = state.time;
  if (state.time - s.notifiedAt > NOTIFY_MS && state.time - w.lastBattleNotifyAt > 15000) {
    s.notifiedAt = w.lastBattleNotifyAt = state.time;
    emit(state, { type: 'SECTOR_BATTLE', sector: id, nations: [a, b] });
  }
}

/**
 * Overall standing of a nation (国力), for the commanders' decisions only:
 * sectors, the tower, people free and in jail, and the king's state.
 */
export function strength(state: GameState, n: NationId): number {
  const king = kingOf(state, n);
  if (!king?.alive) return 0;
  const people = state.entities.filter((e) => e.nation === n);
  const free = people.filter((e) => e.alive && !e.jailed).length;
  const jailed = people.filter((e) => e.jailed).length;
  return held(state, n).length * 1.2 + (state.tower.owner === n ? 1.5 : 0) + (free / people.length) * 5 - jailed * 0.3 + (king.jailed ? -3 : 1);
}

/** Who stands on each point, and the capture gauges (run every simulation step). */
export function warTick(state: GameState, dt: number): void {
  const w = state.war;
  w.tickAcc += dt;
  if (w.tickAcc < 0.1) return;
  const step = w.tickAcc;
  w.tickAcc = 0;
  for (const k of Object.keys(w.hostility)) w.hostility[k] *= Math.pow(0.985, step);
  w.truces = w.truces.filter((t) => {
    if (t.until > state.time) return true;
    emit(state, { type: 'TRUCE_ENDED', a: t.a, b: t.b });
    return false;
  });
  SECTORS.forEach((_def, i) => {
    const s = w.sectors[i], p = sectorPoint(i);
    const count: PerNation<number> = { sun: 0, moon: 0, star: 0 };
    for (const e of state.entities) {
      if (!e.alive || e.jailed || Math.abs(e.y - p.y) > 60) continue;
      if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 < POINT_R * POINT_R) count[e.nation]++;
    }
    s.count = count;
    const present = NATION_IDS.filter((n) => count[n] > 0);
    const wasContested = s.contested;
    s.contested = present.length > 1;
    if (s.contested) {
      if (!wasContested && state.time - s.notifiedAt > NOTIFY_MS) {
        s.notifiedAt = state.time;
        emit(state, { type: 'SECTOR_CONTESTED', sector: i, nations: present });
      }
      return;
    }
    if (!present.length) {
      s.progress = Math.max(0, s.progress - step / 30);
      if (!s.progress) s.capturer = null;
      return;
    }
    const n = present[0];
    const rate = (1 + 0.5 * (Math.min(count[n], 4) - 1)) / CAPTURE_SEC;
    if (n === s.owner) {
      // The holder on its own point pushes the attackers' gauge back.
      s.progress = Math.max(0, s.progress - rate * step * 1.5);
      if (!s.progress) s.capturer = null;
      return;
    }
    if (s.capturer && s.capturer !== n) {
      s.progress -= rate * step;
      if (s.progress > 0) return;
      s.progress = 0;
    }
    if (s.capturer !== n) {
      s.capturer = n;
      if (s.owner) emit(state, { type: 'SECTOR_ATTACKED', sector: i, by: n, owner: s.owner });
    }
    s.progress += rate * step;
    if (s.progress >= 1) {
      const from = s.owner;
      s.owner = n;
      s.capturer = null;
      s.progress = 0;
      s.notifiedAt = state.time;
      emit(state, { type: 'SECTOR_CAPTURED', sector: i, nation: n, from });
    }
  });
  if (w.proposal && state.time > w.proposal.expires) answerTruce(state, false);
}

/** The sector someone is in, with its holder. */
export function sectorOf(state: GameState, e: Pick<Entity, 'x' | 'z'>): { id: SectorId; owner: NationId | null } {
  const id = sectorAt(e.x, e.z);
  return { id, owner: state.war.sectors[id].owner };
}

/** A nation's rear: held sectors away from the front, or else its home sector (the king stays there). */
export function rearSectors(state: GameState, n: NationId): SectorId[] {
  const mine = held(state, n);
  const rear = mine.filter((id) => !isFrontline(state, id) && !state.war.sectors[id].contested);
  if (rear.length) return rear;
  const home = sectorAt(NATIONS[n].base.x, NATIONS[n].base.z);
  return mine.includes(home) ? [home] : mine;
}

/** Truly safe ground: held sectors with no enemy neighbour (may be none). */
export function safeRear(state: GameState, n: NationId): SectorId[] {
  return held(state, n).filter((id) => !isFrontline(state, id) && !state.war.sectors[id].contested);
}

/** The nearest spot of a sector toward a nation's base (for staging behind a front). */
export function behind(id: SectorId, n: NationId, dist: number): Point {
  const p = sectorPoint(id), b = NATIONS[n].base;
  const d = Math.hypot(b.x - p.x, b.z - p.z) || 1;
  const k = Math.min(dist, d * 0.8) / d;
  return { x: p.x + (b.x - p.x) * k, z: p.z + (b.z - p.z) * k };
}

// ------------------------------------------------------------ ceasefire (一時停戦)

export const MAX_TRUCES = 2;
export const TRUCE_MS = 45000;
/** How long a person has to answer an offer. */
export const TRUCE_ANSWER_MS = 12000;

export function trucesLeft(state: GameState): number {
  return Math.max(0, MAX_TRUCES - state.war.trucesHeld);
}

function startTruce(state: GameState, a: NationId, b: NationId): void {
  const w = state.war;
  w.trucesHeld++;
  w.truces.push({ a, b, until: state.time + TRUCE_MS });
  w.nextTruceCheckAt = state.time + TRUCE_MS + 60000; // not straight into another
  emit(state, { type: 'TRUCE_STARTED', a, b, sec: TRUCE_MS / 1000 });
  // Stop chasing the new partner at once.
  for (const e of state.entities) {
    const t = e.ai.targetId === null ? null : state.entities[e.ai.targetId];
    if (t && ((e.nation === a && t.nation === b) || (e.nation === b && t.nation === a))) { e.ai.targetId = null; e.ai.goal = null; e.ai.path = null; }
  }
}

/** Would `to` accept a ceasefire with `from`? Only when a third nation is clearly stronger than both. */
export function wouldAccept(state: GameState, from: NationId, to: NationId): boolean {
  const third = NATION_IDS.find((n) => n !== from && n !== to)!;
  const s3 = strength(state, third);
  return s3 > 0 && s3 > strength(state, to) * 1.15 && s3 > strength(state, from) * 1.05;
}

/**
 * `from` offers `to` a short ceasefire. A person in charge of `to` (the player's
 * nation) is asked; otherwise its commander decides at once.
 */
export function proposeTruce(state: GameState, from: NationId, to: NationId): boolean {
  const w = state.war;
  if (from === to || trucesLeft(state) <= 0 || w.proposal || !atWar(state, from, to)) return false;
  if (!kingOf(state, from)?.alive || !kingOf(state, to)?.alive) return false;
  if (to === state.player.nation && state.player.alive) {
    w.proposal = { from, to, expires: state.time + TRUCE_ANSWER_MS };
    emit(state, { type: 'TRUCE_PROPOSED', from, to });
    return true;
  }
  emit(state, { type: 'TRUCE_PROPOSED', from, to });
  if (wouldAccept(state, from, to)) startTruce(state, from, to);
  else emit(state, { type: 'TRUCE_DECLINED', from, to });
  return true;
}

/** The player's answer to an offer (also: no answer in time = no). */
export function answerTruce(state: GameState, accept: boolean): void {
  const p = state.war.proposal;
  if (!p) return;
  state.war.proposal = null;
  if (accept && trucesLeft(state) > 0) startTruce(state, p.from, p.to);
  else emit(state, { type: 'TRUCE_DECLINED', from: p.from, to: p.to });
}
