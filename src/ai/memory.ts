/**
 * Per-character AI state. Plain data kept on the Entity so it survives with the
 * rest of the simulation state; only the AI modules read or write it.
 */

export type AiState =
  | 'PATROL' // roam between hotspots
  | 'INVESTIGATE' // go check a place an ally (or an event) reported
  | 'CHASE' // an enemy is in sight: pursue it
  | 'INTERCEPT' // an ally is already chasing: cut the enemy off
  | 'SEARCH' // lost sight: sweep around the last known position
  | 'GUARD' // hold a jail or post
  | 'ESCORT' // stay by the king
  | 'RESCUE' // head for a jail to free an ally
  | 'FLEE' // get away from a threat
  | 'HOLD'; // stand at a post (sniper perch, tower)

/** What this character last knew about an enemy. */
export interface Sighting {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Game time (ms) of the sighting. */
  t: number;
  /** Estimated ground velocity (units/s) from consecutive sightings. */
  vx: number;
  vz: number;
}

export interface Waypoint {
  x: number;
  y: number;
  z: number;
}

export interface NavPath {
  /** Waypoints to walk through, ending at the goal. */
  points: Waypoint[];
  i: number;
  goal: Waypoint;
}

/** Job handed out by the nation's commander (see ai/faction.ts). */
export type Task =
  | { kind: 'rescueKing'; jail: 'sun' | 'moon' | 'star' }
  | { kind: 'rescueEscort'; jail: 'sun' | 'moon' | 'star' }
  | { kind: 'decoy'; toward: 'sun' | 'moon' | 'star' }
  | { kind: 'guardJail' }
  | { kind: 'escortKing' }
  | { kind: 'raidJail'; jail: 'sun' | 'moon' | 'star' }
  | { kind: 'takeTower' }
  | { kind: 'hunt'; nation: 'sun' | 'moon' | 'star' };

export interface AiMemory {
  state: AiState;
  /** Enemy being chased / searched for. */
  targetId: number | null;
  /** Enemies currently in view (ids), refreshed by perception. */
  visible: number[];
  /** Last known sighting per enemy. */
  seen: Map<number, Sighting>;
  /** 0 = calm … 1 = fully alert (recent contact). */
  alert: number;
  goal: Waypoint | null;
  path: NavPath | null;
  /** Game time of the next decision and perception update. */
  thinkAt: number;
  perceiveAt: number;
  replanAt: number;
  searchUntil: number;
  searchCenter: Waypoint | null;
  /** Chase role among allies after the same enemy. */
  chaseRole: 'direct' | 'intercept' | 'flank';
  flankSide: 1 | -1;
  task: Task | null;
  /** Stuck detection: last position that counted as progress. */
  progressX: number;
  progressZ: number;
  progressAt: number;
  /** Longest time (s) this AI spent unable to make progress (diagnostics/tests). */
  maxStuckSec: number;
  /** Diagnostics: seconds spent above ground level (stairs, floors, hills). */
  highSec: number;
}

export function createAiMemory(): AiMemory {
  return {
    state: 'PATROL', targetId: null, visible: [], seen: new Map(), alert: 0,
    goal: null, path: null, thinkAt: 0, perceiveAt: 0, replanAt: 0,
    searchUntil: 0, searchCenter: null, chaseRole: 'direct', flankSide: 1, task: null,
    progressX: 0, progressZ: 0, progressAt: 0, maxStuckSec: 0, highSec: 0,
  };
}
