import { NATIONS, NATION_IDS } from '../config/nations';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { elapsedSec } from '../sim/state';
import { GAME_TIME, MEETINGS_PER_GAME } from '../config/constants';
import { nationScore, scoreBreakdown } from '../sim/systems/winCondition';
import { $ } from './dom';
import type { Recap } from './recap';
import { recordLine, recordMatch } from './records';

function roleComment(p: Entity): string {
  if (p.role === 'king') return p.alive ? '最後まで正体を隠し切った策士' : '見破られてしまったようだ';
  if (p.role === 'soldier') return p.capturesMade >= 3 ? '前線突破型の武闘派' : '手堅く連携するサポート型';
  if (p.role === 'sniper') return p.capturesMade >= 2 ? '狙撃の名手' : '支援に徹した堅実プレイ';
  if (p.role === 'communicator') return p.towerTime >= 25 ? '情報戦を制した要' : '塔の確保に苦労した様子';
  if (p.role === 'keyholder') return p.rescuesMade >= 2 ? '救出のスペシャリスト' : '慎重な立ち回りだった';
  return '潜入と攪乱で戦況をかき乱した詐欺師';
}

export function initResultView(): void {
  $('btnRetry').onclick = () => location.reload();
}

let recorded = false;

export function showResult(state: GameState, recap?: Recap): void {
  const p = state.player, winner = state.winner;
  if (recap) $('ovRecap').replaceChildren(recap.render());
  if (!recorded) {
    recorded = true;
    $('ovRecord').textContent = recordLine(recordMatch(p.role, p.nation, winner, p.capturesMade, p.rescuesMade), p.role);
  }
  $('overlay').style.display = 'flex';
  const timeUp = elapsedSec(state) >= GAME_TIME - 0.5;
  const kings = NATION_IDS.filter((n) => state.entities.some((e) => e.nation === n && e.role === 'king' && e.alive));
  if (winner === 'draw' || !winner) {
    $('ovTitle').textContent = '引き分け';
    $('ovDesc').textContent = timeUp ? '時間切れ。戦功ポイントが同点だった。' : '全ての王が処刑された。';
  } else {
    $('ovTitle').textContent = NATIONS[winner].name + '国の勝利！';
    $('ovDesc').textContent = (winner === p.nation ? 'あなたの国が勝利しました！' : 'あなたの国は敗北しました。')
      + (timeUp && kings.length > 1 ? '（時間切れ・戦功ポイントで判定）' : '');
  }
  // Time-up between several kingdoms: show how the score was made up.
  const scores = timeUp && kings.length > 1
    ? kings.map((n) => `${NATIONS[n].name} ${nationScore(state, n)}点（` + scoreBreakdown(state, n).filter((b) => b.pts).map((b) => `${b.label}${b.pts > 0 ? '+' : ''}${b.pts}`).join(' ') + '）').join('\n') + '\n\n'
    : '';
  const survive = p.eliminatedAt != null ? p.eliminatedAt : elapsedSec(state);
  $('ovStats').textContent = scores +
    '捕獲数:' + p.capturesMade + '　救出数:' + p.rescuesMade + '　王への攻撃:' + p.kingHits +
    '\n王の捕獲貢献:' + p.kingCaptures + '　王の救出貢献:' + p.kingRescues +
    '\n管制塔滞在:' + Math.round(p.towerTime) + '秒　敵発見数:' + p.enemiesSeen.size +
    '\nダッシュ距離:' + Math.round(p.dashDistance) + '　生存時間:' + Math.round(survive) + '秒　会議:' + state.meetingsHeld + '回（うち緊急' + (MEETINGS_PER_GAME - p.meetingsLeft) + '回）' +
    '\n評価: ' + roleComment(p);
}
