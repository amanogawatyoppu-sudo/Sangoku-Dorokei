import { NATIONS, nationCss } from '../config/nations';
import { JAIL_TIME, KING_JAIL_EXTRA } from '../config/constants';
import { FACTIONS } from '../config/terminology';
import { roleName } from '../config/roles';
import { nameOf } from '../config/names';
import { PING_LABEL } from '../sim/ping';
import type { EventBus } from '../core/events';
import type { GameEvent } from '../sim/events';
import type { GameState } from '../sim/state';
import { entityById } from '../sim/state';
import type { NationId } from '../config/nations';
import { CENTRAL, SECTORS } from '../sim/war';
import type { Hud } from './hud';
import type { LogPanel } from './log';

/** Turns simulation events into v6's log lines and banners. */
export function bindMessages(bus: EventBus<GameEvent>, state: GameState, log: LogPanel, hud: Hud): void {
  const N = (n: keyof typeof NATIONS) => NATIONS[n].name;
  const ent = (id: number) => entityById(state, id)!;

  bus.on('CAPTURE_FAILED', (ev) => log.add(ev.reason === 'practice' ? '練習モード：TRACEされそうになった（本番ならLOCKされていた）' : ev.reason === 'side' ? '側面からのTRACEは不安定だった…' : 'わずかに逃れられた！'));
  bus.on('KING_DODGED', (ev) => log.add(N(ev.nation) + 'のANCHORがTRACEを回避した！'));
  bus.on('SOLDIER_ENDURED', (ev) => log.add(N(ev.nation) + 'のVANGUARDが耐えた(残り' + ev.hp + ')'));
  /** "LUNA：動けるのは4人（LOCK2・離脱1）" for a faction. */
  const tally = (n: NationId) => {
    const all = state.entities.filter((o) => o.nation === n);
    const free = all.filter((o) => o.alive && !o.jailed).length, jailed = all.filter((o) => o.alive && o.jailed).length;
    return `${N(n)}：動けるのは${free}人（LOCK${jailed}・離脱${all.length - free - jailed}）`;
  };
  const who = (id: number) => { const e = ent(id); return `${nameOf(e.id)}（${roleName(e.role)}）`; };
  const mineN = (n: NationId) => n === state.player.nation;
  bus.on('JAILED', (ev) => {
    const e = ent(ev.entityId);
    const text = `【LOCK】${N(e.nation)}の${who(e.id)}が${N(ev.capNation)}にTRACEされ、LOCK POINTへ拘束された！ ${tally(e.nation)}`;
    log.add(text);
    hud.addCasualty(text, 'cap', mineN(e.nation));
    if (e.isPlayer) hud.banner(`${N(ev.capNation)}にTRACEされた！ LOCK POINTで解放を待て`, 2200);
    else if (mineN(e.nation) && e.role !== 'king') hud.toast(`${nameOf(e.id)}（${roleName(e.role)}）が${N(ev.capNation)}にLOCKされた！`, 'cap');
  });
  bus.on('NATION_FALLEN', (ev) => {
    log.add(`【LINK SEVERED】${N(ev.nation)}のANCHORのリンクが切断された。${FACTIONS[ev.nation].ja}のネットワークは失われ、全員が戦線離脱。`);
    hud.eventCard({ kicker: N(ev.nation), title: 'NETWORK LOST', sub: `${FACTIONS[ev.nation].ja}のネットワークが切断された — 戦線離脱`, tone: 'lost', color: nationCss(ev.nation) }, 3600);
  });
  bus.on('KING_CAPTURED', (ev) => hud.eventCard({
    kicker: N(ev.nation) + ' ANCHOR', title: 'ANCHOR LOCKED', sub: `${FACTIONS[ev.nation].ja}のANCHOR、LOCK POINTへ拘束`,
    note: `LINK SEVERまで ${Math.round((JAIL_TIME + KING_JAIL_EXTRA) / 1000)}`, tone: 'lock', color: nationCss(ev.nation),
  }, 3600));
  bus.on('ELIMINATED', (ev) => {
    const e = ent(ev.entityId);
    const text = `【離脱】${N(e.nation)}の${who(e.id)}の拘束時間が尽き、戦線離脱… ${tally(e.nation)}`;
    log.add(text);
    hud.addCasualty(text, 'exec', mineN(e.nation));
    if (mineN(e.nation) && !e.isPlayer) hud.toast(`${nameOf(e.id)}（${roleName(e.role)}）が戦線離脱…`, 'exec');
  });
  bus.on('RESCUE_NO_TARGET', (ev) => { if (ent(ev.rescuerId).isPlayer) log.add('解除：近くのLOCK POINTに仲間がいません（拘束された仲間のすぐそばでZ）。'); });
  bus.on('LAST_STAND', (ev) => {
    const e = ent(ev.entityId);
    const text = `【解放】${N(e.nation)}で動けるのは${who(e.id)}だけになった。${e.role === 'keyholder' || e.role === 'king' ? '' : '解除能力を得た！'}`;
    log.add(text);
    hud.addCasualty(text, 'rescue', mineN(e.nation));
    if (e.isPlayer) hud.banner('最後の一人！ 解除能力を得た — LOCK POINTの仲間のそばでZ', 3200);
    else if (mineN(e.nation)) hud.toast(`${nameOf(e.id)}が最後の一人。解除能力を得た`, 'rescue');
  });
  bus.on('RESCUE_STARTED', (ev) => { if (ent(ev.targetId).role === 'king') hud.banner('ANCHOR解放作戦 開始', 1500); });
  bus.on('RESCUE_FAILED', () => hud.banner('解除失敗！', 1400));
  bus.on('RESCUED', (ev) => {
    const t = ent(ev.targetId);
    const text = `【解放】${N(t.nation)}の${who(ev.rescuerId)}が${who(t.id)}の拘束を解除！ ${tally(t.nation)}`;
    log.add(text);
    hud.addCasualty(text, 'rescue', mineN(t.nation));
    if (mineN(t.nation) && !t.isPlayer) hud.toast(`${nameOf(ev.rescuerId)}が${nameOf(t.id)}を解放！`, 'rescue');
    if (t.isPlayer) hud.banner(`${nameOf(ev.rescuerId)}に解放された！`, 2000);
  });
  bus.on('PING', (ev) => {
    const p = state.pings.find((q) => q.id === ev.pingId);
    if (!p || p.nation !== state.player.nation) return;
    const who = ent(ev.by);
    const name = who.isPlayer ? 'あなた' : state.humanNames[who.id] ?? nameOf(who.id);
    log.add(`【合図】${name}：${PING_LABEL[ev.kind]}`);
    if (!who.isPlayer) hud.toast(`${name}：${PING_LABEL[ev.kind]}`, ev.kind === 'king' ? 'rescue' : 'cap');
  });
  bus.on('DECOY', (ev) => {
    if (!mineN(ent(ev.kingId).nation)) return;
    const d = ent(ev.doubleId);
    log.add(`【作戦】DECOY：${state.humanNames[d.id] ?? nameOf(d.id)}（${roleName(d.role)}）が30秒間、ANCHORの身代わりになる。護衛はDECOYに付き、敵の目もDECOYに向く`);
    hud.banner(`DECOY：${state.humanNames[d.id] ?? nameOf(d.id)}がANCHORの身代わりに（30秒）`, 2400);
  });
  bus.on('DECOY_FAILED', (ev) => { if (ent(ev.kingId).isPlayer) log.add('DECOY：近く（約30m以内）に身代わりになれる味方がいない。'); });
  bus.on('NIGHTFALL', () => {
    log.add('【夜】日が沈んできた。遠くが見えにくくなる — 街灯の光の下にいる人だけは遠くからでも見える');
    hud.banner('日が沈む — 街灯の下は目立つ', 2400);
  });
  bus.on('BEACON_PHASE', () => {
    log.add('【管制塔】残り時間が3分の1を切った。管制塔を持つ勢力は敵勢力のANCHORの位置を照らせる（B / 上部の「ANCHOR SCAN」）');
    hud.banner(state.tower.owner === state.player.nation ? '管制塔：ANCHOR SCANが使えるようになった！（B）' : '終盤戦 — 管制塔を取れば敵のANCHORを照らせる', 2600);
  });
  bus.on('KING_BEACON', (ev) => {
    if (mineN(ev.nation)) {
      hud.banner(`ANCHOR SCAN：敵勢力のANCHORを照らした（${Math.round(ev.untilMs / 1000)}秒）`, 2400);
      log.add(`【管制塔】敵勢力のANCHORの位置が${Math.round(ev.untilMs / 1000)}秒間、光の柱で見える！`);
    } else {
      log.add(`【管制塔】${N(ev.nation)}がANCHOR SCANを実行！ ${N(state.player.nation)}のANCHORの居場所がばれている`);
      if (state.entities.some((k) => k.role === 'king' && k.nation === state.player.nation && k.alive && !k.jailed)) hud.toast(`${N(ev.nation)}に自勢力のANCHORの位置を照らされた！`, 'cap');
    }
  });
  bus.on('KING_RESCUED', (ev) => hud.eventCard({ kicker: N(ev.nation) + ' ANCHOR', title: 'ANCHOR RELEASED', sub: `${FACTIONS[ev.nation].ja}のANCHORが解放された`, tone: 'release', color: nationCss(ev.nation) }, 2800));
  bus.on('ABILITY', (ev) => {
    const e = ent(ev.entityId);
    const n = N(e.nation);
    switch (ev.result) {
      case 'king_dodge': log.add(n + 'のANCHORが回避を強化！'); break;
      case 'soldier_heal': log.add(n + 'のVANGUARDが耐久回復！'); break;
      case 'sniper_stun':
        log.add(n + 'のSPOTTERが' + N(ent(ev.targetId!).nation) + 'を狙撃、スタン！');
        if (e.isPlayer) hud.banner('命中！', 900);
        else if (ev.targetId === state.player.id) hud.banner('狙撃された！', 1200);
        break;
      case 'sniper_miss': if (e.isPlayer) log.add('SPOTTER：照準内に敵がいない（前方±30°・射程内・射線が必要）'); break;
      case 'radar_outside_tower': log.add('RELAY：管制塔内でZを押してください。'); break;
      case 'radar': log.add(n + 'のRELAYがレーダーを展開！'); break;
      case 'sprint': if (e.isPlayer) hud.banner('疾走！', 900); break;
    }
  });
  bus.on('TOWER_CAPTURED', (ev) => {
    log.add(N(ev.nation) + 'が管制塔を占領した！');
    hud.banner(N(ev.nation) + 'が管制塔を制圧！', 1600);
  });
  bus.on('RANDOM_EVENT', (ev) => {
    if (ev.kind === 'speed') log.add('【イベント】全員の移動速度が上昇！');
    else if (ev.kind === 'jailbreak') log.add('【イベント】LOCK POINTの拘束が一斉解除された！(' + ev.count + '人)');
    else log.add('【イベント】敵位置情報が流出！全員の位置が一時的に見える');
  });
  bus.on('MEETING_DENIED', (ev) => log.add(ev.reason === 'none_left' ? '緊急会議の残り回数がありません。' : '自勢力の拠点(会議端末)に近づいてください。'));
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
    const text = ev.from ? `${N(ev.nation)}が${S(ev.sector)}を${N(ev.from)}から奪取！` : `${N(ev.nation)}が${S(ev.sector)}を制圧`;
    log.add('【戦況】' + text);
    if (mine(ev.nation) || mine(ev.from) || ev.sector === CENTRAL) hud.banner(text, 1800);
  });
  bus.on('SECTOR_ATTACKED', (ev) => { if (mine(ev.owner)) log.add(`【戦況】${S(ev.sector)}が${N(ev.by)}に攻め込まれている！`); });
  bus.on('SECTOR_CONTESTED', (ev) => {
    if (ev.sector === CENTRAL && ev.nations.length === 3) { log.add('【戦況】中央戦区が3勢力の激戦状態！'); hud.banner('中央戦区 激戦', 1500); }
    else log.add(`【戦況】${S(ev.sector)}で${ev.nations.map((n) => N(n)).join('・')}が拠点を奪い合っている`);
  });
  bus.on('SECTOR_BATTLE', (ev) => log.add(`【戦況】${S(ev.sector)}で戦闘発生（${ev.nations.map((n) => N(n)).join('対')}）`));
  const PLAN: Record<string, string> = {
    ATTACK_SECTOR: 'へ侵攻', DEFEND_SECTOR: 'を防衛', TAKE_TOWER: '管制塔を奪いに行く', HUNT_KING: '敵のANCHORを捜索', RESCUE_KING: 'ANCHOR解放作戦',
    HOLD_KING: 'LOCKした敵ANCHORのLOCK POINTを守る', OPPORTUNIST: '漁夫の利を狙う', RECOVER: '態勢を立て直す',
    ALL_OUT: '解除できる者がいない。敵のANCHORへ総攻撃', HOLD_LEAD: 'リードを守りきる',
  };
  bus.on('STRATEGY', (ev) => {
    const what = ev.sector !== null && (ev.kind === 'ATTACK_SECTOR' || ev.kind === 'DEFEND_SECTOR') ? S(ev.sector) + PLAN[ev.kind] : PLAN[ev.kind] ?? ev.kind;
    if (mine(ev.nation)) log.add(`【作戦】${N(state.player.nation)} 作戦方針: ` + what);
    else if (intel() && (ev.kind === 'ATTACK_SECTOR' || ev.kind === 'RESCUE_KING')) log.add(`【通信】${N(ev.nation)}の動き: ${what}`);
  });
  bus.on('TRUCE_PROPOSED', (ev) => { if (!mine(ev.to)) log.add(`【TRUCE】${N(ev.from)}が${N(ev.to)}に一時停戦を持ちかけた`); });
  bus.on('TRUCE_STARTED', (ev) => {
    const text = `${N(ev.a)}と${N(ev.b)}が${ev.sec}秒間のTRUCEを締結`;
    log.add('【TRUCE】' + text + '（一時停戦：互いにTRACEしない）');
    hud.banner(text, 2000);
  });
  bus.on('TRUCE_DECLINED', (ev) => log.add(`【TRUCE】${N(ev.to)}は${N(ev.from)}の一時停戦の申し出を断った`));
  bus.on('TRUCE_ENDED', (ev) => log.add(`【TRUCE】一時停戦終了。${N(ev.a)}と${N(ev.b)}は再び敵同士`));
  bus.on('KING_CAPTURED', (ev) => log.add(`【戦況】${N(ev.nation)}のANCHORが拘束されたLOCK POINTの位置が全勢力に知れ渡った`));
  bus.on('TARGET_SET', (ev) => {
    if (!mineN(ev.nation)) return;
    const t = ent(ev.targetId);
    const name = state.humanNames[t.id] ?? nameOf(t.id);
    log.add(`【作戦】次の標的：${N(t.nation)}の${name}。見つけたら背後を取ってTRACEしよう（60秒間、味方が優先して追う）`);
    hud.banner(`次の標的：${N(t.nation)}の${name}`, 2600);
  });
  bus.on('GAME_OVER', (ev) => {
    if (ev.winner === 'draw') hud.eventCard({ kicker: 'TRI//TRACE', title: 'DRAW', sub: '引き分け — どの勢力もネットワークを守りきれなかった', tone: 'lost' }, 3000);
    else hud.eventCard({ kicker: `${N(ev.winner)} VICTORY`, title: 'NETWORK SECURED', sub: `${FACTIONS[ev.winner].ja}の勝利`, tone: 'win', color: nationCss(ev.winner) }, 3000);
  });
  bus.on('MEETING_CLOSED', (ev) => log.add('会議終了。' + (ev.focusSet ? '重点捜索対象を設定した。' : '次の情報を待とう。')));
}
