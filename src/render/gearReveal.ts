import type { RoleId } from '../config/roles';

/**
 * When enemies get to see someone's role gear (v9.1). Everyone wears the same uniform; the
 * gear shows to enemies only for a few seconds after something only that role can do and
 * that is plain to see anyway, so the gear never tells more than the action already did.
 *
 * - VANGUARD: shrugs off a TRACE (HP drops) or recovers (ability) → 6 s
 * - RELAY: radar (ability) → 6 s
 * - RUNNER: while sprinting, plus 3 s
 * - SPOTTER: while drawing a bead or firing, plus 2 s
 * - BREAKER: never — unlocking is shared with the ANCHOR and the last one standing
 * - ANCHOR: never
 */
export interface SeenAction {
  /** The role's ability was just used (its cooldown restarted). */
  used: boolean;
  /** HP went down without being caught. */
  hpDropped: boolean;
  sprinting: boolean;
  aiming: boolean;
}

/** Seconds of reveal this action starts (0 = none); the caller keeps the longer of this and what is left. */
export function gearReveal(role: RoleId, s: SeenAction): number {
  switch (role) {
    case 'soldier': return s.used || s.hpDropped ? 6 : 0;
    case 'communicator': return s.used ? 6 : 0;
    case 'ranger': return s.sprinting ? 3 : 0;
    case 'sniper': return s.aiming ? 2 : 0;
    default: return 0; // king, keyholder
  }
}
