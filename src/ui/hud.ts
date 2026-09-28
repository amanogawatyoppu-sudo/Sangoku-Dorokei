import { NATIONS, NATION_IDS, nationCss } from '../config/nations';
import { roleName } from '../config/roles';
import { nameOf } from '../config/names';
import { CAP_RANGE, GAME_TIME } from '../config/constants';
import { CAPTURE_CD } from '../config/roles';
import { beep } from '../audio/sfx';
import { jailedAlly } from '../ai/controller';
import type { GameState } from '../sim/state';
import { kingOf, timeLeftSec } from '../sim/state';
import type { CaptureTier } from '../sim/systems/capture';
import { captureCandidate, captureTier, superHand } from '../sim/systems/capture';
import { jailDuration } from '../sim/systems/jail';
import { dist } from '../sim/systems/collision';
import { canRescue, rescueTargetNear } from '../sim/systems/rescue';
import { canLightKings } from '../sim/systems/tower';
import { sniperTarget } from '../sim/systems/abilities';
import { visibleTo } from '../sim/systems/vision';
import { SECTORS, held, sectorOf } from '../sim/war';
import type { NationId } from '../config/nations';
import { $ } from './dom';

/** v6 UI cooldown scale for the special button fill (keyholder uses 1 in v6). */
const SPECIAL_FILL_SCALE = { king: 15, soldier: 18, sniper: 8, keyholder: 1, communicator: 10, ranger: 16 } as const;
const SPECIAL_DESC = {
  king: '回避を強化（捕獲はスーパーハンド：正面からでも確実）。牢屋の仲間のそばでZ＝救出',
  soldier: '耐久を全回復',
  sniper: '照準（前方±30°・射程20m・高所から+25%）の敵を狙撃→3秒スタン。赤い線が出たら命中',
  keyholder: '牢屋の味方の近くでZ(王は詠唱長め・進捗表示あり)',
  communicator: '管制塔内でレーダー展開',
  ranger: '疾走: 4.5秒間 速さ×1.3・スタミナ回復アップ（再使用16秒）',
} as const;

/** Which part of the target the player is on; matches the capture success rules. */
const TIER_LABEL: Record<CaptureTier | 'super', string> = {
  deepback: '真後ろ（確実）',
  back: '背後（高確率）',
  side: '側面（不安定）',
  front: '正面（不可）',
  super: 'スーパーハンド（どこからでも確実）',
};

/** Top bar, side panel, hint line, vignette, banner and rescue progress. */
export class Hud {
  private el = {
    tbNation: $('tbNation'), tbRole: $('tbRole'), tbKing: $('tbKing'), tbJailed: $('tbJailed'),
    tbTower: $('tbTower'), tbTime: $('tbTime'), tbMeet: $('tbMeet'), btnMeeting: $('btnMeeting') as HTMLButtonElement, mtLeft: $('mtLeft'),
    fillCap: $('fillCap'), fillSpec: $('fillSpec'), btnSpecial: $('btnSpecial') as HTMLButtonElement, specialDesc: $('specialDesc'),
    stamBar: $('stamBar'), hintText: $('hintText'), roster: $('roster'), casualties: $('casualties'), vignette: $('vignette'),
    rescueBadge: $('rescueBadge'), toasts: $('toasts'), btnBeacon: $('btnBeacon') as HTMLButtonElement,
    banner: $('banner'), progText: $('progText'),
    btnCapture: $('btnCapture'), mCap: $('mCap'), mSpec: $('mSpec') as HTMLButtonElement, mFace: $('mFace') as HTMLButtonElement,
    mDash: $('mDash'), mStam: $('mStam'), statusBadge: $('statusBadge'),
  };
  /** Game time at which each enemy became continuously visible (danger hint). */
  private visSince = new Map<number, number>();
  private tier3Alerted = false;

  initFor(state: GameState): void {
    const p = state.player;
    this.el.tbNation.textContent = NATIONS[p.nation].name;
    this.el.tbRole.textContent = roleName(p.role);
    const id = $('tbId'), crest = $('tbCrest');
    crest.textContent = NATIONS[p.nation].emblem;
    id.style.setProperty('--nc', nationCss(p.nation));
  }

  banner(text: string, ms = 1800): void {
    const b = this.el.banner;
    b.textContent = text;
    b.style.opacity = '1';
    setTimeout(() => { if (b.textContent === text) b.style.opacity = '0'; }, ms);
  }

  private squadAt = 0;

  /** Squad panel: each member's role and what they are doing; the current order is highlighted. */
  private updateSquad(state: GameState): void {
    const now = performance.now();
    if (now - this.squadAt < 250) return;
    this.squadAt = now;
    const p = state.player;
    const members = state.entities.filter((e) => e.ai.leaderId === p.id);
    const STATUS: Record<string, string> = {
      SQUAD: '同行', CHASE: '追跡中', INTERCEPT: '回り込み', SEARCH: '捜索中', INVESTIGATE: '確認中', GUARD: '守備', HOLD: '狙撃待機', FLEE: '退避',
    };
    const list = $('squadList');
    list.replaceChildren(...(members.length ? members : []).map((e) => {
      const d = document.createElement('div');
      d.className = 'squad-member';
      const st = e.jailed ? '牢屋' : !e.alive ? '脱落' : e.stunUntil > state.time ? 'スタン' : STATUS[e.ai.state] ?? '行動中';
      d.textContent = `${nameOf(e.id)}（${roleName(e.role)}）${st}　${Math.round(Math.hypot(e.x - p.x, e.z - p.z) / 26)}m`;
      if (st === '追跡中' || st === '回り込み') d.classList.add('hot');
      return d;
    }));
    if (!members.length) list.textContent = !p.alive ? '（処刑済み）' : p.jailed ? '（あなたが牢屋にいる間は各自で行動）' : '（仲間を集めています…）';
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#squadBox [data-order]'))) b.classList.toggle('sel', b.dataset.order === state.squadOrder);
    const m = document.querySelector('#mSquad small');
    if (m) m.textContent = { follow: '付いて', spread: '警戒', hold: '守れ' }[state.squadOrder];
  }

  private sectorId = -1;
  private sectorShownAt = new Map<number, number>();

  /** Entering a sector: its name, holder and what fighting there is like (once in a while). */
  private updateSector(state: GameState): void {
    const p = state.player;
    if (!p.alive) return;
    const here = sectorOf(state, p);
    if (here.id === this.sectorId) return;
    const first = this.sectorId < 0;
    this.sectorId = here.id;
    const now = performance.now();
    if (first || now - (this.sectorShownAt.get(here.id) ?? -Infinity) < 60000) return;
    this.sectorShownAt.set(here.id, now);
    const who = here.owner ? (here.owner === p.nation ? '自国領' : NATIONS[here.owner].name + '国領') : '中立';
    this.banner(`${SECTORS[here.id].name}戦区（${who}）— ${SECTORS[here.id].style}`, 2200);
  }

  private warAt = 0;

  /** The war strip: each kingdom's sectors (☀3 ☾2 ★2), who holds the tower, any ceasefire. */
  private updateWar(state: GameState): void {
    const now = performance.now();
    if (now - this.warAt < 300) return;
    this.warAt = now;
    for (const chip of Array.from(document.querySelectorAll<HTMLElement>('#tbWar .wchip'))) {
      const n = chip.dataset.n as NationId;
      chip.style.setProperty('--nc', nationCss(n));
      const alive = state.entities.some((e) => e.nation === n && e.role === 'king' && e.alive);
      const text = `${NATIONS[n].emblem}${held(state, n).length}${state.tower.owner === n ? '・塔' : ''}`;
      if (chip.textContent !== text) chip.textContent = text;
      chip.classList.toggle('fallen', !alive);
      chip.classList.toggle('mine', n === state.player.nation);
    }
    const truce = state.war.truces.find((t) => t.until > state.time);
    const tr = $('tbTruce');
    tr.hidden = !truce;
    if (truce) tr.textContent = `停戦 ${NATIONS[truce.a].emblem}${NATIONS[truce.b].emblem} ${Math.ceil((truce.until - state.time) / 1000)}秒`;
  }

  update(state: GameState): void {
    this.updateSquad(state);
    this.updateSector(state);
    this.updateWar(state);
    const p = state.player, el = this.el;
    const left = timeLeftSec(state);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    el.tbTime.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    const toMeet = (state.nextMeetingAt - state.time) / 1000;
    el.tbMeet.textContent = Number.isFinite(toMeet) && left - toMeet > 15 ? `会議まで ${Math.floor(toMeet / 60)}:${String(Math.ceil(toMeet % 60) % 60).padStart(2, '0')}` : '';
    el.tbMeet.classList.toggle('soon', toMeet <= 10);
    el.tbTower.textContent = state.tower.owner ? NATIONS[state.tower.owner].emblem + NATIONS[state.tower.owner].name : '―';
    const myKing = kingOf(state, p.nation)!;
    el.tbKing.textContent = !myKing.alive ? '処刑済み' : myKing.jailed ? '捕縛中！' : '生存';
    el.tbKing.parentElement!.className = 'tb-stat' + (!myKing.alive ? ' dead' : myKing.jailed ? ' alert' : '');
    el.tbTime.classList.toggle('low', left <= 60);
    el.tbJailed.textContent = String(state.entities.filter((e) => e.nation === p.nation && e.jailed).length);
    el.mtLeft.textContent = String(p.meetingsLeft);
    el.btnMeeting.disabled = p.meetingsLeft <= 0;
    el.fillCap.style.width = p.cd.capture <= 0 ? '0%' : (p.cd.capture / CAPTURE_CD) * 100 + '%';
    el.btnSpecial.disabled = p.cd.special > 0;
    el.fillSpec.style.width = Math.min(100, (p.cd.special / SPECIAL_FILL_SCALE[p.role]) * 100) + '%';
    el.specialDesc.textContent = SPECIAL_DESC[p.role];
    el.stamBar.style.width = p.stamina + '%';
    this.updateControlFeedback(state);
    el.hintText.textContent = this.computeHint(state);
    this.updateRoster(state);
    this.updateRescue(state);
    this.updateBeacon(state);
    if (p.channeling) {
      el.progText.style.opacity = '1';
      el.progText.textContent = '救出詠唱 [' + Math.round((p.channeling.prog / p.channeling.need) * 100) + '%]';
    } else el.progText.style.opacity = '0';
  }

  /** Dash / special / capture-ready states on the buttons, plus the status badge. */
  private updateControlFeedback(state: GameState): void {
    const p = state.player, el = this.el;
    const canAct = p.alive && !p.jailed && !state.meeting && !state.over;
    el.stamBar.classList.toggle('dashing', p.dashing);
    el.mStam.style.width = p.stamina + '%';
    el.mStam.classList.toggle('dashing', p.dashing);
    el.mDash.classList.toggle('on', p.dashing);
    el.mSpec.disabled = p.cd.special > 0 || !canAct;
    el.mFace.disabled = !canAct;
    const target = canAct && p.stunUntil <= state.time ? captureCandidate(state, p) : null;
    const ready = !!target && p.cd.capture <= 0;
    el.btnCapture.classList.toggle('ready', ready);
    el.mCap.classList.toggle('ready', ready);
    this.setStatus(this.statusFor(state, target ? (superHand(p) ? 'super' : captureTier(target, p)) : null));
  }

  private statusFor(state: GameState, tier: CaptureTier | 'super' | null): { text: string; kind: string } | null {
    const p = state.player, now = state.time;
    if (!p.alive) return { text: '処刑済み — 幽霊で観戦中', kind: 'jail' };
    if (p.jailed) {
      const left = Math.max(0, Math.ceil((p.jailedAt + jailDuration(p) - now) / 1000));
      return { text: '牢屋に捕縛中 — 処刑まで ' + left + '秒', kind: 'jail' };
    }
    if (p.stunUntil > now) return { text: 'スタン中 ' + ((p.stunUntil - now) / 1000).toFixed(1) + '秒', kind: 'stun' };
    if (p.channeling) return null; // progText shows the rescue
    if (tier) return { text: '捕獲可能: ' + TIER_LABEL[tier] + (p.cd.capture > 0 ? '（準備中）' : ''), kind: 'capture' };
    return null;
  }

  private statusKey = '';
  private setStatus(s: { text: string; kind: string } | null): void {
    const key = s ? s.kind + s.text : '';
    if (key === this.statusKey) return;
    this.statusKey = key;
    const b = this.el.statusBadge;
    b.hidden = !s;
    if (s) {
      b.textContent = s.text;
      b.className = s.kind;
    }
  }

  private rosterKey = '';

  /** How many of each nation are free, in a jail, executed (dots: filled = free). */
  private updateRoster(state: GameState): void {
    const rows = NATION_IDS.map((n) => {
      const all = state.entities.filter((e) => e.nation === n);
      const free = all.filter((e) => e.alive && !e.jailed).length, jailed = all.filter((e) => e.alive && e.jailed).length;
      return { n, free, jailed, dead: all.length - free - jailed };
    });
    const key = rows.map((r) => `${r.free}.${r.jailed}.${r.dead}`).join('|');
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    this.el.roster.replaceChildren(...rows.map((r) => {
      const d = document.createElement('div');
      d.className = 'rs-row' + (r.n === state.player.nation ? ' mine' : '') + (r.free === 0 ? ' out' : '');
      d.style.setProperty('--nc', nationCss(r.n));
      const name = document.createElement('span');
      name.className = 'rs-name';
      name.textContent = NATIONS[r.n].emblem + NATIONS[r.n].name;
      const dots = document.createElement('span');
      dots.className = 'rs-dots';
      dots.innerHTML = '<i class="f"></i>'.repeat(r.free) + '<i class="j"></i>'.repeat(r.jailed) + '<i class="d"></i>'.repeat(r.dead);
      const num = document.createElement('span');
      num.className = 'rs-num';
      num.textContent = `${r.free}人` + (r.jailed ? `・牢${r.jailed}` : '') + (r.dead ? `・処刑${r.dead}` : '');
      d.append(name, dots, num);
      return d;
    }));
  }

  /** A line in the side panel's capture / rescue / execution list (newest first, 8 kept). */
  addCasualty(text: string, kind: 'cap' | 'exec' | 'rescue', mine: boolean): void {
    const box = this.el.casualties;
    box.querySelector('.cz-none')?.remove();
    const d = document.createElement('div');
    d.className = `cz ${kind}` + (mine ? ' mine' : '');
    d.textContent = text.replace(/^【[^】]*】/, '');
    box.prepend(d);
    while (box.children.length > 8) box.lastElementChild!.remove();
  }

  /** A short notice on the play screen for news about your own nation (fades after a few seconds). */
  toast(text: string, kind: 'cap' | 'exec' | 'rescue'): void {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = (kind === 'cap' ? '⛓ ' : kind === 'exec' ? '✖ ' : '🔑 ') + text;
    this.el.toasts.prepend(d);
    while (this.el.toasts.children.length > 3) this.el.toasts.lastElementChild!.remove();
    setTimeout(() => d.classList.add('out'), 4200);
    setTimeout(() => d.remove(), 4800);
  }

  /** Always on screen when you can open jails (king, last one standing, keyholder); lights up next to a jailed ally. */
  private updateRescue(state: GameState): void {
    const p = state.player, b = this.el.rescueBadge;
    const can = p.alive && !p.jailed && canRescue(state, p);
    if (!can) { b.hidden = true; return; }
    const target = rescueTargetNear(state, p);
    const why = p.role === 'keyholder' ? '鍵使い' : p.role === 'king' ? '王の特権' : '最後の一人';
    b.hidden = false;
    b.className = target ? 'ready' : '';
    b.textContent = target ? `🔑 Zで${nameOf(target.id)}を救出！` : `🔑 救出能力あり（${why}）— 牢屋の仲間のそばでZ`;
    if (p.role !== 'keyholder') {
      const label = target ? '救出' : '特殊';
      if (this.el.mSpec.textContent !== label) this.el.mSpec.textContent = label;
    }
  }

  /** The tower's "light the kings" button: shown to the holder; usable in the last third. */
  private updateBeacon(state: GameState): void {
    const p = state.player, btn = this.el.btnBeacon;
    const holder = state.tower.owner === p.nation && !state.over && state.entities.some((e) => e.nation === p.nation && e.alive && !e.jailed);
    btn.hidden = !holder;
    if (!holder) return;
    const lit = state.kingBeacon[p.nation] > state.time;
    const until = timeLeftSec(state) - GAME_TIME / 3;
    btn.disabled = !canLightKings(state, p.nation);
    btn.classList.toggle('lit', lit);
    btn.textContent = lit ? `照射中 ${Math.ceil((state.kingBeacon[p.nation] - state.time) / 1000)}s`
      : until > 0 ? `王を照らす（あと${Math.floor(until / 60)}:${String(Math.floor(until % 60)).padStart(2, '0')}）`
        : state.time < state.beaconReadyAt[p.nation] ? `王を照らす（${Math.ceil((state.beaconReadyAt[p.nation] - state.time) / 1000)}s）` : '王を照らす(B)';
  }

  private computeHint(state: GameState): string {
    const p = state.player, now = state.time;
    if (!p.alive) return '幽霊で観戦中：↑↓←→で自由に移動、Shiftで速く、Space上昇・Z下降';
    let danger = false;
    for (const e of state.entities) {
      if (e.nation !== p.nation && e.alive && !e.jailed && visibleTo(state, e, p)) {
        if (!this.visSince.has(e.id)) this.visSince.set(e.id, now);
      } else this.visSince.delete(e.id);
    }
    let tier = 0;
    for (const [id, since] of this.visSince) {
      const en = state.entities.find((x) => x.id === id);
      if (!en) continue;
      const el = now - since;
      const d = dist(en, p);
      const tt = d < 90 && el > 2200 ? 3 : el > 1100 ? 2 : 1;
      if (tt > tier) tier = tt;
      if (tt >= 2 && d < CAP_RANGE + 40 && (superHand(en) || captureTier(p, en) !== 'front')) danger = true;
    }
    this.el.vignette.classList.toggle('on', danger);
    // Snipers: someone drawing a bead on you (their red laser), or your own shot lined up.
    if (!p.jailed && state.entities.some((e) => e.role === 'sniper' && e.nation !== p.nation && e.alive && !e.jailed && e.ai.aimId === p.id && visibleTo(state, e, p))) {
      return '狙撃手に狙われている！赤い線から外れて物陰へ';
    }
    if (p.role === 'sniper' && !p.jailed) {
      const t = sniperTarget(state, p);
      if (t) {
        const m = Math.round(Math.hypot(t.x - p.x, t.z - p.z, t.y - p.y) / 26);
        return p.cd.special > 0.5
          ? `照準: ${NATIONS[t.nation].name}国・${m}m ― 装填中（あと${Math.ceil(p.cd.special)}秒）`
          : `照準: ${NATIONS[t.nation].name}国・${m}m ― Z / 特殊 で狙撃！`;
      }
    }
    if (tier === 3) {
      if (!this.tier3Alerted) { beep(880, 0.15); this.tier3Alerted = true; }
      return '敵に発見された！警戒せよ';
    }
    this.tier3Alerted = false;
    if (tier === 2) return '警戒！敵の気配が続いている';
    if (tier === 1) return '……？ 何かが視界の端に';
    const myKing = kingOf(state, p.nation)!;
    if (myKing.jailed) return '至急、味方と協力して王を救出しよう！';
    if (p.jailed) return '味方の鍵使いが助けに来るのを待とう';
    if (p.role === 'keyholder' && jailedAlly(state, p)) return '味方が牢屋にいる。救出を試みよう';
    if (p.role === 'communicator' && state.tower.owner !== p.nation) return '管制塔を確保しよう';
    if (state.entities.some((e) => e.nation === p.nation && e.jailed)) return '牢屋の味方を救出できないか探ろう';
    if (state.entities.some((e) => e.nation !== p.nation && e.alive && !e.jailed && visibleTo(state, e, p) && e.susp > 45)) {
      return '怪しい動きの敵がいる…王候補として警戒しよう';
    }
    return '広いマップを探索し、隙を探ろう';
  }
}

