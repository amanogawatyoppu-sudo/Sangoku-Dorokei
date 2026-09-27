import { NATIONS } from '../config/nations';
import { roleName } from '../config/roles';
import { CAP_RANGE } from '../config/constants';
import { CAPTURE_CD } from '../config/roles';
import { beep } from '../audio/sfx';
import { jailedAlly } from '../ai/controller';
import { compass } from '../meeting/meetingSystem';
import type { GameState } from '../sim/state';
import { kingOf, timeLeftSec } from '../sim/state';
import type { CaptureTier } from '../sim/systems/capture';
import { captureCandidate, captureTier } from '../sim/systems/capture';
import { jailDuration } from '../sim/systems/jail';
import { dist } from '../sim/systems/collision';
import { suspStars } from '../sim/systems/suspicion';
import { visibleTo } from '../sim/systems/vision';
import { $ } from './dom';

/** v6 UI cooldown scale for the special button fill (keyholder uses 1 in v6). */
const SPECIAL_FILL_SCALE = { king: 15, soldier: 18, sniper: 8, keyholder: 1, communicator: 10, impostor: 14 } as const;
const SPECIAL_DESC = {
  king: '回避を強化',
  soldier: '耐久を全回復',
  sniper: '前方の敵をスタン(射線必要)',
  keyholder: '牢屋の味方の近くでE(王は詠唱長め・進捗表示あり)',
  communicator: '管制塔内でレーダー展開',
  impostor: '他国に偽装(捕獲で解除)',
} as const;

/** Which part of the target the player is on; matches the capture success rules. */
const TIER_LABEL: Record<CaptureTier, string> = {
  deepback: '真後ろ（確実）',
  back: '背後（高確率）',
  side: '側面（不安定）',
  front: '正面（不可）',
};

/** Top bar, side panel, hint line, vignette, banner and rescue progress. */
export class Hud {
  private el = {
    tbNation: $('tbNation'), tbRole: $('tbRole'), tbKing: $('tbKing'), tbJailed: $('tbJailed'),
    tbTower: $('tbTower'), tbTime: $('tbTime'), tbMeet: $('tbMeet'), btnMeeting: $('btnMeeting') as HTMLButtonElement, mtLeft: $('mtLeft'),
    fillCap: $('fillCap'), fillSpec: $('fillSpec'), btnSpecial: $('btnSpecial') as HTMLButtonElement, specialDesc: $('specialDesc'),
    stamBar: $('stamBar'), hintText: $('hintText'), suspects: $('suspects'), vignette: $('vignette'),
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
  }

  banner(text: string, ms = 1800): void {
    const b = this.el.banner;
    b.textContent = text;
    b.style.opacity = '1';
    setTimeout(() => { if (b.textContent === text) b.style.opacity = '0'; }, ms);
  }

  update(state: GameState): void {
    const p = state.player, el = this.el;
    const left = timeLeftSec(state);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    el.tbTime.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    const toMeet = (state.nextMeetingAt - state.time) / 1000;
    el.tbMeet.textContent = Number.isFinite(toMeet) && left - toMeet > 15 ? `（ハーフタイム会議まで ${Math.floor(toMeet / 60)}:${String(Math.ceil(toMeet % 60) % 60).padStart(2, '0')}）` : '';
    el.tbMeet.classList.toggle('soon', toMeet <= 10);
    el.tbTower.textContent = state.tower.owner ? NATIONS[state.tower.owner].name + 'が占領中' : '未占領';
    const myKing = kingOf(state, p.nation)!;
    el.tbKing.textContent = !myKing.alive ? '処刑済み' : myKing.jailed ? '捕縛中！' : '生存';
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
    this.updateSuspects(state);
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
    this.setStatus(this.statusFor(state, target ? captureTier(target, p) : null));
  }

  private statusFor(state: GameState, tier: CaptureTier | null): { text: string; kind: string } | null {
    const p = state.player, now = state.time;
    if (!p.alive) return { text: '処刑済み — 観戦中', kind: 'jail' };
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

  private updateSuspects(state: GameState): void {
    const p = state.player;
    const susp = state.entities
      .filter((e) => e.nation !== p.nation && e.alive && !e.jailed && visibleTo(state, e, p) && e.susp > 15)
      .sort((a, b) => b.susp - a.susp)
      .slice(0, 3);
    const box = this.el.suspects;
    if (!susp.length) {
      box.innerHTML = '<div style="opacity:.5">まだ手がかりなし</div>';
      return;
    }
    box.replaceChildren(
      ...susp.map((e) => {
        const s = suspStars(e.susp);
        const stars = '★'.repeat(s) + '☆'.repeat(5 - s);
        const ev = e.evidence[0] ? '「' + e.evidence[0].text + '」' : '根拠はまだ薄い';
        const d = document.createElement('div');
        d.append(NATIONS[e.nation].name + '・' + compass(e.x - p.x, e.z - p.z) + ' ' + stars, document.createElement('br'), ev);
        return d;
      }),
    );
  }

  private computeHint(state: GameState): string {
    const p = state.player, now = state.time;
    if (!p.alive) return '観戦中…最後まで見届けよう';
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
      if (tt >= 2 && d < CAP_RANGE + 40 && captureTier(p, en) !== 'front') danger = true;
    }
    this.el.vignette.classList.toggle('on', danger);
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

