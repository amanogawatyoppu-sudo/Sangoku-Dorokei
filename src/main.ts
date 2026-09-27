import './style.css';
import type { NationId } from './config/nations';
import { NATIONS } from './config/nations';
import type { RoleId } from './config/roles';
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
import { buildScene, followSun, resizeRenderer } from './render/sceneBuilder';
import type { GameEvent } from './sim/events';
import { advanceFrame } from './sim/game';
import type { GameState } from './sim/state';
import { createGameState, drainEvents, queueCommand } from './sim/state';
import { teleport } from './sim/entity';
import { $ } from './ui/dom';
import { initDrawers } from './ui/drawers';
import { Hud } from './ui/hud';
import { LogPanel } from './ui/log';
import { MeetingView } from './ui/meetingView';
import { bindMessages } from './ui/messages';
import { Minimap } from './ui/minimap';
import { initResultView, showResult } from './ui/resultView';
import { initSetupScreen } from './ui/setupScreen';

const canvas = $('game3d') as HTMLCanvasElement;
const refs = buildScene(canvas);
const hud = new Hud();
const log = new LogPanel();
const minimap = new Minimap();
const meetingView = new MeetingView();
initResultView();
initDrawers(canvas);
watchCanvasSize();

function startGame(nation: NationId, role: RoleId): void {
  const state = createGameState(nation, role);
  const bus = new EventBus<GameEvent>();
  const cam = new CameraController();
  const entityView = new EntityView(refs.scene, state);
  const indicators = new Indicators(refs.scene);
  const clock = new FixedStepClock();

  bindMessages(bus, state, log, hud);
  bindSfx(bus, state);
  bus.on('GAME_OVER', () => showResult(state));
  bus.on('MEETING_OPENED', () => {
    meetingView.open(state, {
      say: (c) => sayInMeeting(state, c),
      vote: (i) => voteInMeeting(state, i),
      close: () => { closeMeeting(state); flush(); },
    });
  });
  bus.on('MEETING_CLOSED', () => meetingView.hide());

  const flush = () => { for (const ev of drainEvents(state)) bus.emit(ev); };
  const input = new InputManager(canvas, {
    isBlocked: () => !!state.meeting || state.over,
    onCapture: () => { queueCommand(state, { type: 'capture' }); },
    onSpecial: () => { queueCommand(state, { type: 'special' }); },
    // Q / 振向: a quick half-turn to check behind (the camera follows the body round).
    onFace: () => { queueCommand(state, { type: 'face', x: -state.player.dirX, z: -state.player.dirZ }); },
  });
  $('btnMeeting').onclick = () => { openMeeting(state); flush(); };

  hud.initFor(state);
  log.add('v7.3: 立体マップ・追跡AI・背後追従カメラ。W/Sで前後、A/Dで旋回、Qで振り向き。');
  hud.banner('三国ドロケイ 開始　' + NATIONS[nation].name + 'の' + roleName(role), 2200);
  resizeRenderer(refs, canvas);
  cam.snap(Math.atan2(state.player.dirX, state.player.dirZ));
  if (new URLSearchParams(location.search).has('debug')) exposeDebug(state, cam);

  startRafLoop((frameMs) => {
    const look = input.consumeLook();
    cam.applyLook(look.dx, look.dy);
    cam.applyZoom(input.consumeZoom());
    const axes = input.moveAxes();
    state.input = { forward: axes.forward, turn: axes.turn, dash: input.dash };
    advanceFrame(state, clock, frameMs);
    flush();
    render(state, entityView, indicators, cam, clock.alpha, frameMs / 1000);
  });
}

function render(state: GameState, entityView: EntityView, indicators: Indicators, cam: CameraController, alpha: number, dtSec: number): void {
  const p = state.player;
  entityView.sync(state, alpha, dtSec);
  indicators.sync(state, alpha);
  refs.towerMesh.material.color.setHex(state.tower.owner ? NATIONS[state.tower.owner].color : 0x777777);
  const px = lerp(p.prevX, p.x, alpha), py = lerp(p.prevY, p.y, alpha), pz = lerp(p.prevZ, p.z, alpha);
  cam.follow(Math.atan2(p.dirX, p.dirZ), dtSec);
  cam.update(refs.camera, px, py, pz, dtSec);
  followSun(refs, px, py, pz);
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
    player: () => ({ x: state.player.x, y: state.player.y, z: state.player.z, dirX: state.player.dirX, dirZ: state.player.dirZ, capCd: state.player.cd.capture, jailed: state.player.jailed }),
    entities: () => state.entities.map((e) => ({ id: e.id, nation: e.nation, role: e.role, x: e.x, y: e.y, z: e.z, alive: e.alive, jailed: e.jailed, state: e.ai.state, targetId: e.ai.targetId })),
    teleport: (x: number, z: number, y?: number) => { teleport(state.player, x, z, y); },
    posture: () => ({ sun: state.factions.sun.posture, moon: state.factions.moon.posture, star: state.factions.star.posture }),
    camera: () => ({ yaw: cam.yaw, pitch: cam.pitch, distance: cam.distance }),
    time: () => state.time,
    meeting: () => !!state.meeting,
    commands: () => state.commands.length,
    renderer: () => ({ pixelRatio: refs.renderer.getPixelRatio(), width: refs.renderer.domElement.width, height: refs.renderer.domElement.height }),
  };
}

initSetupScreen(startGame);
