import type { EventBus } from '../core/events';
import { NATIONS } from '../config/nations';
import { TOWER } from '../config/map';
import { teleport } from '../sim/entity';
import type { GameEvent } from '../sim/events';
import type { GameState } from '../sim/state';
import { kingOf } from '../sim/state';
import { sendToJail } from '../sim/systems/jail';
import { nearTowerBase } from '../sim/systems/towerZone';
import { CENTRAL, POINT_R, sectorPoint } from '../sim/war';
import { groundAt } from '../sim/systems/world';
import { navGraph } from '../ai/nav';
import type { Hud } from './hud';
import { $ } from './dom';

/** A step: what to show, what to set up on entering, and when it is done (checked every frame). */
interface Step {
  title: string;
  text: string;
  /** The instruction in one line, for the folded card. */
  short?: string;
  enter?: () => void;
  done?: () => boolean;
  /** Steps that are only explanation move on with a button. */
  manual?: boolean;
}

export interface TutorialExits {
  title(): void;
  play(): void;
}

/**
 * チュートリアル: ten short hands-on steps on the real map, using the real systems.
 * The CPUs stand still (state.tutorial), the player cannot be captured (state.practice),
 * and there is no time limit, meeting, event, night or execution.
 */
export class TutorialGuide {
  private steps: Step[];
  private i = -1;
  private card = $('tutorialCard');
  private moved = 0;
  private lastPos = { x: 0, z: 0 };
  private turned = 0;
  private lastYaw = 0;
  private dashed = false;
  private captured = false;
  private rescued = false;
  private sectorTaken = false;
  private towerTaken = false;
  private target: { x: number; y: number; z: number } | null = null;
  private stepAt = 0;
  /** Opened again by a tap: stays open for this step. */
  private pinned = false;
  /** Where the player was when the step began (the card folds once they move). */
  private stepFrom = { x: 0, z: 0 };

  constructor(bus: EventBus<GameEvent>, private state: GameState, private hud: Hud, private exits: TutorialExits) {
    const p = state.player;
    const moon = state.entities.find((e) => e.nation !== p.nation && e.role === 'communicator') ?? state.entities.find((e) => e.nation !== p.nation && e.role !== 'king')!;
    const pal = state.entities.find((e) => e.nation === p.nation && !e.isPlayer && e.role !== 'king')!;
    const enemyNation = moon.nation;
    // An open square west of the tower (皇居外苑): clear ground all round for the first steps.
    const plaza = { x: 142, z: 801 };
    bus.on('CAPTURE', (ev) => { if (ev.attackerId === p.id) this.captured = true; });
    bus.on('RESCUED', (ev) => { if (ev.rescuerId === p.id) this.rescued = true; });
    bus.on('SECTOR_CAPTURED', (ev) => { if (ev.nation === p.nation) this.sectorTaken = true; });
    bus.on('TOWER_CAPTURED', (ev) => { if (ev.nation === p.nation) this.towerTaken = true; });
    const ahead = (d: number) => ({ x: p.x + p.dirX * d, z: p.z + p.dirZ * d });
    const mark = (x: number, z: number, y?: number) => { this.target = { x, y: y ?? groundAt(x, z, 40), z }; };
    const isMobile = matchMedia('(pointer: coarse)').matches;
    const key = (pc: string, phone: string) => (isMobile ? phone : pc);

    this.steps = [
      {
        title: '移動してみよう',
        short: key('↑ で前進', 'スティックを上に倒して前進'),
        text: key('↑ で前進、↓ で後退。少し歩いてみよう。', '左下のスティックを上に倒すと前進。少し歩いてみよう。'),
        enter: () => { this.moved = 0; this.lastPos = { x: p.x, z: p.z }; },
        done: () => this.moved > 140,
      },
      {
        title: '向きを変えよう',
        short: key('← → で旋回 ／ Q で振り向き', 'スティック左右で旋回 ／「振向」'),
        text: key('← → で旋回。Q を押すと一瞬で真後ろを向ける（背中は見えないので時々振り向こう）。', 'スティックを左右に倒して旋回。「振向」で一瞬で真後ろを向ける。'),
        enter: () => { this.turned = 0; this.lastYaw = Math.atan2(p.dirX, p.dirZ); },
        done: () => this.turned > 2.6,
      },
      {
        title: 'ダッシュで目的地へ',
        short: key('⚑ まで Shift で走る', '⚑ まで「ダッシュ」で走る'),
        text: key('⚑ マーカーまで Shift を押しながら走ろう。ダッシュ中は足音が大きく、スタミナを使う。', '⚑ マーカーまで「ダッシュ」を押しながら走ろう。ダッシュ中は足音が大きく、スタミナを使う。'),
        enter: () => { this.dashed = false; const a = ahead(380); mark(a.x, a.z); },
        done: () => this.near(60) && this.dashed,
      },
      {
        title: '敵を背後から捕まえる',
        short: key('背中側に回って Space', '背中側に回って「捕獲」'),
        text: key(`目の前に${NATIONS[enemyNation].name}国の兵がいる（練習用・動かない）。背中側に回り込み、足元の輪が緑のうちに Space。正面からは捕まえられない。`,
          `目の前に${NATIONS[enemyNation].name}国の兵がいる（練習用・動かない）。背中側に回り込み、足元の輪が緑のうちに「捕獲」。正面からは捕まえられない。`),
        enter: () => {
          this.captured = false;
          const a = ahead(170);
          teleport(moon, a.x, a.z);
          // Facing the player: you have to go round the back.
          const dx = p.x - moon.x, dz = p.z - moon.z, l = Math.hypot(dx, dz) || 1;
          moon.dirX = dx / l; moon.dirZ = dz / l;
          this.target = null;
        },
        done: () => this.captured,
      },
      {
        title: '牢屋',
        text: `捕まえた敵は${NATIONS[p.nation].name}国の牢屋へ送られた。牢屋に入れられた人は一定時間（王は80秒・ほかは50秒）が経つと処刑され、試合から外れる。処刑される前なら、仲間が牢屋まで来て救出できる。敵国の王を捕まえて処刑すれば、その国は負け。`,
        manual: true,
      },
      {
        title: '仲間を救出する（鍵使い）',
        short: key('牢屋の仲間のそばで Z（離れない）', '牢屋の仲間のそばで「特殊」（離れない）'),
        text: key('味方が敵国の牢屋に捕まっている。あなたは鍵使い。牢屋の仲間のそばで Z を押し、鍵を開け終わるまで離れずに待とう。', '味方が敵国の牢屋に捕まっている。あなたは鍵使い。牢屋の仲間のそばで「特殊」を押し、鍵を開け終わるまで離れずに待とう。'),
        enter: () => {
          this.rescued = false;
          sendToJail(state, pal, enemyNation, null);
          const jail = NATIONS[enemyNation].jail;
          const at = openSpot(pal.x, pal.z + jail.d / 2 + 90);
          teleport(p, at.x, at.z);
          this.faceTo(pal.x, pal.z);
          mark(pal.x, pal.z, pal.y);
        },
        done: () => this.rescued,
      },
      {
        title: '王を守れ',
        short: '♛ の王のそばへ行く',
        text: '各国に1人ずつ王がいる。自国の王が捕まって処刑されると負け。王は正面からでも捕まえられる「スーパーハンド」と救出の力を持つ。♛ の王のそばまで行ってみよう。敵国の王は正体を隠している。',
        enter: () => {
          const k = kingOf(state, p.nation)!;
          const at = openSpot(k.x + 200, k.z + 60);
          teleport(p, at.x, at.z);
          this.faceTo(k.x, k.z);
          mark(k.x, k.z, k.y);
        },
        done: () => { const k = kingOf(state, p.nation)!; return Math.hypot(k.x - p.x, k.z - p.z) < 90; },
      },
      {
        title: '戦区と拠点',
        short: '拠点の輪に立ち続けて制圧',
        text: '東京は9つの戦区に分かれている。紋章マーカーが戦区の拠点。輪の中に立ち続けると制圧ゲージがたまり、その戦区を自国のものにできる。敵と一緒に立つと止まる。前線（ミニマップの境目）で三国がぶつかる。',
        enter: () => {
          this.sectorTaken = false;
          const q = sectorPoint(CENTRAL);
          state.war.sectors[CENTRAL].owner = null;
          state.war.sectors[CENTRAL].progress = 0;
          const at = openSpot(q.x - POINT_R - 120, q.z);
          teleport(p, at.x, at.z);
          this.faceTo(q.x, q.z);
          this.target = null;
        },
        done: () => this.sectorTaken,
      },
      {
        title: '管制塔を取る',
        short: '管制塔の足元に立ち続けて占領',
        text: key('中央の管制塔の足元に立ち続けると占領できる。塔を持つ国はレーダーで敵の位置がわかり、試合の最後の3分の1では B で敵国の王を光の柱で照らせる。', '中央の管制塔の足元に立ち続けると占領できる。塔を持つ国はレーダーで敵の位置がわかり、試合の最後の3分の1では「王を照らす」で敵国の王を光の柱で照らせる。'),
        enter: () => {
          this.towerTaken = false;
          state.tower.owner = null;
          for (const n of Object.keys(state.tower.channel) as (keyof typeof state.tower.channel)[]) state.tower.channel[n] = 0;
          if (nearTowerBase(p, 60)) { const at = openSpot(TOWER.x - 300, TOWER.z); teleport(p, at.x, at.z); }
          this.faceTo(TOWER.x, TOWER.z);
          mark(TOWER.x, TOWER.z);
        },
        done: () => this.towerTaken,
      },
      {
        title: '準備完了！',
        text: '基本はこれで全部。本番では敵も動き、捕まえに来る。仲間と合図（1〜4 / 「合図」）で連携し、敵国の王を探し出そう。',
      },
    ];
    // Start on the open plaza by the tower, out of everyone's way.
    teleport(p, plaza.x, plaza.z);
    this.faceTo(plaza.x + 900, plaza.z);
    hud.banner('チュートリアル：あなたは捕まらない。CPUは止まっている', 2600);
    this.card.hidden = false;
    // Tap the folded card to read the whole step again (buttons keep working as usual).
    this.card.onclick = (ev) => {
      if ((ev.target as HTMLElement).closest('button')) return;
      if (this.card.classList.contains('final')) return;
      this.card.classList.toggle('compact');
      this.pinned = !this.card.classList.contains('compact');
    };
    document.body.classList.add('tutorial');
    this.go(0);
  }

  private near(r: number): boolean {
    const t = this.target, p = this.state.player;
    return !!t && Math.hypot(t.x - p.x, t.z - p.z) < r;
  }

  private faceTo(x: number, z: number): void {
    const p = this.state.player, dx = x - p.x, dz = z - p.z, l = Math.hypot(dx, dz) || 1;
    p.dirX = dx / l; p.dirZ = dz / l;
    this.onFace?.(p.dirX, p.dirZ);
  }

  /** Lets the camera snap round when the tutorial turns the player. */
  onFace: ((dx: number, dz: number) => void) | null = null;

  private go(i: number): void {
    this.i = i;
    const st = this.steps[i];
    this.stepAt = this.state.time;
    st.enter?.();
    this.stepFrom = { x: this.state.player.x, z: this.state.player.z };
    this.card.classList.remove('compact');
    this.pinned = false;
    $('tutShort').textContent = st.short ?? '';
    $('tutProgress').textContent = `チュートリアル ${i + 1} / ${this.steps.length}`;
    $('tutTitle').textContent = st.title;
    $('tutText').textContent = st.text;
    const acts = $('tutActions');
    acts.replaceChildren();
    const btn = (label: string, cls: string, f: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = cls;
      b.onclick = f;
      acts.append(b);
      return b;
    };
    if (i === this.steps.length - 1) {
      this.card.classList.add('final');
      btn('タイトルへ戻る', 'pickbtn', () => this.exits.title());
      btn('そのままプレイする', 'go', () => this.exits.play());
      return;
    }
    this.card.classList.remove('final');
    if (st.manual) btn('次へ', 'go', () => this.advance());
    else {
      const s = document.createElement('span');
      s.className = 'tut-wait';
      s.textContent = 'やってみよう';
      acts.append(s);
      btn('スキップ', 'pickbtn tut-skip', () => this.advance());
    }
  }

  private advance(): void {
    if (this.i < this.steps.length - 1) {
      this.hud.banner('OK！', 700);
      this.go(this.i + 1);
    }
  }

  /** Called every frame. */
  sync(): void {
    const s = this.state, p = s.player;
    this.moved += Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.lastPos = { x: p.x, z: p.z };
    const yaw = Math.atan2(p.dirX, p.dirZ);
    let d = yaw - this.lastYaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.turned += Math.abs(d);
    this.lastYaw = yaw;
    if (s.input.dash && Math.hypot(p.x - p.prevX, p.z - p.prevZ) > 0) this.dashed = true;
    // The marker for the current goal is a ping of your own nation (refreshed so it never runs out).
    s.pings = s.pings.filter((q) => q.id !== -1);
    if (this.target) s.pings.push({ id: -1, nation: p.nation, by: p.id, kind: this.i === 6 ? 'king' : 'gather', ...this.target, t: s.time });
    const st = this.steps[this.i];
    // Out of the way once the player gets going (or after a few seconds): just the title and one line.
    if (st && !st.manual && st.short && !this.pinned && !this.card.classList.contains('compact')
      && (Math.hypot(p.x - this.stepFrom.x, p.z - this.stepFrom.z) > 30 || s.input.turn !== 0 || s.time - this.stepAt > 4500)) {
      this.card.classList.add('compact');
    }
    if (st?.done && s.time - this.stepAt > 400 && st.done()) this.advance();
  }

  /** For checks: which step is showing. */
  get step(): number { return this.i; }
}

/** The walkable ground spot nearest to (x, z). */
function openSpot(x: number, z: number): { x: number; z: number } {
  let best = { x, z }, bd = Infinity;
  for (const n of navGraph().nodes) {
    if (!n.reachable || n.y > 5) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) { bd = d; best = { x: n.x, z: n.z }; }
  }
  return best;
}
