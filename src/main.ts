import './style.css';
import type { NationId } from './config/nations';
import { NATIONS } from './config/nations';
import type { RoleId } from './config/roles';
import { roleName } from './config/roles';
import { MEETING_AUTO_CLOSE } from './config/constants';
import { FixedStepClock } from './core/clock';
import { EventBus } from './core/events';
import { startRafLoop } from './core/loop';
import { bindSfx } from './audio/sfx';
import { InputManager } from './input/inputManager';
import { closeMeeting, openMeeting, sayInMeeting, voteInMeeting } from './meeting/meetingSystem';
import { CameraController } from './render/cameraController';
import { EntityView, lerp } from './render/entityView';
import { buildScene, resizeRenderer } from './render/sceneBuilder';
import type { GameEvent } from './sim/events';
import { advanceFrame } from './sim/game';
import type { GameState } from './sim/state';
import { createGameState, drainEvents } from './sim/state';
import { $ } from './ui/dom';
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

function startGame(nation: NationId, role: RoleId): void {
  const state = createGameState(nation, role);
  const bus = new EventBus<GameEvent>();
  const cam = new CameraController();
  const entityView = new EntityView(refs.scene, state);
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
    setTimeout(() => { if (state.meeting) { closeMeeting(state); flush(); } }, MEETING_AUTO_CLOSE);
  });
  bus.on('MEETING_CLOSED', () => meetingView.hide());

  const flush = () => { for (const ev of drainEvents(state)) bus.emit(ev); };
  const blocked = () => !!state.meeting || state.over;
  const input = new InputManager(canvas, {
    isBlocked: blocked,
    onCapture: () => state.commands.push({ type: 'capture' }),
    onSpecial: () => state.commands.push({ type: 'special' }),
  });
  $('btnMeeting').onclick = () => { openMeeting(state); flush(); };

  hud.initFor(state);
  log.add('v7.0: Vite + TypeScript 基盤へ移行（ゲーム内容はv6準拠）。');
  hud.banner('三国ドロケイ 開始　' + NATIONS[nation].name + 'の' + roleName(role), 2200);
  resizeRenderer(refs, canvas);

  startRafLoop((frameMs) => {
    const look = input.consumeLook();
    cam.applyLook(look.dx, look.dy);
    const axes = input.moveAxes();
    state.input = { ...cam.toWorld(axes.forward, axes.right), dash: input.dash };
    advanceFrame(state, clock, frameMs);
    flush();
    render(state, entityView, cam, clock.alpha);
  });
}

function render(state: GameState, entityView: EntityView, cam: CameraController, alpha: number): void {
  const p = state.player;
  entityView.sync(state, alpha);
  refs.towerMesh.material.color.setHex(state.tower.owner ? NATIONS[state.tower.owner].color : 0x777777);
  cam.update(refs.camera, lerp(p.prevX, p.x, alpha), lerp(p.prevZ, p.z, alpha));
  refs.renderer.render(refs.scene, refs.camera);
  hud.update(state);
  minimap.draw(state);
}

window.addEventListener('resize', () => resizeRenderer(refs, canvas));
initSetupScreen(startGame);
