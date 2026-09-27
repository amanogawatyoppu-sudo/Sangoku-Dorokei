import { aggroRange, aiTick } from '../ai/controller';
import type { GameState } from './state';
import { elapsedSec, timeLeftSec } from './state';
import { activate, tickCooldowns } from './systems/abilities';
import { attemptCapture } from './systems/capture';
import { updatePlayerMovement } from './systems/movement';
import { eventTick } from './systems/randomEvents';
import { updateRescue } from './systems/rescue';
import { updateSuspicion } from './systems/suspicion';
import { towerTick } from './systems/tower';
import { updateEnemiesSeen } from './systems/vision';
import { forceEndByTime } from './systems/winCondition';
import { updateJailTimers } from './systems/jail';

function runPlayerCommands(state: GameState): void {
  const cmds = state.commands;
  state.commands = [];
  for (const c of cmds) {
    if (c.type === 'capture') attemptCapture(state, state.player);
    else activate(state, state.player);
  }
}

/**
 * Advances the whole simulation by one fixed step. This is the v6 `loop()` body
 * minus rendering/UI, in the same system order.
 */
export function stepSimulation(state: GameState, dt: number): void {
  if (state.over) return;
  for (const e of state.entities) { e.prevX = e.x; e.prevZ = e.z; }
  state.time += dt * 1000;
  if (timeLeftSec(state) <= 0) forceEndByTime(state);
  runPlayerCommands(state);
  updatePlayerMovement(state, dt);
  const aggro = aggroRange(elapsedSec(state));
  for (const e of state.entities) if (!e.isPlayer) aiTick(state, e, dt, aggro);
  for (const e of state.entities) { updateRescue(state, e, dt); updateSuspicion(state, e, dt); }
  tickCooldowns(state, dt);
  updateJailTimers(state);
  updateEnemiesSeen(state);
  towerTick(state, dt);
  eventTick(state);
}

