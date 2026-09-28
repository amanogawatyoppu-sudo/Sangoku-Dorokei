import type { NationId } from '../config/nations';

export type AbilityResult =
  | 'king_dodge'
  | 'soldier_heal'
  | 'sniper_stun'
  | 'sniper_miss'
  | 'radar'
  | 'radar_outside_tower'
  | 'disguise';

export type RandomEventKind = 'speed' | 'jailbreak' | 'leak';

export type MeetingDeniedReason = 'none_left' | 'too_far';

/**
 * Everything the simulation wants the outside world (UI, audio, rendering) to
 * know about. The simulation only appends to `state.events`; it never touches
 * the DOM, audio, or Three.js.
 */
export type GameEvent =
  | { type: 'CAPTURE'; attackerId: number; targetId: number }
  | { type: 'CAPTURE_FAILED'; attackerId: number; reason: 'side' | 'back' }
  | { type: 'JAILED'; entityId: number; capNation: NationId }
  | { type: 'KING_CAPTURED'; nation: NationId }
  | { type: 'KING_DODGED'; nation: NationId }
  | { type: 'SOLDIER_ENDURED'; nation: NationId; hp: number }
  | { type: 'IMPOSTOR_EXPOSED'; nation: NationId }
  | { type: 'ELIMINATED'; entityId: number }
  | { type: 'RESCUE_STARTED'; rescuerId: number; targetId: number }
  | { type: 'RESCUE_NO_TARGET'; rescuerId: number }
  | { type: 'RESCUE_FAILED'; rescuerId: number; targetId: number }
  | { type: 'RESCUED'; rescuerId: number; targetId: number }
  | { type: 'KING_RESCUED'; nation: NationId }
  | { type: 'ABILITY'; entityId: number; result: AbilityResult; targetId?: number }
  | { type: 'TOWER_CAPTURED'; nation: NationId }
  | { type: 'RANDOM_EVENT'; kind: RandomEventKind; count?: number }
  | { type: 'EVIDENCE'; entityId: number; text: string }
  | { type: 'FOOTSTEP' }
  | { type: 'MEETING_DENIED'; reason: MeetingDeniedReason }
  | { type: 'MEETING_OPENED'; kind: 'emergency' | 'scheduled' }
  | { type: 'MEETING_SOON'; inSec: number }
  | { type: 'SQUAD_ORDER'; leaderId: number; order: 'follow' | 'spread' | 'hold' }
  | { type: 'MEETING_CLOSED'; focusSet: boolean }
  | { type: 'GAME_OVER'; winner: NationId | 'draw' };
