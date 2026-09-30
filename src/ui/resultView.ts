import { NATIONS, NATION_IDS, nationCss } from '../config/nations';
import { nameOf } from '../config/names';
import type { RoleId } from '../config/roles';
import { roleJa, roleName } from '../config/roles';
import { FACTIONS, facFull } from '../config/terminology';
import type { Contrib } from '../sim/contrib';
import { contribution, ranking, titleFor } from '../sim/contrib';
import type { GameState } from '../sim/state';
import { elapsedSec, kingOf } from '../sim/state';
import { GAME_TIME } from '../config/constants';
import { nationScore } from '../sim/systems/winCondition';
import { $ } from './dom';
import type { Recap } from './recap';
import { recordLine, recordMatch } from './records';

export interface ResultActions {
  retry(): void;
  settings(): void;
  title(): void;
}

/** The three buttons under the result (what they do is the screen flow's business). */
export function initResultView(actions: ResultActions): void {
  const once = (f: () => void) => () => {
    for (const id of ['btnRetry', 'btnResSetup', 'btnResTitle']) ($(id) as HTMLButtonElement).disabled = true;
    $('overlay').classList.add('leaving');
    setTimeout(f, 180);
  };
  $('btnRetry').onclick = once(actions.retry);
  $('btnResSetup').onclick = once(actions.settings);
  $('btnResTitle').onclick = once(actions.title);
}

/** Detailed stats, the ones that matter most for your role first. */
type StatKey = 'cap' | 'res' | 'kingHit' | 'kingCap' | 'kingRes' | 'sector' | 'tower' | 'survive' | 'dash' | 'snipe' | 'escort';
const ORDER: Record<RoleId, StatKey[]> = {
  king: ['survive', 'cap', 'kingHit', 'res', 'sector', 'tower', 'kingCap', 'kingRes', 'dash'],
  soldier: ['cap', 'escort', 'kingHit', 'kingCap', 'sector', 'res', 'tower', 'survive', 'dash'],
  ranger: ['cap', 'sector', 'kingHit', 'kingCap', 'res', 'dash', 'tower', 'kingRes', 'survive'],
  sniper: ['snipe', 'cap', 'kingHit', 'kingCap', 'sector', 'res', 'tower', 'survive', 'dash'],
  communicator: ['tower', 'sector', 'cap', 'kingHit', 'kingCap', 'res', 'kingRes', 'survive', 'dash'],
  keyholder: ['res', 'kingRes', 'cap', 'kingHit', 'kingCap', 'sector', 'tower', 'survive', 'dash'],
};

function statLine(k: StatKey, r: Contrib, survive: number, dash: number): [string, string] {
  switch (k) {
    case 'cap': return ['TRACE数', `${r.cap}`];
    case 'res': return ['解放数', `${r.res}`];
    case 'kingHit': return ['ANCHORへの攻撃', `${r.kingHit}`];
    case 'kingCap': return ['ANCHOR LOCK', `${r.kingCap}`];
    case 'kingRes': return ['ANCHOR解放', `${r.kingRes}`];
    case 'sector': return ['戦区制圧貢献', `参加${r.secJoin}・奪取${r.secSteal}`];
    case 'tower': return ['管制塔貢献', `占領${r.towerCap}・${Math.round(r.towerSec)}秒`];
    case 'survive': return ['生存時間', fmtTime(survive)];
    case 'dash': return ['ダッシュ距離', `${Math.round(dash / 25)}m`];
    case 'snipe': return ['狙撃命中', `${r.snipeHit}（援護${r.snipeAssist}）`];
    case 'escort': return ['ANCHORの護衛', `${Math.round(r.escortSec)}秒`];
  }
}

const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`;

let recorded = false;

export function showResult(state: GameState, recap?: Recap): void {
  const p = state.player, winner = state.winner;
  document.body.dataset.screen = 'RESULT';
  const ov = $('overlay');
  ov.style.display = 'flex';
  ov.classList.remove('leaving');
  ov.scrollTop = 0;
  const timeUp = elapsedSec(state) >= GAME_TIME - 0.5;
  const kings = NATION_IDS.filter((n) => kingOf(state, n)?.alive);
  // Header: who won.
  const head = ov.querySelector('.res-head') as HTMLElement;
  if (winner === 'draw' || !winner) {
    $('ovTitle').textContent = '引き分け';
    head.style.setProperty('--wc', '#e0b456');
    $('ovDesc').textContent = timeUp ? '時間切れ ― 戦功ポイントが同点だった。' : 'すべての勢力のネットワークが切断された。';
  } else {
    $('ovTitle').textContent = `NETWORK SECURED — ${NATIONS[winner].name} VICTORY`;
    head.style.setProperty('--wc', nationCss(winner));
    $('ovDesc').textContent = (winner === p.nation ? `${FACTIONS[winner].ja}の勝利！ あなたの勢力がネットワークを守り抜いた。` : `${FACTIONS[winner].ja}の勝利。あなたの勢力は敗れた。`)
      + (timeUp && kings.length > 1 ? `（時間切れ・戦功ポイント判定：${kings.map((n) => `${NATIONS[n].name} ${nationScore(state, n)}`).join(' / ')}）` : '');
  }
  // You.
  const ranks = ranking(state);
  const mine = ranks.find((r) => r.id === p.id)!;
  const sameNation = ranks.filter((r) => state.entities[r.id].nation === p.nation).length;
  const c = contribution(state, p);
  const total = state.contrib.totals?.[p.id] ?? c.total;
  const r = state.contrib.table[p.id];
  const who = $('resWho');
  who.replaceChildren();
  const crest = document.createElement('span');
  crest.className = 'res-crest';
  crest.style.setProperty('--nc', nationCss(p.nation));
  crest.textContent = NATIONS[p.nation].emblem;
  const wt = document.createElement('span');
  wt.textContent = `${NATIONS[p.nation].name} ・ ${roleName(p.role)}（${roleJa(p.role)}）`;
  who.append(crest, wt);
  $('resTitle').textContent = `称号「${titleFor(state, p)}」`;
  countUp($('resScore'), total);
  $('resRank').textContent = `${mine.rank}位 / ${ranks.length}人`;
  $('resNationRank').textContent = `${mine.nationRank}位 / ${sameNation}人`;
  const survive = p.eliminatedAt != null ? p.eliminatedAt : Math.max(r.survivedSec, elapsedSec(state));
  const dl = $('resStats');
  dl.replaceChildren();
  for (const k of ORDER[p.role]) {
    const [label, value] = statLine(k, r, survive, Math.max(r.dash, p.dashDistance));
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    dl.append(dt, dd);
  }
  const ul = $('resBreakdown');
  ul.replaceChildren();
  const lines = [...c.base, ...c.role.map((l) => ({ ...l, role: true }))];
  if (!lines.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = '今回は得点なし';
    ul.append(li);
  }
  for (const l of lines) {
    const li = document.createElement('li');
    if ('role' in l) li.className = 'role';
    const a = document.createElement('span'), b = document.createElement('b');
    a.textContent = l.label;
    b.textContent = `+${l.pts}`;
    li.append(a, b);
    ul.append(li);
  }
  // Everyone.
  const ol = $('resRanking');
  ol.replaceChildren();
  ranks.forEach((row, i) => {
    const e = state.entities[row.id];
    const li = document.createElement('li');
    li.className = 'rk-row' + (e.id === p.id ? ' me' : '') + (state.winner === e.nation ? ' won' : '');
    li.style.setProperty('--nc', nationCss(e.nation));
    li.style.animationDelay = `${Math.min(i, 30) * 35}ms`;
    const rank = document.createElement('span');
    rank.className = 'rk-rank';
    rank.textContent = String(row.rank);
    const em = document.createElement('span');
    em.className = 'rk-crest';
    em.textContent = NATIONS[e.nation].emblem;
    const name = document.createElement('span');
    name.className = 'rk-name';
    const nick = state.humanNames[e.id];
    name.textContent = e.id === p.id ? (nick ?? nameOf(e.id)) + '（あなた）' : nick ?? nameOf(e.id);
    const role = document.createElement('span');
    role.className = 'rk-role';
    role.textContent = roleName(e.role) + (!e.alive ? '・離脱' : '');
    const pts = document.createElement('b');
    pts.className = 'rk-pts';
    pts.textContent = `${row.total}`;
    li.append(rank, em, name, role, pts);
    ol.append(li);
  });
  requestAnimationFrame(() => {
    const meRow = ol.querySelector('.me') as HTMLElement | null;
    if (!meRow) return;
    // Bring your own row into the list's view (only the list scrolls, not the page).
    const top = meRow.getBoundingClientRect().top - ol.getBoundingClientRect().top + ol.scrollTop;
    if (top + meRow.offsetHeight > ol.clientHeight) ol.scrollTop = top - ol.clientHeight / 2;
  });
  // Nations.
  const nat = $('resNations');
  nat.replaceChildren();
  for (const n of NATION_IDS) {
    const k = kingOf(state, n);
    const card = document.createElement('div');
    card.className = 'rn-card' + (winner === n ? ' won' : '');
    card.style.setProperty('--nc', nationCss(n));
    const h = document.createElement('div');
    h.className = 'rn-head';
    h.textContent = `${NATIONS[n].emblem} ${facFull(n)}${winner === n ? '　VICTORY' : ''}`;
    const s = state.natStats[n];
    const sectors = state.war.sectors.filter((x) => x.owner === n).length;
    const kingState = !k ? '―' : !k.alive ? 'LOST' : k.jailed ? 'LOCKED' : '健在';
    const body = document.createElement('dl');
    for (const [a, b] of [['TRACE', `${s.cap}`], ['解放', `${s.res}`], ['戦区', `${sectors}`], ['ANCHOR', kingState]]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = a;
      dd.textContent = b;
      if (a === 'ANCHOR') dd.className = kingState === '健在' ? 'ok' : 'ng';
      body.append(dt, dd);
    }
    card.append(h, body);
    nat.append(card);
  }
  if (recap) $('ovRecap').replaceChildren(recap.render());
  if (!recorded) {
    recorded = true;
    $('ovRecord').textContent = recordLine(recordMatch(p.role, p.nation, winner, p.capturesMade, p.rescuesMade), p.role);
  }
}

/** The score rolls up to its value (light, skipped when motion is reduced). */
function countUp(el: HTMLElement, to: number): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || to <= 0) { el.textContent = String(to); return; }
  const t0 = performance.now(), dur = 900;
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(tick);
  };
  tick();
}
