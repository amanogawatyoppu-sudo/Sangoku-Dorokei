import type { NationId } from '../config/nations';

export type AbilityResult =
  | 'king_dodge'
  | 'soldier_heal'
  | 'sniper_stun'
  | 'sniper_miss'
  | 'radar'
  | 'radar_outside_tower'
  | 'sprint';

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
  /** A king was executed: that kingdom is out and all its people with it. */
  | { type: 'NATION_FALLEN'; nation: NationId }
  | { type: 'KING_DODGED'; nation: NationId }
  | { type: 'SOLDIER_ENDURED'; nation: NationId; hp: number }
  | { type: 'ELIMINATED'; entityId: number }
  | { type: 'RESCUE_STARTED'; rescuerId: number; targetId: number }
  | { type: 'RESCUE_NO_TARGET'; rescuerId: number }
  /** Only one of the nation is still free: they can open jails now (whatever their role). */
  | { type: 'LAST_STAND'; entityId: number }
  /** The tower's holder lit up the enemy kings (last third of the match). */
  | { type: 'KING_BEACON'; nation: NationId; untilMs: number }
  /** The last third of the match began: the tower can light the kings from now on. */
  | { type: 'BEACON_PHASE' }
  /** It is getting dark: vision shrinks except under lamps. */
  | { type: 'NIGHTFALL' }
  /** Someone pinged (合図) their nation. */
  | { type: 'PING'; pingId: number; by: number; kind: 'king' | 'help' | 'gather' | 'danger' }
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
  | { type: 'GAME_OVER'; winner: NationId | 'draw' }
  /** The war for Tokyo (戦区). */
  | { type: 'SECTOR_CAPTURED'; sector: number; nation: NationId; from: NationId | null }
  | { type: 'SECTOR_ATTACKED'; sector: number; by: NationId; owner: NationId }
  | { type: 'SECTOR_CONTESTED'; sector: number; nations: NationId[] }
  | { type: 'SECTOR_BATTLE'; sector: number; nations: NationId[] }
  | { type: 'STRATEGY'; nation: NationId; kind: string; sector: number | null }
  | { type: 'TRUCE_PROPOSED'; from: NationId; to: NationId }
  | { type: 'TRUCE_STARTED'; a: NationId; b: NationId; sec: number }
  | { type: 'TRUCE_DECLINED'; from: NationId; to: NationId }
  | { type: 'TRUCE_ENDED'; a: NationId; b: NationId };
