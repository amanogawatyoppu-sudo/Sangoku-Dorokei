import { NATIONS } from '../config/nations';
import { roleName } from '../config/roles';
import type { EventBus } from '../core/events';
import type { GameEvent } from '../sim/events';
import type { GameState } from '../sim/state';
import { entityById } from '../sim/state';
import { visibleTo } from '../sim/systems/vision';
import type { Hud } from './hud';
import type { LogPanel } from './log';

/** Turns simulation events into v6's log lines and banners. */
export function bindMessages(bus: EventBus<GameEvent>, state: GameState, log: LogPanel, hud: Hud): void {
  const N = (n: keyof typeof NATIONS) => NATIONS[n].name;
  const ent = (id: number) => entityById(state, id)!;

  bus.on('CAPTURE_FAILED', (ev) => log.add(ev.reason === 'side' ? '側面からの捕獲は不安定だった…' : 'わずかに逃れられた！'));
  bus.on('IMPOSTOR_EXPOSED', (ev) => log.add(N(ev.nation) + 'の詐欺師の正体が露見！'));
  bus.on('KING_DODGED', (ev) => log.add(N(ev.nation) + 'の王が回避した！'));
  bus.on('SOLDIER_ENDURED', (ev) => log.add(N(ev.nation) + 'の兵士が耐えた(残り' + ev.hp + ')'));
  bus.on('JAILED', (ev) => {
    const e = ent(ev.entityId);
    log.add(N(ev.capNation) + 'が' + N(e.nation) + 'の' + roleName(e.role) + 'を捕獲！');
  });
  bus.on('KING_CAPTURED', (ev) => hud.banner(N(ev.nation) + '国王、捕縛！', 2600));
  bus.on('ELIMINATED', (ev) => {
    const e = ent(ev.entityId);
    log.add(N(e.nation) + 'の' + roleName(e.role) + 'は処刑された…');
  });
  bus.on('RESCUE_NO_TARGET', () => log.add('鍵使い：近くに救出対象がいません。'));
  bus.on('RESCUE_STARTED', (ev) => { if (ent(ev.targetId).role === 'king') hud.banner('王救出作戦開始', 1500); });
  bus.on('RESCUE_FAILED', () => hud.banner('救出失敗！', 1400));
  bus.on('RESCUED', (ev) => {
    const t = ent(ev.targetId);
    log.add(N(t.nation) + 'の' + roleName(t.role) + 'が救出された！');
  });
  bus.on('KING_RESCUED', (ev) => hud.banner(N(ev.nation) + '国王、救出成功！', 2400));
  bus.on('ABILITY', (ev) => {
    const e = ent(ev.entityId);
    const n = N(e.nation);
    switch (ev.result) {
      case 'king_dodge': log.add(n + 'の王が回避を強化！'); break;
      case 'soldier_heal': log.add(n + 'の兵士が耐久回復！'); break;
      case 'sniper_stun': log.add(n + 'の狙撃手が' + N(ent(ev.targetId!).nation) + 'をスタン！'); break;
      case 'sniper_miss': log.add('狙撃手：射線が通らず外れた'); break;
      case 'radar_outside_tower': log.add('通信士：管制塔内でEを押してください。'); break;
      case 'radar': log.add(n + 'の通信士がレーダーを展開！'); break;
      case 'disguise': log.add(n + 'の詐欺師が偽装を開始。'); break;
    }
  });
  bus.on('TOWER_CAPTURED', (ev) => {
    log.add(N(ev.nation) + 'が管制塔を占領した！');
    hud.banner(N(ev.nation) + 'が管制塔を制圧！', 1600);
  });
  bus.on('RANDOM_EVENT', (ev) => {
    if (ev.kind === 'speed') log.add('【イベント】全員の移動速度が上昇！');
    else if (ev.kind === 'jailbreak') log.add('【イベント】牢屋が緊急開放された！(' + ev.count + '人)');
    else log.add('【イベント】敵位置情報が流出！全員の位置が一時的に見える');
  });
  bus.on('EVIDENCE', (ev) => {
    const e = ent(ev.entityId);
    if (e.nation !== state.player.nation && visibleTo(state, e, state.player)) {
      log.add('【推理】' + N(e.nation) + '方面の何者かが「' + ev.text + '」');
    }
  });
  bus.on('MEETING_DENIED', (ev) => log.add(ev.reason === 'none_left' ? '緊急会議の残り回数がありません。' : '自国拠点(会議端末)に近づいてください。'));
  bus.on('MEETING_SOON', (ev) => {
    log.add(`まもなくハーフタイム会議（${ev.inSec}秒後）。全員が集まり、戦況を共有する。`);
    hud.banner(`${ev.inSec}秒後にハーフタイム会議`, 2500);
  });
  bus.on('MEETING_CLOSED', (ev) => log.add('会議終了。' + (ev.focusSet ? '重点捜索対象を設定した。' : '次の情報を待とう。')));
}
