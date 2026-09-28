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
import { buildScene, followSun, resizeRenderer, updateTrain } from './render/sceneBuilder';
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
import { initSetupScreen } from './ui/setupScreen';
import type { OnlineStart } from './ui/onlineLobby';
import { initOnlineLobby } from './ui/onlineLobby';
import { ClientLink, HostLink, seatsOf } from './net/online';
import { NameTags } from './render/nameTags';
import { Ghost } from './render/ghost';
import { WarView } from './render/warView';
import { ObjectiveMarkers } from './ui/objectiveMarkers';
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
initResultView();
initDrawers(canvas);
watchCanvasSize();

/** Single player, the host of an online match (runs the simulation), or a friend in one (mirrors it). */
type Mode =
  | { kind: 'solo' }
  | { kind: 'host'; start: OnlineStart }
  | { kind: 'client'; start: OnlineStart };

function startGame(nation: NationId, role: RoleId, size: RosterSize, mode: Mode = { kind: 'solo' }): void {
  const online = mode.kind === 'solo' ? undefined : mode.start;
  const state = online
    ? createGameState(nation, role, createRng(online.info.seed), size, { seats: seatsOf(online.info), me: online.me })
    : createGameState(nation, role, undefined, size);
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
  const clock = new FixedStepClock();

  bindMessages(bus, state, log, hud);
  bindSfx(bus, state);
  bus.on('GAME_OVER', () => showResult(state));
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
  });
  $('btnMeeting').onclick = () => { openMeeting(state); flush(); };
  $('btnBeacon').onclick = () => queueCommand(state, { type: 'beacon' });
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
  const me = state.player;
  if (online) {
    log.add(`オンライン対戦：部屋 ${online.lobby.code}・${online.info.seats.length}人。同じ国は味方、ほかの国は敵。`);
    if (host) log.add('あなたがホストです。このタブを閉じると試合が終わります。');
  } else log.add('v7.19: 王と「最後の一人」も救出できる（牢屋の仲間のそばでZ）。終盤は管制塔で敵の王を照らせる（B）。味方の頭上に名前と役職。東京は9つの戦区。画面の紋章マーカーが戦略拠点（輪が制圧ゲージ）、街の幟の色がその戦区の支配国。拠点に立ち続けると制圧。ミニマップに勢力と前線。↑↓で前後、←→で旋回、Shiftで加速、Spaceで捕獲、Zで特殊、Qで振り向き。分隊はX 付いてこい・C 周りを警戒・V ここを守れ。');
  hud.banner('三国ドロケイ 開始　' + NATIONS[me.nation].name + 'の' + roleName(me.role), 2200);
  const tags = new NameTags($('nametags'), state, names);
  resizeRenderer(refs, canvas);
  cam.snap(Math.atan2(state.player.dirX, state.player.dirZ));
  if (new URLSearchParams(location.search).has('debug')) exposeDebug(state, cam);

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
function exposeDebug(state: GameState, cam: CameraController): void {
  (window as unknown as { __sangoku: unknown }).__sangoku = {
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

const setup = initSetupScreen(startGame);
initOnlineLobby(setup, (start) => {
  $('setup').style.display = 'none';
  const seat = start.info.seats[start.me];
  startGame(seat[1], seat[2], start.info.size, { kind: start.me === 0 ? 'host' : 'client', start });
});
// Build the AI's navigation graph while the player is still on the start screen.
setTimeout(() => navGraph(), 300);
