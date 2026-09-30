import type { NationId } from '../config/nations';
import { NATIONS, NATION_IDS } from '../config/nations';
import { nameOf } from '../config/names';
import { roleName } from '../config/roles';
import type { EventBus } from '../core/events';
import type { GameEvent } from '../sim/events';
import type { GameState } from '../sim/state';
import { elapsedSec } from '../sim/state';
import { SECTORS } from '../sim/war';

type Kind = 'cap' | 'exec' | 'rescue' | 'king' | 'war' | 'tower' | 'diplo';
interface Entry { t: number; kind: Kind; text: string; mine: boolean }

/**
 * The match as it happened, for the result screen: a timeline of what mattered
 * (your nation's captures, rescues and executions, kings, sectors, the tower,
 * ceasefires) and the stand-out people of the match.
 */
export class Recap {
  private entries: Entry[] = [];
  private rescues = new Map<number, number>();
  private firstJailed = new Map<number, number>();
  private otherCaps = 0;

  constructor(bus: EventBus<GameEvent>, private state: GameState) {
    const N = (n: NationId) => NATIONS[n].name;
    const who = (id: number) => { const e = state.entities[id]; return `${N(e.nation)}の${state.humanNames[id] ?? nameOf(id)}（${roleName(e.role)}）`; };
    const mine = (n: NationId) => n === state.player.nation;
    const add = (kind: Kind, text: string, isMine: boolean) => this.entries.push({ t: elapsedSec(state), kind, text, mine: isMine });
    bus.on('JAILED', (ev) => {
      const e = state.entities[ev.entityId];
      if (!this.firstJailed.has(e.id)) this.firstJailed.set(e.id, elapsedSec(state));
      if (mine(e.nation) || mine(ev.capNation) || e.role === 'king') add(e.role === 'king' ? 'king' : 'cap', `${who(e.id)}が${N(ev.capNation)}にLOCKされた`, mine(e.nation));
      else this.otherCaps++;
    });
    bus.on('ELIMINATED', (ev) => { const e = state.entities[ev.entityId]; if (mine(e.nation) || e.role === 'king') add('exec', `${who(e.id)}が戦線離脱`, mine(e.nation)); });
    bus.on('RESCUED', (ev) => {
      this.rescues.set(ev.rescuerId, (this.rescues.get(ev.rescuerId) ?? 0) + 1);
      const t = state.entities[ev.targetId];
      if (mine(t.nation) || t.role === 'king') add('rescue', `${who(ev.rescuerId)}が${state.humanNames[t.id] ?? nameOf(t.id)}を解放`, mine(t.nation));
    });
    bus.on('NATION_FALLEN', (ev) => add('king', `${N(ev.nation)}のANCHORのリンクが切断 — ${N(ev.nation)} NETWORK LOST`, mine(ev.nation)));
    bus.on('SECTOR_CAPTURED', (ev) => add('war', `${N(ev.nation)}が${SECTORS[ev.sector].name}戦区を制圧${ev.from ? `（${N(ev.from)}から）` : ''}`, mine(ev.nation) || (ev.from !== null && mine(ev.from))));
    bus.on('TOWER_CAPTURED', (ev) => add('tower', `${N(ev.nation)}が管制塔を占領`, mine(ev.nation)));
    bus.on('KING_BEACON', (ev) => add('tower', `${N(ev.nation)}がANCHOR SCANを実行`, mine(ev.nation)));
    bus.on('TRUCE_STARTED', (ev) => add('diplo', `${N(ev.a)}と${N(ev.b)}がTRUCE（一時停戦）`, mine(ev.a) || mine(ev.b)));
  }

  /** The timeline and the MVP cards, as DOM. */
  render(): HTMLElement {
    const state = this.state;
    const box = document.createElement('div');
    box.className = 'recap';
    // Stand-out people.
    const people = state.entities;
    const best = <T>(score: (id: number) => number, fmt: (id: number, v: number) => T) => {
      let id = -1, v = 0;
      for (const e of people) { const s = score(e.id); if (s > v) { v = s; id = e.id; } }
      return id < 0 ? null : fmt(id, v);
    };
    const card = (title: string, id: number, detail: string) => {
      const e = people[id];
      const d = document.createElement('div');
      d.className = 'mvp' + (e.nation === state.player.nation ? ' mine' : '') + (e.isPlayer ? ' me' : '');
      d.style.setProperty('--nc', '#' + NATIONS[e.nation].color.toString(16).padStart(6, '0'));
      d.innerHTML = '<small></small><b></b><span></span>';
      d.querySelector('small')!.textContent = title;
      d.querySelector('b')!.textContent = `${NATIONS[e.nation].emblem}${state.humanNames[id] ?? nameOf(id)}${e.isPlayer ? '（あなた）' : ''}`;
      d.querySelector('span')!.textContent = `${roleName(e.role)}・${detail}`;
      return d;
    };
    const end = elapsedSec(state);
    const cards = [
      best((id) => people[id].capturesMade, (id, v) => card('TRACE MASTER', id, `${v}人をTRACE`)),
      best((id) => this.rescues.get(id) ?? 0, (id, v) => card('救援のスペシャリスト', id, `${v}人を解放`)),
      best((id) => people[id].kingCaptures * 10 + people[id].kingHits, (id) => card('ANCHOR HUNTER', id, `ANCHORへの攻撃${people[id].kingHits}回・ANCHOR LOCK ${people[id].kingCaptures}回`)),
      best((id) => (people[id].alive && !this.firstJailed.has(id) && people[id].role !== 'king' ? 1 + people[id].capturesMade * 0.01 : 0), (id) => card('無傷の生還', id, `${Math.round(end)}秒間一度もLOCKされなかった`)),
    ].filter((c): c is HTMLDivElement => !!c);
    if (cards.length) {
      const h = document.createElement('h3');
      h.textContent = 'この試合の活躍';
      const row = document.createElement('div');
      row.className = 'mvps';
      row.append(...cards);
      box.append(h, row);
    }
    // Timeline.
    const h = document.createElement('h3');
    h.textContent = '試合の流れ（開始からの経過時間）';
    const list = document.createElement('ol');
    list.className = 'timeline';
    const shown = this.entries.slice(-40);
    for (const en of shown) {
      const li = document.createElement('li');
      li.className = `${en.kind}${en.mine ? ' mine' : ''}`;
      const m = Math.floor(en.t / 60), s = Math.floor(en.t % 60);
      li.innerHTML = '<time></time><span></span>';
      li.querySelector('time')!.textContent = `${m}:${String(s).padStart(2, '0')}`;
      li.querySelector('span')!.textContent = en.text;
      list.append(li);
    }
    if (!shown.length) { const li = document.createElement('li'); li.textContent = '大きな出来事はなかった'; list.append(li); }
    const note = document.createElement('p');
    note.className = 'tl-note';
    note.textContent = this.otherCaps ? `ほかに他勢力同士のTRACEが${this.otherCaps}件あった。` : '';
    box.append(h, list, note);
    // Nations at the end.
    const tally = document.createElement('p');
    tally.className = 'tl-note';
    tally.textContent = NATION_IDS.map((n) => {
      const all = people.filter((e) => e.nation === n);
      const free = all.filter((e) => e.alive && !e.jailed).length, dead = all.filter((e) => !e.alive).length;
      return `${NATIONS[n].name}：残り${free}人・離脱${dead}人`;
    }).join('　');
    box.append(tally);
    return box;
  }
}
