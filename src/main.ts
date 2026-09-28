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
import { sendToJail } from './sim/systems/jail';
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
import { createRng } from './core/rng';
import { STEP_MS, STEP_SEC } from './core/clock';
import { updatePlayerMovement } from './sim/systems/movement';
import { settle } from './sim/systems/world';
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
  const bus = new EventBus<GameEvent>();
  const cam = new CameraController();
  const entityView = new EntityView(refs.scene, state);
  const indicators = new Indicators(refs.scene);
  const effects = new Effects(refs.scene, entityView);
  const clock = new FixedStepClock();

  bindMessages(bus, state, log, hud);
  bindSfx(bus, state);
  bus.on('GAME_OVER', () => showResult(state));
  bus.on('MEETING_OPENED', () => {
    meetingView.open(state, client ? {
      say: (c) => state.meeting?.lines.push('あなた:「' + c + '」'),
      vote: (i) => {
        const m = state.meeting;
        if (!m || m.voted || !m.zones[i]) return;
        m.voted = true;
        m.lines.push('→ あなたの投票:「' + m.zones[i].label + '」');
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
  });
  $('btnMeeting').onclick = () => { openMeeting(state); flush(); };
  if (online) $('btnMeeting').style.display = 'none'; // no emergency meetings online (the whole match would stop)

  hud.initFor(state);
  const me = state.player;
  if (online) {
    log.add(`オンライン対戦：部屋 ${online.lobby.code}・${online.info.seats.length}人。同じ国は味方、ほかの国は敵。`);
    if (host) log.add('あなたがホストです。このタブを閉じると試合が終わります。');
  } else log.add('v7.11: 1 同行・2 散開・3 守備。W/Sで前後、A/Dで旋回、Qで振り向き。');
  hud.banner('三国ドロケイ 開始　' + NATIONS[me.nation].name + 'の' + roleName(me.role), 2200);
  const tags = online ? new NameTags($('nametags'), state, names) : null;
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
      if (state.player.alive && !state.player.jailed) settle(state.player, STEP_SEC);
      link.mirror.smooth(state, STEP_SEC, now);
    }
    link.send(state, now);
    flush();
  };

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
    render(state, entityView, indicators, cam, clock.alpha, frameMs / 1000);
    effects.sync(state, frameMs / 1000);
    tags?.sync(state, entityView, refs.camera, clock.alpha);
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

function showHostLeft(): void {
  $('overlay').style.display = 'flex';
  $('ovTitle').textContent = 'ホストが退出しました';
  $('ovDesc').textContent = '試合を続けられません。もう一度部屋を作って遊びましょう。';
  $('ovStats').textContent = '';
}

function render(state: GameState, entityView: EntityView, indicators: Indicators, cam: CameraController, alpha: number, dtSec: number): void {
  const p = state.player;
  entityView.sync(state, alpha, dtSec);
  indicators.sync(state, alpha);
  refs.towerMesh.material.color.setHex(state.tower.owner ? NATIONS[state.tower.owner].color : 0x777777);
  const px = lerp(p.prevX, p.x, alpha), py = lerp(p.prevY, p.y, alpha), pz = lerp(p.prevZ, p.z, alpha);
  cam.follow(Math.atan2(p.dirX, p.dirZ), dtSec);
  cam.update(refs.camera, px, py, pz, dtSec);
  entityView.playerOpacity = cam.boomLength < 70 ? 0.3 : 1;
  followSun(refs, px, py, pz);
  updateTrain(refs, state.time / 1000);
  refs.renderer.render(refs.scene, refs.camera);
  hud.update(state);
  minimap.draw(state);
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
