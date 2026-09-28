import { aggroFor, aiTick } from '../ai/controller';
import { factionTick } from '../ai/faction';
import { isHuman } from './entity';
import type { GameState } from './state';
import { emit, speedMul } from './state';
import { PLAYER_DASH, SPRINT_SPEED } from '../config/constants';
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
import { warTick } from './war';

/** Carries out what people asked for this step (the player's buttons and, online, friends' buttons). */
function runPlayerCommands(state: GameState): void {
  const cmds = state.commands;
  state.commands = [];
  for (const c of cmds) {
    const p = c.by === undefined ? state.player : state.entities[c.by];
    if (!p || !isHuman(p)) continue;
    if (c.type === 'squad') {
      const anchor = { x: p.x, y: p.y, z: p.z };
      if (p.isPlayer) { state.squadOrder = c.order; state.squadAnchor = anchor; }
      else state.humanOrders[p.id] = { order: c.order, anchor };
      for (const e of state.entities) if (e.ai.leaderId === p.id) { e.ai.goal = null; e.ai.path = null; }
      emit(state, { type: 'SQUAD_ORDER', leaderId: p.id, order: c.order });
    } else if (c.type === 'capture') attemptCapture(state, p);
    else if (c.type === 'special') activate(state, p);
    else if (p.isPlayer) state.playerFaceTarget = { x: c.x, z: c.z };
  }
}

/**
 * Online: friends move their own characters on their devices; the host takes the
 * reported position unless the character cannot move (jailed, stunned, rescuing)
 * or was teleported and the device has not caught up yet.
 */
const REMOTE_MAX_SPEED = PLAYER_DASH * SPRINT_SPEED * 1.1;

function applyRemotePoses(state: GameState, dt: number): void {
  for (const id of state.humans) {
    const e = state.entities[id], pose = state.remotePose[id];
    if (!e.remote || !pose) continue;
    if (!e.alive || e.jailed || e.channeling || e.stunUntil > state.time || pose.tp !== (e.tp & 15)) {
      e.speed = 0;
      e.dashing = false;
      continue;
    }
    // No faster than a dash (a device can report a far-off spot, but not get there at once).
    const dx = pose.x - e.x, dz = pose.z - e.z, d = Math.hypot(dx, dz), max = REMOTE_MAX_SPEED * speedMul(state) * dt;
    const k = d > max ? max / d : 1;
    e.x += dx * k; e.z += dz * k; e.y = pose.y;
    const l = Math.hypot(pose.dirX, pose.dirZ);
    if (l > 0.01) { e.dirX = pose.dirX / l; e.dirZ = pose.dirZ / l; }
    e.speed = pose.speed;
    e.dashing = pose.dash;
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
  applyRemotePoses(state, dt);
  factionTick(state);
  const aggro = aggroFor(state);
  for (const e of state.entities) if (!isHuman(e)) aiTick(state, e, dt, aggro);
  separate(state);
  settleAll(state, dt);
  for (const e of state.entities) { updateRescue(state, e, dt); updateSuspicion(state, e, dt); }
  tickCooldowns(state, dt);
  updateJailTimers(state);
  updateEnemiesSeen(state);
  towerTick(state, dt);
  warTick(state, dt);
  eventTick(state);
  scheduledMeetingTick(state);
}
