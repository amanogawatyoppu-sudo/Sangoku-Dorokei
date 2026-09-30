import type { NationId } from '../config/nations';
import { NATIONS } from '../config/nations';
import type { RoleId } from '../config/roles';
import type { Entity } from './entity';
import type { GameEvent } from './events';
import type { GameState } from './state';
import { nearTowerBase } from './systems/towerZone';
import { visibleTo } from './systems/vision';
import { POINT_R, sectorPoint } from './war';

/**
 * Contribution (貢献度) — what each person did for their nation, counted the same way
 * for CPUs and people. Filled from the match's events plus a light sample twice a
 * second; `contribution()` turns it into points: a shared base (captures, rescues,
 * sectors, the tower, fighting, winning) plus a moderate bonus for the role's own job.
 */
export interface Contrib {
  cap: number; kingHit: number; kingCap: number; res: number; kingRes: number; rescueTries: number;
  secJoin: number; secSteal: number; towerCap: number; towerSec: number; frontSec: number; fights: number;
  snipeHit: number; snipeAssist: number; radar: number; pings: number;
  escortSec: number; jailGuardSec: number; chaseSec: number; highSec: number; jailRaidSec: number;
  survivedSec: number; escapes: number; dash: number;
}

const zero = (): Contrib => ({
  cap: 0, kingHit: 0, kingCap: 0, res: 0, kingRes: 0, rescueTries: 0, secJoin: 0, secSteal: 0, towerCap: 0, towerSec: 0, frontSec: 0, fights: 0,
  snipeHit: 0, snipeAssist: 0, radar: 0, pings: 0, escortSec: 0, jailGuardSec: 0, chaseSec: 0, highSec: 0, jailRaidSec: 0, survivedSec: 0, escapes: 0, dash: 0,
});
export const CONTRIB_KEYS = Object.keys(zero()) as (keyof Contrib)[];

export interface ContribState {
  table: Contrib[];
  /** Who last stunned each person with a rifle, and when (for assists). */
  lastStun: Map<number, { by: number; t: number }>;
  /** A king in danger (enemy close), and since when it has been clear. */
  kingDanger: Map<number, number>;
  lastPos: Map<number, { x: number; z: number }>;
  acc: number;
  /** Online guests: everyone's final totals as the host counted them (the host sends only these). */
  totals: number[] | null;
}

export function createContrib(n: number): ContribState {
  return { table: Array.from({ length: n }, zero), lastStun: new Map(), kingDanger: new Map(), lastPos: new Map(), acc: 0, totals: null };
}

const SAMPLE = 0.5;

/** Reads the events of this step and samples positions (host / solo only). */
export function contribTick(state: GameState, fromEvent: number, dt: number): void {
  const c = state.contrib, T = c.table;
  for (let i = fromEvent; i < state.events.length; i++) onEvent(state, state.events[i]);
  for (const e of state.entities) T[e.id].kingHit = e.kingHits;
  c.acc += dt;
  if (c.acc < SAMPLE) return;
  const s = c.acc;
  c.acc = 0;
  const kings = state.entities.filter((e) => e.role === 'king');
  for (const e of state.entities) {
    const row = T[e.id];
    const last = c.lastPos.get(e.id);
    if (last && e.dashing) row.dash += Math.hypot(e.x - last.x, e.z - last.z);
    c.lastPos.set(e.id, { x: e.x, z: e.z });
    if (!e.alive || e.jailed) continue;
    row.survivedSec += s;
    if (nearTowerBase(e)) row.towerSec += s;
    const foes = state.entities.filter((o) => o.nation !== e.nation && o.alive && !o.jailed && Math.hypot(o.x - e.x, o.z - e.z) < 700 && visibleTo(state, o, e));
    const nearFoe = foes.some((o) => Math.hypot(o.x - e.x, o.z - e.z) < 400);
    // On a point that is being fought over.
    state.war.sectors.forEach((sec, i) => {
      if (!sec.contested) return;
      const p = sectorPoint(i);
      if (Math.hypot(p.x - e.x, p.z - e.z) < POINT_R && Math.abs(p.y - e.y) < 60) row.frontSec += s;
    });
    const king = kings.find((k) => k.nation === e.nation && k.alive && !k.jailed);
    if (king && king !== e && Math.hypot(king.x - e.x, king.z - e.z) < 300) row.escortSec += s;
    const myJail = NATIONS[e.nation].jail;
    if (state.entities.some((o) => o.jailed && o.capturedBy === e.nation) && Math.hypot(myJail.x - e.x, myJail.z - e.z) < 300) row.jailGuardSec += s;
    for (const n of ['sun', 'moon', 'star'] as NationId[]) {
      if (n === e.nation) continue;
      const j = NATIONS[n].jail;
      if (Math.hypot(j.x - e.x, j.z - e.z) < 260) row.jailRaidSec += s;
    }
    if (e.dashing && nearFoe) row.chaseSec += s;
    if (e.y > 100 && foes.length) row.highSec += s;
    if (e.role === 'king') {
      // Danger: an enemy in sight within 250. Escaped: 4 s with nobody within 500.
      const close = foes.some((o) => Math.hypot(o.x - e.x, o.z - e.z) < 250);
      const clear = !foes.some((o) => Math.hypot(o.x - e.x, o.z - e.z) < 500);
      const since = c.kingDanger.get(e.id);
      if (close) c.kingDanger.set(e.id, -1);
      else if (since !== undefined && clear) {
        if (since < 0) c.kingDanger.set(e.id, state.time);
        else if (state.time - since > 4000) { row.escapes++; c.kingDanger.delete(e.id); }
      } else if (since !== undefined && since >= 0 && !clear) c.kingDanger.set(e.id, -1);
    }
  }
}

function onEvent(state: GameState, ev: GameEvent): void {
  const c = state.contrib, T = c.table;
  switch (ev.type) {
    case 'CAPTURE': {
      const t = state.entities[ev.targetId];
      if (t.role === 'king') T[ev.attackerId].kingCap++;
      else T[ev.attackerId].cap++;
      T[ev.attackerId].fights++;
      // A sniper's stun that made this capture possible.
      const st = c.lastStun.get(ev.targetId);
      if (st && state.time - st.t < 6000 && st.by !== ev.attackerId && state.entities[st.by].nation === state.entities[ev.attackerId].nation) T[st.by].snipeAssist++;
      // Everyone close by took part in the fight.
      for (const o of state.entities) {
        if (o.id === ev.attackerId || o.id === ev.targetId || !o.alive || o.jailed) continue;
        if (Math.hypot(o.x - t.x, o.z - t.z) < 400) T[o.id].fights++;
      }
      break;
    }
    case 'CAPTURE_FAILED': T[ev.attackerId].fights++; break;
    case 'RESCUE_STARTED': T[ev.rescuerId].rescueTries++; break;
    case 'RESCUED': {
      T[ev.rescuerId].res++;
      if (state.entities[ev.targetId].role === 'king') T[ev.rescuerId].kingRes++;
      break;
    }
    case 'ABILITY':
      if (ev.result === 'sniper_stun' && ev.targetId !== undefined) { T[ev.entityId].snipeHit++; c.lastStun.set(ev.targetId, { by: ev.entityId, t: state.time }); }
      if (ev.result === 'radar') T[ev.entityId].radar++;
      break;
    case 'PING': T[ev.by].pings++; break;
    case 'SECTOR_CAPTURED': {
      const p = sectorPoint(ev.sector);
      for (const e of state.entities) {
        if (e.nation !== ev.nation || !e.alive || e.jailed) continue;
        if (Math.hypot(p.x - e.x, p.z - e.z) < POINT_R + 30 && Math.abs(p.y - e.y) < 60) { T[e.id].secJoin++; if (ev.from) T[e.id].secSteal++; }
      }
      break;
    }
    case 'TOWER_CAPTURED':
      for (const e of state.entities) if (e.nation === ev.nation && e.alive && !e.jailed && nearTowerBase(e, 40)) T[e.id].towerCap++;
      break;
    default:
  }
  // King hits: counted where they happen (capture.ts keeps kingHits on the entity for everyone).
}

export interface ScoreLine { label: string; pts: number }
export interface Contribution { total: number; base: ScoreLine[]; role: ScoreLine[] }

const cap = (v: number, max: number) => Math.min(v, max);

/** Points for one person: base (shared by every role) + the role's own job. */
export function contribution(state: GameState, e: Entity): Contribution {
  const r = state.contrib.table[e.id];
  const won = state.winner === e.nation;
  const kingHits = r.kingHit;
  const base: ScoreLine[] = [
    { label: '敵をTRACE', pts: r.cap * 100 },
    { label: '敵ANCHORへの有効TRACE', pts: Math.max(0, kingHits - r.kingCap) * 150 },
    { label: '敵ANCHORをLOCK', pts: r.kingCap * 500 },
    { label: '味方を解放', pts: r.res * 150 },
    { label: '味方ANCHORを解放', pts: r.kingRes * 500 },
    { label: '戦区制圧に参加', pts: r.secJoin * 80 },
    { label: '敵戦区を奪取', pts: r.secSteal * 120 },
    { label: '管制塔の占領', pts: r.towerCap * 100 },
    { label: '前線で戦闘', pts: cap(Math.floor(r.frontSec / 5) + r.fights, 10) * 30 },
    { label: '試合に勝利', pts: won ? 200 : 0 },
  ];
  const role = roleLines(e.role, r, e, won);
  const total = [...base, ...role].reduce((a, b) => a + b.pts, 0);
  return { total, base: base.filter((b) => b.pts), role: role.filter((b) => b.pts) };
}

function roleLines(role: RoleId, r: Contrib, e: Entity, won: boolean): ScoreLine[] {
  const alive = e.alive && !e.jailed;
  switch (role) {
    case 'king': return [
      { label: 'ANCHORとして生存', pts: Math.round(cap(r.survivedSec, 300) * 0.6) },
      { label: '最後まで生存', pts: alive ? 120 : 0 },
      { label: '危険からの脱出', pts: cap(r.escapes, 4) * 60 },
      { label: 'ANCHORとして勝利', pts: won && alive ? 100 : 0 },
    ];
    case 'soldier': return [
      { label: '味方ANCHORの護衛', pts: Math.round(cap(r.escortSec, 150)) },
      { label: 'TRACE（VANGUARD）', pts: r.cap * 20 },
      { label: '前線参加', pts: Math.round(cap(r.frontSec, 120)) },
      { label: 'LOCK POINTの防衛', pts: Math.round(cap(r.jailGuardSec, 120)) },
    ];
    case 'ranger': return [
      { label: '追跡', pts: Math.round(cap(r.chaseSec, 150)) },
      { label: '救援戦・乱戦への参加', pts: cap(r.fights, 8) * 30 },
      { label: '戦区奪取への参加', pts: r.secJoin * 40 },
    ];
    case 'sniper': return [
      { label: '狙撃命中（敵スタン）', pts: r.snipeHit * 60 },
      { label: 'TRACEにつながった援護', pts: r.snipeAssist * 120 },
      { label: '高所からの支援', pts: Math.round(cap(r.highSec, 240) * 0.5) },
    ];
    case 'communicator': return [
      { label: '管制塔の維持', pts: Math.round(cap(r.towerSec, 250)) },
      { label: '管制塔の占領（RELAY）', pts: r.towerCap * 100 },
      { label: 'レーダー使用', pts: cap(r.radar, 5) * 40 },
      { label: '情報共有（合図）', pts: cap(r.pings, 6) * 15 },
    ];
    case 'keyholder': return [
      { label: '解放（BREAKER）', pts: r.res * 50 },
      { label: 'ANCHOR解放（BREAKER）', pts: r.kingRes * 200 },
      { label: '解除成功率', pts: r.rescueTries ? Math.round((Math.min(r.res, r.rescueTries) / r.rescueTries) * 100) : 0 },
      { label: '敵LOCK POINTへの侵入', pts: cap(Math.floor(r.jailRaidSec / 5), 4) * 40 },
    ];
    default: return [];
  }
}

export interface Ranked { id: number; total: number; rank: number; nationRank: number }

/** Everyone ranked by points; equal points share a rank (1, 2, 2, 4). */
export function ranking(state: GameState): Ranked[] {
  const tot = state.contrib.totals;
  const rows = state.entities.map((e) => ({ id: e.id, nation: e.nation, total: tot?.[e.id] ?? contribution(state, e).total }));
  rows.sort((a, b) => b.total - a.total || a.id - b.id);
  const rankOf = (list: { total: number }[], i: number) => list.findIndex((x) => x.total === list[i].total) + 1;
  return rows.map((r, i) => {
    const same = rows.filter((x) => x.nation === r.nation);
    return { id: r.id, total: r.total, rank: rankOf(rows, i), nationRank: rankOf(same, same.indexOf(r)) };
  });
}

/** One title for what the person stood out for (separate from the score). */
export function titleFor(state: GameState, e: Entity): string {
  const r = state.contrib.table[e.id];
  const won = state.winner === e.nation;
  const alive = e.alive && !e.jailed;
  const myKing = state.entities.find((k) => k.nation === e.nation && k.role === 'king');
  if (r.kingCap > 0) return 'ANCHOR HUNTER';
  if (r.kingRes > 0) return 'ANCHORを救った英雄';
  if (e.role === 'king') return alive ? (won ? 'NETWORK GUARDIAN' : '最後まで逃げ切ったANCHOR') : r.escapes >= 2 ? '粘り強いANCHOR' : '途切れたリンク';
  if (r.escortSec >= 90 && myKing?.alive && !myKing.jailed) return 'ANCHORを守り抜いた盾';
  if (r.res >= 3) return '救援のスペシャリスト';
  if (r.cap >= 4) return '前線の英雄';
  if (r.snipeHit >= 3) return 'HIGH GROUND';
  if (r.snipeAssist >= 2) return '影の援護者';
  if (r.towerSec >= 60 || r.radar >= 2) return '情報戦の要';
  if (r.secSteal >= 1) return '戦区奪取の立役者';
  if (r.chaseSec >= 40) return '韋駄天';
  if (alive && r.survivedSec >= 200) return '神出鬼没';
  if (r.cap >= 1) return 'TRACE MASTER';
  if (r.res >= 1) return '仲間想い';
  if (r.fights >= 3) return '乱戦の常連';
  return { soldier: '堅実なVANGUARD', ranger: '街を駆けるRUNNER', sniper: '潜むSPOTTER', communicator: '陰のRELAY', keyholder: '慎重なBREAKER', king: 'ANCHOR' }[e.role];
}
