import { aggroFor, aiTick } from '../ai/controller';
import { factionTick } from '../ai/faction';
import type { GameState } from './state';
import { emit } from './state';
import { timeLeftSec } from './state';
import { activate, tickCooldowns } from './systems/abilities';
import { attemptCapture } from './systems/capture';
import { updateJailTimers } from './systems/jail';
import { separate, settleAll, updatePlayerMovement } from './systems/movement';
import { eventTick } from './systems/randomEvents';
import { updateRescue } from './systems/rescue';
import { updateSuspicion } from './systems/suspicion';
import { towerTick } from './systems/tower';
import { updateEnemiesSeen } from './systems/vision';
import { forceEndByTime } from './systems/winCondition';
import { scheduledMeetingTick } from '../meeting/meetingSystem';

function runPlayerCommands(state: GameState): void {
  const cmds = state.commands;
  state.commands = [];
  for (const c of cmds) {
    if (c.type === 'squad') {
      const p = state.player;
      state.squadOrder = c.order;
      state.squadAnchor = { x: p.x, y: p.y, z: p.z };
      for (const e of state.entities) if (e.ai.leaderId === p.id) { e.ai.goal = null; e.ai.path = null; }
      emit(state, { type: 'SQUAD_ORDER', order: c.order });
    } else if (c.type === 'capture') attemptCapture(state, state.player);
    else if (c.type === 'special') activate(state, state.player);
    else state.playerFaceTarget = { x: c.x, z: c.z };
  }
}

/**
 * Advances the whole simulation by one fixed step: player, kingdom commanders,
 * AI, then terrain settling and the v6 rule systems in their original order.
 */
export function stepSimulation(state: GameState, dt: number): void {
  if (state.over) return;
  for (const e of state.entities) { e.prevX = e.x; e.prevY = e.y; e.prevZ = e.z; }
  state.time += dt * 1000;
  if (timeLeftSec(state) <= 0) forceEndByTime(state);
  runPlayerCommands(state);
  updatePlayerMovement(state, dt);
  factionTick(state);
  const aggro = aggroFor(state);
  for (const e of state.entities) if (!e.isPlayer) aiTick(state, e, dt, aggro);
  separate(state);
  settleAll(state, dt);
  for (const e of state.entities) { updateRescue(state, e, dt); updateSuspicion(state, e, dt); }
  tickCooldowns(state, dt);
  updateJailTimers(state);
  updateEnemiesSeen(state);
  towerTick(state, dt);
  eventTick(state);
  scheduledMeetingTick(state);
}
