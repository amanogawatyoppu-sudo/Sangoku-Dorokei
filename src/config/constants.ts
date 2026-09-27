/** Collision radius of a character. */
export const CR = 14;
export const VISION = 420;
export const DASH_VISION_BONUS = 260;
export const CAP_RANGE = 95;
/** Captures need the two characters on the same level (feet within this height). */
export const CAP_HEIGHT = 30;
export const PLAYER_WALK = 300;
export const PLAYER_DASH = 520;
export const AI_SPEED = 330;

/** Match length in seconds. */
export const GAME_TIME = 300;
/** All durations below are in milliseconds of game time. */
/**
 * Jail sentences scale with the v7.3 map (~1.9x wider than v6): v6's 22 s / +6 s
 * left no time to cross the map for a king rescue (0 of 10 simulated rescues
 * succeeded). Normal 32 s, king 48 s.
 */
export const JAIL_TIME = 32000;
export const KING_JAIL_EXTRA = 16000;
export const STUN_TIME = 3000;
export const TOWER_CHANNEL = 3000;
export const KING_REVEAL_TIME = 24000;
export const KING_RESCUE_ALERT_TIME = 40000;
/** How long the jail holding a captured king is visible to every nation. */
export const JAIL_REVEAL_TIME = 30000;
export const JAIL_GUARD_TIME = 30000;
export const RADAR_TIME = 7000;
export const DISGUISE_TIME = 8000;
export const EVIDENCE_INTERVAL = 7000;
export const FIRST_EVENT_AT = 30000;
export const SPEED_EVENT_TIME = 7000;
export const LEAK_EVENT_TIME = 5000;
export const TERMINAL_TIME = 18000;
export const MEETING_AUTO_CLOSE = 30000;
export const MEETINGS_PER_GAME = 2;
export const MEETING_RANGE = 90;

/** A/D turning speed (rad/s): about 200°/s, quick enough to dodge, smooth enough to read. */
export const PLAYER_TURN_RATE = 3.5;
/** Q (振り向き) half-turn speed (rad/s): a 180° turn takes ~0.26 s. */
export const PLAYER_QUICK_TURN_RATE = 12;

export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 30;
export const STAMINA_REGEN = 15;
