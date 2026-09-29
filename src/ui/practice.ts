import type { EventBus } from '../core/events';
import { NATIONS } from '../config/nations';
import { roleName } from '../config/roles';
import type { GameEvent } from '../sim/events';
import type { GameState } from '../sim/state';
import { canRescue } from '../sim/systems/rescue';
import { nearTowerBase } from '../sim/systems/towerZone';
import { POINT_R, SECTORS, sectorPoint } from '../sim/war';
import type { Hud } from './hud';
import { $ } from './dom';

interface Step { id: string; label: string; how: string; done: boolean }

/**
 * 練習モード: a normal match where you cannot be captured, with a checklist of the
 * basics that ticks itself off as you do them.
 */
export class PracticeGuide {
  private steps: Step[];
  private box = document.createElement('div');
  private finished = false;

  constructor(bus: EventBus<GameEvent>, private state: GameState, private hud: Hud) {
    const p = state.player;
    const rescuer = canRescue(state, p);
    this.steps = [
      { id: 'capture', label: '敵を背後から捕まえる', how: '敵の背中側に回り込み、足元の輪が緑のうちに Space（スマホは「捕獲」）', done: false },
      { id: 'face', label: '振り向いて背後を確認する', how: 'Q（スマホは「振向」）。背中は見えないので時々振り向こう', done: false },
      { id: 'squad', label: '分隊に指示を出す', how: 'X 付いてこい / C 周りを警戒 / V ここを守れ（スマホは「分隊」）', done: false },
      { id: 'ping', label: '味方に合図を出す', how: '1 王・2 助けて・3 集合・4 敵多数（スマホは「合図」）', done: false },
      { id: 'point', label: '戦略拠点に立つ', how: '画面の紋章マーカーへ。輪の中に立ち続けると制圧できる', done: false },
      { id: 'tower', label: '管制塔の足元に行く', how: 'マップ中央の日比谷公園。塔を持つと終盤に敵の王を照らせる（B）', done: false },
      rescuer
        ? { id: 'rescue', label: '牢屋の仲間を救出する', how: '仲間がひとり敵の牢屋にいる。牢屋のそばで Z', done: false }
        : { id: 'special', label: `${roleName(p.role)}の特殊を使う`, how: 'Z（スマホは「特殊」）。内容は右パネルの下に出ている', done: false },
    ];
    const done = (id: string) => this.tick(id);
    bus.on('CAPTURE', (ev) => { if (ev.attackerId === p.id) done('capture'); });
    bus.on('SQUAD_ORDER', (ev) => { if (ev.leaderId === p.id) done('squad'); });
    bus.on('PING', (ev) => { if (ev.by === p.id) done('ping'); });
    bus.on('RESCUED', (ev) => { if (ev.rescuerId === p.id) done('rescue'); });
    bus.on('ABILITY', (ev) => { if (ev.entityId === p.id) done('special'); });
    this.box.id = 'practice';
    $('centerCol').append(this.box);
    this.render();
    hud.banner(`練習モード：あなたは捕まらない。${NATIONS[p.nation].name}の${roleName(p.role)}で基本を試そう`, 3200);
  }

  /** Checks the things that are places rather than events (called every frame). */
  sync(): void {
    const s = this.state, p = s.player;
    if (s.playerFaceTarget) this.tick('face');
    if (nearTowerBase(p, 40)) this.tick('tower');
    for (let i = 0; i < SECTORS.length; i++) {
      const q = sectorPoint(i);
      if (Math.hypot(q.x - p.x, q.z - p.z) < POINT_R && Math.abs(q.y - p.y) < 60) { this.tick('point'); break; }
    }
  }

  private tick(id: string): void {
    const st = this.steps.find((x) => x.id === id);
    if (!st || st.done) return;
    st.done = true;
    this.render();
    if (!this.finished && this.steps.every((x) => x.done)) {
      this.finished = true;
      this.hud.banner('練習完了！ 本番の試合に挑もう', 3000);
    }
  }

  private render(): void {
    const left = this.steps.filter((x) => !x.done).length;
    const next = this.steps.find((x) => !x.done);
    this.box.innerHTML = '';
    const h = document.createElement('b');
    h.textContent = `練習モード（残り${left}）`;
    const ul = document.createElement('ul');
    for (const st of this.steps) {
      const li = document.createElement('li');
      li.className = st.done ? 'done' : st === next ? 'next' : '';
      li.textContent = (st.done ? '✔ ' : '・') + st.label;
      if (st === next) {
        const how = document.createElement('small');
        how.textContent = st.how;
        li.append(how);
      }
      ul.append(li);
    }
    this.box.append(h, ul);
  }
}
