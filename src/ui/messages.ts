import { NATIONS } from '../config/nations';
import { roleName } from '../config/roles';
import type { EventBus } from '../core/events';
import type { GameEvent } from '../sim/events';
import type { GameState } from '../sim/state';
import { entityById } from '../sim/state';
import type { NationId } from '../config/nations';
import { CENTRAL, SECTORS } from '../sim/war';
import { visibleTo } from '../sim/systems/vision';
import type { Hud } from './hud';
import type { LogPanel } from './log';

/** Turns simulation events into v6's log lines and banners. */
export function bindMessages(bus: EventBus<GameEvent>, state: GameState, log: LogPanel, hud: Hud): void {
  const N = (n: keyof typeof NATIONS) => NATIONS[n].name;
  const ent = (id: number) => entityById(state, id)!;

  bus.on('CAPTURE_FAILED', (ev) => log.add(ev.reason === 'side' ? '側面からの捕獲は不安定だった…' : 'わずかに逃れられた！'));
  bus.on('KING_DODGED', (ev) => log.add(N(ev.nation) + 'の王が回避した！'));
  bus.on('SOLDIER_ENDURED', (ev) => log.add(N(ev.nation) + 'の兵士が耐えた(残り' + ev.hp + ')'));
  bus.on('JAILED', (ev) => {
    const e = ent(ev.entityId);
    log.add(N(ev.capNation) + 'が' + N(e.nation) + 'の' + roleName(e.role) + 'を捕獲！');
  });
  bus.on('NATION_FALLEN', (ev) => {
    log.add(`${N(ev.nation)}国の王が処刑され、${N(ev.nation)}国は敗北。国の全員が処刑された。`);
    hud.banner(N(ev.nation) + '国 滅亡', 2600);
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
      case 'sniper_stun':
        log.add(n + 'の狙撃手が' + N(ent(ev.targetId!).nation) + 'を狙撃、スタン！');
        if (e.isPlayer) hud.banner('命中！', 900);
        else if (ev.targetId === state.player.id) hud.banner('狙撃された！', 1200);
        break;
      case 'sniper_miss': if (e.isPlayer) log.add('狙撃手：照準内に敵がいない（前方±30°・射程内・射線が必要）'); break;
      case 'radar_outside_tower': log.add('通信士：管制塔内でZを押してください。'); break;
      case 'radar': log.add(n + 'の通信士がレーダーを展開！'); break;
      case 'sprint': if (e.isPlayer) hud.banner('疾走！', 900); break;
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
  bus.on('SQUAD_ORDER', (ev) => {
    if (ev.leaderId !== state.player.id) return;
    const text = { follow: '分隊：付いてこい', spread: '分隊：周りを警戒しろ', hold: '分隊：ここを守れ' }[ev.order];
    log.add(text);
    hud.banner(text.replace('分隊：', ''), 1100);
  });
  // The war for Tokyo: only turns of the war are announced.
  const S = (i: number) => SECTORS[i].name + '戦区';
  const mine = (n: NationId | null) => n === state.player.nation;
  const intel = () => state.tower.owner === state.player.nation && state.entities.some((e) => e.nation === state.player.nation && e.role === 'communicator' && e.alive && !e.jailed);
  bus.on('SECTOR_CAPTURED', (ev) => {
    const text = ev.from ? `${N(ev.nation)}国が${S(ev.sector)}を${N(ev.from)}国から奪取！` : `${N(ev.nation)}国が${S(ev.sector)}を制圧`;
    log.add('【戦況】' + text);
    if (mine(ev.nation) || mine(ev.from) || ev.sector === CENTRAL) hud.banner(text, 1800);
  });
  bus.on('SECTOR_ATTACKED', (ev) => { if (mine(ev.owner)) log.add(`【戦況】${S(ev.sector)}が${N(ev.by)}国に攻め込まれている！`); });
  bus.on('SECTOR_CONTESTED', (ev) => {
    if (ev.sector === CENTRAL && ev.nations.length === 3) { log.add('【戦況】中央戦区が三国の激戦状態！'); hud.banner('中央戦区 激戦', 1500); }
    else log.add(`【戦況】${S(ev.sector)}で${ev.nations.map((n) => N(n)).join('・')}が拠点を奪い合っている`);
  });
  bus.on('SECTOR_BATTLE', (ev) => log.add(`【戦況】${S(ev.sector)}で戦闘発生（${ev.nations.map((n) => N(n)).join('対')}）`));
  const PLAN: Record<string, string> = {
    ATTACK_SECTOR: 'へ侵攻', DEFEND_SECTOR: 'を防衛', TAKE_TOWER: '管制塔を奪いに行く', HUNT_KING: '敵の王を捜索', RESCUE_KING: '王の救出作戦',
    HOLD_KING: '捕らえた王の牢屋を守る', OPPORTUNIST: '漁夫の利を狙う', RECOVER: '態勢を立て直す',
  };
  bus.on('STRATEGY', (ev) => {
    const what = ev.sector !== null && (ev.kind === 'ATTACK_SECTOR' || ev.kind === 'DEFEND_SECTOR') ? S(ev.sector) + PLAN[ev.kind] : PLAN[ev.kind] ?? ev.kind;
    if (mine(ev.nation)) log.add('【作戦】自国の方針: ' + what);
    else if (intel() && (ev.kind === 'ATTACK_SECTOR' || ev.kind === 'RESCUE_KING')) log.add(`【通信】${N(ev.nation)}国の動き: ${what}`);
  });
  bus.on('TRUCE_PROPOSED', (ev) => { if (!mine(ev.to)) log.add(`【外交】${N(ev.from)}国が${N(ev.to)}国に一時停戦を持ちかけた`); });
  bus.on('TRUCE_STARTED', (ev) => {
    const text = `${N(ev.a)}国と${N(ev.b)}国が${ev.sec}秒間の一時停戦`;
    log.add('【外交】' + text + '（互いに捕獲しない）');
    hud.banner(text, 2000);
  });
  bus.on('TRUCE_DECLINED', (ev) => log.add(`【外交】${N(ev.to)}国は${N(ev.from)}国の停戦の申し出を断った`));
  bus.on('TRUCE_ENDED', (ev) => log.add(`【外交】停戦終了。${N(ev.a)}国と${N(ev.b)}国は再び敵同士`));
  bus.on('KING_CAPTURED', (ev) => log.add(`【戦況】${N(ev.nation)}国王の牢屋の位置が全勢力に知れ渡った`));
  bus.on('MEETING_CLOSED', (ev) => log.add('会議終了。' + (ev.focusSet ? '重点捜索対象を設定した。' : '次の情報を待とう。')));
}
