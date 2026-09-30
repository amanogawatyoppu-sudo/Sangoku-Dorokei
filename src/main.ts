import './style.css';
import type { NationId } from './config/nations';
import { NATIONS } from './config/nations';
import type { RoleId, RosterSize } from './config/roles';
import { roleName } from './config/roles';
import { FixedStepClock } from './core/clock';
import { EventBus } from './core/events';
import { startRafLoop } from './core/loop';
import { bindSfx } from './audio/sfx';
import { InputManager } from './input/inputManager';
import { closeMeeting, openMeeting, sayInMeeting, voteInMeeting } from './meeting/meetingSystem';
import { CameraController } from './render/cameraController';
import { EntityView, lerp } from './render/entityView';
import { Indicators } from './render/indicators';
import { Effects } from './render/effects';
import { buildScene, followSun, resizeRenderer, setNightfall, updateTrain } from './render/sceneBuilder';
import { nightFactor } from './sim/night';
import { navGraph } from './ai/nav';
import type { GameEvent } from './sim/events';
import { advanceFrame } from './sim/game';
import type { GameState } from './sim/state';
import { createGameState, drainEvents, queueCommand } from './sim/state';
import { teleport } from './sim/entity';
import { eliminate, sendToJail } from './sim/systems/jail';
import { solidAt } from './sim/systems/world';
import { $ } from './ui/dom';
import { initDrawers } from './ui/drawers';
import { Hud } from './ui/hud';
import { LogPanel } from './ui/log';
import { MeetingView } from './ui/meetingView';
import { bindMessages } from './ui/messages';
import { Minimap } from './ui/minimap';
import { initResultView, showResult } from './ui/resultView';
import { Recap } from './ui/recap';
import { TutorialGuide } from './ui/tutorial';
import { initLoading, withLoading } from './ui/loadingScreen';
import { initGuideScreen } from './ui/guideScreen';
import { CPU_LEVEL_NAME } from './ai/difficulty';
import type { AppScreen, Settings } from './ui/flow';
import { bootScreen, loadSettings, next, saveSettings, setIntent, takeIntent } from './ui/flow';
import type { CpuLevel } from './ai/difficulty';
import { loadRecords, recordLine } from './ui/records';
import { initSetupScreen } from './ui/setupScreen';
import type { OnlineStart } from './ui/onlineLobby';
import { initOnlineLobby } from './ui/onlineLobby';
import { ClientLink, HostLink, seatsOf } from './net/online';
import { NameTags } from './render/nameTags';
import { Ghost } from './render/ghost';
import { WarView } from './render/warView';
import { ObjectiveMarkers } from './ui/objectiveMarkers';
import { PingView } from './render/pingView';
import { PingMarkers } from './ui/pingMarkers';
import { Footprints } from './render/footprints';
import { Music } from './audio/music';
import { tensionOf } from './audio/tension';
import { SECTORS, TRUCE_MS, answerTruce, proposeTruce, sectorPoint, strength, trucesLeft } from './sim/war';
import { NATION_IDS } from './config/nations';
import { kingOf } from './sim/state';
import { createRng } from './core/rng';
import { STEP_MS, STEP_SEC } from './core/clock';
import { settleBody, updatePlayerMovement } from './sim/systems/movement';
import { updateEnemiesSeen } from './sim/systems/vision';

const canvas = $('game3d') as HTMLCanvasElement;
const refs = buildScene(canvas);
const hud = new Hud();
const log = new LogPanel();
const minimap = new Minimap();
const meetingView = new MeetingView();
/** Browser storage, if this browser allows it (private windows may not). */
const store = (k: 'localStorage' | 'sessionStorage'): Storage | null => { try { return window[k]; } catch { return null; } };
let settings: Settings = loadSettings(store('localStorage'));
let screen: AppScreen = 'TITLE';
/** Leaves this page for another screen: the 3D city is built once per page, so a new match is a fresh page. */
const goVia = (to: AppScreen) => {
  setIntent(store('sessionStorage'), to);
  document.body.classList.add('leaving');
  setTimeout(() => location.reload(), 160);
};
initResultView({
  retry: () => goVia(next('RESULT', { type: 'RETRY' }, settings).screen),
  settings: () => goVia(next('RESULT', { type: 'CHANGE_SETTINGS' }, settings).screen),
  title: () => goVia(next('RESULT', { type: 'TITLE' }, settings).screen),
});
$('recordLine').textContent = recordLine(loadRecords());
initDrawers(canvas);
initLoading();
const guide = initGuideScreen();
watchCanvasSize();

/** Single player, the host of an online match (runs the simulation), or a friend in one (mirrors it). */
type Mode =
  | { kind: 'solo' }
  | { kind: 'host'; start: OnlineStart }
  | { kind: 'client'; start: OnlineStart };

/** Music: starts with the first click or key (browsers keep audio off until then); ♪ mutes, remembered. */
const music = new Music();
try { music.muted = localStorage.getItem('sangoku.music') === 'off'; } catch { /* no storage */ }
const startMusic = () => music.start();
window.addEventListener('pointerdown', startMusic, { once: true });
window.addEventListener('keydown', startMusic, { once: true });
const musicBtn = $('btnMusic');
const showMusic = () => { musicBtn.textContent = music.muted ? '♪✕' : '♪'; musicBtn.title = music.muted ? '音楽をオンにする' : '音楽をオフにする'; };
showMusic();
musicBtn.onclick = () => {
  music.setMuted(!music.muted);
  try { localStorage.setItem('sangoku.music', music.muted ? 'off' : 'on'); } catch { /* no storage */ }
  showMusic();
};

/** Shows one screen of the flow (the match screens hide the title / settings). */
function showScreen(to: AppScreen): void {
  screen = to;
  document.body.dataset.screen = to;
  const menu = to === 'TITLE' || to === 'SETUP' || to === 'GUIDE';
  $('setup').style.display = menu ? '' : 'none';
  $('titleScreen').hidden = to !== 'TITLE';
  $('setupScreen').hidden = to !== 'SETUP';
  $('guideScreen').hidden = to !== 'GUIDE';
  if (to === 'GUIDE') guide.show();
  if (menu) {
    const shown = $(to === 'TITLE' ? 'titleScreen' : to === 'SETUP' ? 'setupScreen' : 'guideScreen');
    shown.classList.remove('enter');
    void shown.offsetWidth;
    shown.classList.add('enter');
    $('setup').scrollTop = 0;
  }
}

/** Starts a match (or the tutorial) behind the loading screen (作戦地域へ移動中…). */
function launch(nation: NationId, role: RoleId, size: RosterSize, mode: Mode = { kind: 'solo' }, opts: { cpu?: CpuLevel; tutorial?: boolean } = {}): void {
  const info = opts.tutorial ? 'チュートリアル ― 太陽国・鍵使い'
    : `${NATIONS[nation].name}国・${roleName(role)}　／　各国${size}人　／　` + (mode.kind === 'solo' ? `CPU：${CPU_LEVEL_NAME[opts.cpu ?? 'normal']}` : `対人戦（部屋 ${mode.start.lobby.code}）`);
  void withLoading({ label: opts.tutorial ? '訓練場へ移動中' : '作戦地域へ移動中', info }, () => startGame(nation, role, size, mode, opts));
}

function startGame(nation: NationId, role: RoleId, size: RosterSize, mode: Mode = { kind: 'solo' }, opts: { cpu?: CpuLevel; tutorial?: boolean } = {}): void {
  const online = mode.kind === 'solo' ? undefined : mode.start;
  showScreen(opts.tutorial ? 'TUTORIAL' : 'PLAYING');
  const state = online
    ? createGameState(nation, role, createRng(online.info.seed), size, { seats: seatsOf(online.info), me: online.me })
    : createGameState(nation, role, undefined, size);
  // Only the host (or a single player) runs the AI, so only its level counts.
  state.cpuLevel = opts.cpu ?? 'normal';
  if (opts.tutorial) state.tutorial = state.practice = true;
  const host = mode.kind === 'host' ? new HostLink(mode.start.lobby.room, mode.start.info, state.humans) : null;
  const client = mode.kind === 'client' ? new ClientLink(mode.start.lobby.room, mode.start.info.seats[0][0], performance.now()) : null;
  const names = new Map<number, string>(online ? online.info.seats.map((s, i) => [state.humans[i], s[3]]) : []);
  for (const [id, nick] of names) state.humanNames[id] = nick;
  const bus = new EventBus<GameEvent>();
  const cam = new CameraController();
  const entityView = new EntityView(refs.scene, state);
  const indicators = new Indicators(refs.scene);
  const effects = new Effects(refs.scene, entityView);
  const warView = new WarView(refs.scene);
  const objectives = new ObjectiveMarkers($('objMarkers'));
  const pingView = new PingView(refs.scene);
  const pingMarkers = new PingMarkers($('pingMarkers'));
  const footprints = new Footprints(refs.scene, $('pingMarkers'));
  const clock = new FixedStepClock();

  bindMessages(bus, state, log, hud);
  bindSfx(bus, state);
  const recap = new Recap(bus, state);
  bus.on('GAME_OVER', () => { if (!state.tutorial) showResult(state, recap); });
  bus.on('ELIMINATED', (ev) => { if (state.entities[ev.entityId].nation === state.player.nation) music.gong(); });
  bus.on('RESCUED', (ev) => { if (state.entities[ev.targetId].nation === state.player.nation) music.chime(); });
  bus.on('MEETING_OPENED', () => {
    meetingView.open(state, client ? {
      // Said and voted through the host, which answers with the teammates' replies.
      say: (c) => { const i = state.meeting?.choices.indexOf(c) ?? -1; if (i >= 0) client.sayChoice(state, i); },
      vote: (i) => {
        const m = state.meeting;
        if (!m || m.voted || !m.zones[i]) return;
        m.voted = true;
        client.voteFor(state, i);
      },
      close: () => { client.done(state); meetingView.hide(); log.add('会議の再開を待っています…'); },
    } : {
      say: (c) => sayInMeeting(state, c),
      vote: (i) => voteInMeeting(state, i),
      // Online, the host is one of the people: the meeting ends when everyone is done (or time runs out).
      close: host ? () => {
        if (state.meeting && !state.meeting.ready.includes(state.player.id)) state.meeting.ready.push(state.player.id);
        meetingView.hide();
        log.add('ほかの人の投票を待っています…');
      } : () => { closeMeeting(state); flush(); },
    });
  });
  bus.on('MEETING_CLOSED', () => meetingView.hide());
  bus.on('ABILITY', (ev) => { if (ev.result === 'sniper_stun' && ev.targetId !== undefined) effects.shot(state, ev.entityId, ev.targetId); });

  const flush = () => { for (const ev of drainEvents(state)) { host?.record(ev); bus.emit(ev); } };
  const input = new InputManager(canvas, {
    isBlocked: () => !!state.meeting || state.over,
    onCapture: () => { queueCommand(state, { type: 'capture' }); },
    onSpecial: () => { queueCommand(state, { type: 'special' }); },
    // Q / 振向: a quick half-turn to check behind (the camera follows the body round).
    onFace: () => { queueCommand(state, { type: 'face', x: -state.player.dirX, z: -state.player.dirZ }); },
    onSquad: (order) => {
      const cycle = ['follow', 'spread', 'hold'] as const;
      const next = order === 'next' ? cycle[(cycle.indexOf(state.squadOrder) + 1) % 3] : order;
      queueCommand(state, { type: 'squad', order: next });
    },
    onBeacon: () => { if (state.tower.owner === state.player.nation) queueCommand(state, { type: 'beacon' }); },
    onPing: (kind) => { queueCommand(state, { type: 'ping', kind }); },
    onDecoy: () => { if (state.player.role === 'king') queueCommand(state, { type: 'decoy' }); },
  });
  $('btnMeeting').onclick = () => { openMeeting(state); flush(); };
  $('btnBeacon').onclick = () => queueCommand(state, { type: 'beacon' });
  $('btnDecoy').onclick = () => queueCommand(state, { type: 'decoy' });
  // Ceasefire (一時停戦): offers to us wait for an answer; our own offer goes to the weaker of the other two.
  const truceBox = $('truceBox');
  bus.on('TRUCE_PROPOSED', (ev) => {
    if (ev.to !== state.player.nation || client) return;
    $('truceText').textContent = `${NATIONS[ev.from].name}国から提案：「${strongestOther(state, ev.from)}の勢いが強い。${TRUCE_MS / 1000}秒だけ停戦しないか？」（停戦中は互いに捕獲しない）`;
    truceBox.hidden = false;
  });
  $('truceYes').onclick = () => { answerTruce(state, true); truceBox.hidden = true; flush(); };
  $('truceNo').onclick = () => { answerTruce(state, false); truceBox.hidden = true; flush(); };
  const btnTruce = $('btnTruce') as HTMLButtonElement;
  if (client) btnTruce.style.display = 'none';
  btnTruce.onclick = () => {
    const me = state.player.nation;
    const others = NATION_IDS.filter((n) => n !== me && kingOf(state, n)?.alive).sort((a, b) => strength(state, a) - strength(state, b));
    if (others.length === 2 && proposeTruce(state, me, others[0])) flush();
  };
  if (online) $('btnMeeting').style.display = 'none'; // no emergency meetings online (the whole match would stop)

  hud.initFor(state);
  const tutorial = opts.tutorial ? new TutorialGuide(bus, state, hud, {
    title: () => goVia(next('TUTORIAL', { type: 'TITLE' }, settings).screen),
    play: () => goVia(next('TUTORIAL', { type: 'TUTORIAL_PLAY' }, settings).screen),
  }) : null;
  const me = state.player;
  if (online) {
    log.add(`オンライン対戦：部屋 ${online.lobby.code}・${online.info.seats.length}人。同じ国は味方、ほかの国は敵。`);
    if (host) log.add('あなたがホストです。このタブを閉じると試合が終わります。');
  } else if (tutorial) log.add('チュートリアル：CPUは止まっていて、あなたは捕まらない。上のカードの指示に従って操作してみよう。');
  else log.add('v7.24: 対人戦はブラウザだけで友達と遊べる（部屋コードを共有）。王は1回だけ影武者を立てられる（F）。走る敵の足跡・聞こえる足音の向き・BGM（♪でオンオフ）。試合が進むと夜になる（街灯の下は遠くからでも見える）。1〜4キー（スマホは「合図」）で味方に合図：王・助けて・集合・敵多数。王と「最後の一人」も救出できる（牢屋の仲間のそばでZ）。終盤は管制塔で敵の王を照らせる（B）。味方の頭上に名前と役職。東京は9つの戦区。画面の紋章マーカーが戦略拠点（輪が制圧ゲージ）、街の幟の色がその戦区の支配国。拠点に立ち続けると制圧。ミニマップに勢力と前線。↑↓で前後、←→で旋回、Shiftで加速、Spaceで捕獲、Zで特殊、Qで振り向き。分隊はX 付いてこい・C 周りを警戒・V ここを守れ。');
  if (!tutorial) hud.banner('三国ドロケイ 開始　' + NATIONS[me.nation].name + 'の' + roleName(me.role), 2200);
  const tags = new NameTags($('nametags'), state, names);
  resizeRenderer(refs, canvas);
  cam.snap(Math.atan2(state.player.dirX, state.player.dirZ));
  if (tutorial) tutorial.onFace = (dx, dz) => cam.snap(Math.atan2(dx, dz));
  if (new URLSearchParams(location.search).has('debug')) exposeDebug(state, cam, tutorial);

  /** The host's frame: friends' input in, simulation, snapshot out. */
  const simulate = (frameMs: number) => {
    const now = performance.now();
    if (host) {
      for (const id of host.ingest(state, now)) {
        state.entities[id].remote = false; // the AI takes over
        delete state.remotePose[id];
        log.add(`${names.get(id) ?? '誰か'}が退出しました（AIが引き継ぎます）`);
      }
    }
    advanceFrame(state, clock, frameMs);
    flush();
    host?.publish(state, now);
  };

  /** A friend's frame: the host's snapshot in, this character moved here, input out. */
  let hostGoneShown = false;
  const mirror = (frameMs: number) => {
    const link = client!, now = performance.now();
    const wasMeeting = !!state.meeting, wasOver = state.over;
    const got = link.poll(state, now);
    if (got) {
      updateEnemiesSeen(state);
      if (got.teleported) state.playerFaceTarget = null;
      if (!wasMeeting && state.meeting) bus.emit({ type: 'MEETING_OPENED', kind: state.meeting.kind });
      if (wasMeeting && !state.meeting) bus.emit({ type: 'MEETING_CLOSED', focusSet: !!state.teamFocus[state.player.nation] });
      for (const ev of got.events) {
        if (ev.type === 'MEETING_OPENED' || ev.type === 'MEETING_CLOSED' || ev.type === 'GAME_OVER' || ev.type === 'MEETING_DENIED') continue;
        bus.emit(ev);
      }
      if (!wasOver && state.over) bus.emit({ type: 'GAME_OVER', winner: state.winner ?? 'draw' });
    }
    if (!state.over && !hostGoneShown && link.hostGone(now)) {
      hostGoneShown = true;
      state.over = true;
      showHostLeft();
    }
    for (const c of state.commands) {
      if (c.type === 'face') state.playerFaceTarget = { x: c.x, z: c.z };
      else if (c.type === 'squad') { state.squadOrder = c.order; link.command('squad', c.order); }
      else if (c.type === 'ping') link.command('ping', c.kind);
      else link.command(c.type);
    }
    state.commands = [];
    const steps = state.meeting || state.over ? (clock.reset(), 0) : clock.consume(frameMs);
    for (let i = 0; i < steps; i++) {
      for (const e of state.entities) { e.prevX = e.x; e.prevY = e.y; e.prevZ = e.z; }
      state.time += STEP_MS;
      updatePlayerMovement(state, STEP_SEC);
      if (state.player.alive && !state.player.jailed) settleBody(state.player, STEP_SEC);
      link.mirror.smooth(state, STEP_SEC, now);
    }
    link.send(state, now);
    flush();
  };

  const ghost = new Ghost();
  let lastFrameAt = performance.now();
  startRafLoop((rafMs) => {
    // Time the background catch-up already simulated is not counted twice.
    const frameMs = Math.min(rafMs, performance.now() - lastFrameAt);
    lastFrameAt = performance.now();
    const look = input.consumeLook();
    cam.applyLook(look.dx, look.dy);
    cam.applyZoom(input.consumeZoom());
    const axes = input.moveAxes();
    state.input = { forward: axes.forward, turn: axes.turn, dash: input.dash };
    if (client) mirror(frameMs);
    else simulate(frameMs);
    // Executed: spectate as a ghost, free to fly anywhere.
    if (!state.player.alive && !state.meeting) {
      if (!ghost.active) {
        ghost.start(state.player.x, state.player.y, state.player.z);
        log.add('観戦中（幽霊）：↑↓で移動、←→で向き、Shiftで速く、Spaceで上昇、Zで下降。全員が見えます。');
      }
      ghost.step(cam, axes, input.dash, input.held(' '), input.held('z'), frameMs / 1000);
    }
    if (state.meeting) meetingView.refresh(state);
    if (!truceBox.hidden && !state.war.proposal) truceBox.hidden = true;
    $('trLeft').textContent = String(trucesLeft(state));
    btnTruce.disabled = trucesLeft(state) <= 0 || !!state.war.proposal || !state.player.alive || state.over
      || state.war.truces.some((t) => t.until > state.time && (t.a === state.player.nation || t.b === state.player.nation));
    render(state, entityView, indicators, cam, clock.alpha, frameMs / 1000, ghost);
    effects.sync(state, frameMs / 1000);
    warView.sync(state);
    objectives.sync(state, refs.camera, !!state.meeting || state.over);
    pingView.sync(state, state.player.nation);
    setNightfall(refs, nightFactor(state));
    footprints.sync(state, cam.yaw);
    tutorial?.sync();
    music.setTension(tensionOf(state));
    pingMarkers.sync(state, refs.camera, names, !!state.meeting || state.over);
    tags.sync(state, entityView, refs.camera, clock.alpha);
  });
  // A hidden tab gets no animation frames: the host keeps the match running anyway (browsers
  // slow timers in the background, so it catches up in 50 ms slices).
  if (host) {
    setInterval(() => {
      const gap = performance.now() - lastFrameAt;
      if (gap < 250) return;
      lastFrameAt = performance.now();
      state.input = { forward: 0, turn: 0, dash: false };
      for (let t = Math.min(gap, 5000); t > 0; t -= 50) simulate(Math.min(50, t));
    }, 200);
  }
}

/** The strongest nation other than `n` (named in a ceasefire offer). */
function strongestOther(state: GameState, n: NationId): string {
  const o = NATION_IDS.filter((x) => x !== n && x !== state.player.nation).sort((a, b) => strength(state, b) - strength(state, a))[0];
  return o ? NATIONS[o].name + '国' : '敵';
}

function showHostLeft(): void {
  $('overlay').style.display = 'flex';
  $('ovTitle').textContent = 'ホストが退出しました';
  $('ovDesc').textContent = '試合を続けられません。もう一度部屋を作って遊びましょう。';
  $('ovStats').textContent = '';
}

function render(state: GameState, entityView: EntityView, indicators: Indicators, cam: CameraController, alpha: number, dtSec: number, ghost: Ghost | null): void {
  const p = state.player;
  entityView.seeAll = !!ghost?.active;
  entityView.sync(state, alpha, dtSec);
  indicators.sync(state, alpha);
  refs.towerMesh.material.color.setHex(state.tower.owner ? NATIONS[state.tower.owner].color : 0x777777);
  let px = lerp(p.prevX, p.x, alpha), py = lerp(p.prevY, p.y, alpha), pz = lerp(p.prevZ, p.z, alpha);
  if (ghost?.active) {
    cam.free(refs.camera, ghost.x, ghost.y, ghost.z);
    px = ghost.x; py = Math.max(0, ghost.y - 150); pz = ghost.z;
  } else {
    cam.follow(Math.atan2(p.dirX, p.dirZ), dtSec);
    cam.update(refs.camera, px, py, pz, dtSec);
  }
  entityView.playerOpacity = cam.boomLength < 70 ? 0.3 : 1;
  followSun(refs, px, py, pz);
  updateTrain(refs, state.time / 1000);
  refs.renderer.render(refs.scene, refs.camera);
  hud.update(state);
  minimap.draw(state, ghost?.active ? { x: ghost.x, z: ghost.z, yaw: cam.yaw } : null);
}

/** Keeps the drawing buffer in sync with layout changes, rotation and pixel-ratio changes. */
function watchCanvasSize(): void {
  const resize = () => resizeRenderer(refs, canvas);
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  const watchDpr = () => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => { resize(); watchDpr(); }, { once: true });
  };
  watchDpr();
}

/** Read-only hooks for automated browser checks (`?debug`). */
function exposeDebug(state: GameState, cam: CameraController, tutorial: TutorialGuide | null): void {
  (window as unknown as { __sangoku: unknown }).__sangoku = {
    screen: () => screen,
    tutorialStep: () => tutorial?.step ?? null,
    cpuLevel: () => state.cpuLevel,
    humans: () => state.humans,
    online: () => ({ me: state.player.id, humans: state.humans, remote: state.entities.filter((e) => e.remote).map((e) => e.id), meetingReady: state.meeting?.ready ?? null }),
    player: () => ({ x: state.player.x, y: state.player.y, z: state.player.z, dirX: state.player.dirX, dirZ: state.player.dirZ, capCd: state.player.cd.capture, jailed: state.player.jailed }),
    entities: () => state.entities.map((e) => ({ id: e.id, nation: e.nation, role: e.role, x: e.x, y: e.y, z: e.z, alive: e.alive, jailed: e.jailed, state: e.ai.state, targetId: e.ai.targetId })),
    // Keeps the teleport count: online, it is the host's to change.
    teleport: (x: number, z: number, y?: number) => { const tp = state.player.tp; teleport(state.player, x, z, y); state.player.tp = tp; },
    face: (dx: number, dz: number) => { const l = Math.hypot(dx, dz) || 1; state.player.dirX = dx / l; state.player.dirZ = dz / l; cam.snap(Math.atan2(dx, dz)); },
    posture: () => ({ sun: state.factions.sun.posture, moon: state.factions.moon.posture, star: state.factions.star.posture }),
    cameraPos: () => ({ x: refs.camera.position.x, y: refs.camera.position.y, z: refs.camera.position.z }),
    solidAtCamera: () => solidAt(refs.camera.position.x, refs.camera.position.y, refs.camera.position.z),
    executeKing: (nation: NationId) => { const k = state.entities.find((e) => e.nation === nation && e.role === 'king')!; eliminate(state, k); },
    squadOrder: () => state.squadOrder,
    war: () => state.war.sectors.map((x, i) => ({ name: SECTORS[i].name, owner: x.owner, capturer: x.capturer, progress: x.progress, contested: x.contested, point: sectorPoint(i) })),
    strategy: () => ({ sun: state.factions.sun.strategy, moon: state.factions.moon.strategy, star: state.factions.star.strategy }),
    truces: () => state.war.truces,
    proposeTruceTo: (to: NationId) => proposeTruce(state, state.player.nation, to),
    offerTruceFrom: (from: NationId) => proposeTruce(state, from, state.player.nation),
    ghost: () => ({ x: refs.camera.position.x, y: refs.camera.position.y, z: refs.camera.position.z }),
    jailAllies: (by: NationId, keep = 0) => { const mine = state.entities.filter((e) => e.nation === state.player.nation && !e.isPlayer && e.alive && !e.jailed); for (const e of mine.slice(0, mine.length - keep)) sendToJail(state, e, by, null); },
    setTime: (ms: number) => { state.time = ms; },
    /** Stuns someone (the player if no id) for `ms`, as a rifle hit would. */
    stun: (ms: number, id = state.player.id) => { state.entities[id].stunUntil = state.time + ms; },
    /** Puts an enemy of `nation` at an offset from the player, running across (for footprint/footstep checks). */
    runner: (nation: NationId, dx: number, dz: number) => { const e = state.entities.find((o) => o.nation === nation && o.role === 'soldier' && o.alive && !o.jailed)!; teleport(e, state.player.x + dx, state.player.z + dz); e.dashing = true; e.ai.goal = { x: state.player.x + dx, y: 0, z: state.player.z - dz * 3 }; return e.id; },
    giveTower: (n: NationId) => { state.tower.owner = n; },
    captureKing: (nation: NationId, by: NationId) => { const k = state.entities.find((e) => e.nation === nation && e.role === 'king')!; sendToJail(state, k, by, null); },
    camera: () => ({ yaw: cam.yaw, pitch: cam.pitch, distance: cam.distance }),
    time: () => state.time,
    meeting: () => !!state.meeting,
    meetingIn: (sec: number) => { state.nextMeetingAt = state.time + sec * 1000; state.meetingWarned = false; },
    commands: () => state.commands.length,
    renderer: () => ({ pixelRatio: refs.renderer.getPixelRatio(), width: refs.renderer.domElement.width, height: refs.renderer.domElement.height }),
    renderInfo: () => ({ calls: refs.renderer.info.render.calls, triangles: refs.renderer.info.render.triangles, geometries: refs.renderer.info.memory.geometries, textures: refs.renderer.info.memory.textures }),
  };
}

const setup = initSetupScreen(settings,
  (s) => { if (next(screen, { type: 'START' }, s).effect === 'startMatch') launch(s.nation!, s.role!, s.size, { kind: 'solo' }, { cpu: s.cpu }); },
  (s) => { settings = s; saveSettings(store('localStorage'), s); });
initOnlineLobby(setup, (start) => {
  const seat = start.info.seats[start.me];
  launch(seat[1], seat[2], start.info.size, { kind: start.me === 0 ? 'host' : 'client', start }, { cpu: settings.cpu });
});
const startTutorial = () => launch('sun', 'keyholder', 6, { kind: 'solo' }, { tutorial: true });
$('btnPlay').onclick = () => showScreen(next(screen, { type: 'PLAY' }, settings).screen);
$('btnTutorial').onclick = () => { if (next(screen, { type: 'TUTORIAL' }, settings).effect === 'startTutorial') startTutorial(); };
$('btnSetupBack').onclick = () => showScreen(next(screen, { type: 'TITLE' }, settings).screen);
$('btnGuide').onclick = () => showScreen(next(screen, { type: 'GUIDE' }, settings).screen);
$('btnGuideBack').onclick = () => showScreen(next(screen, { type: 'TITLE' }, settings).screen);
// Start-up: the title, or where the last page asked to land (もう一度遊ぶ / 設定を変更 / そのままプレイ).
const first = bootScreen(takeIntent(store('sessionStorage')), settings);
if (first === 'PLAYING') launch(settings.nation!, settings.role!, settings.size, { kind: 'solo' }, { cpu: settings.cpu });
else if (first === 'TUTORIAL') startTutorial();
else showScreen(first);
// Build the AI's navigation graph while the player is still on the start screen.
setTimeout(() => navGraph(), 300);
