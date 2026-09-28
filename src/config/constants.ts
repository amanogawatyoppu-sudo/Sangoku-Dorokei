/** Collision radius of a character. */
export const CR = 14;
export const VISION = 420;
export const DASH_VISION_BONUS = 260;
/** A sniper's scope: inside a narrow cone ahead (±22°) they see this far. */
export const SCOPE_RANGE = 580;
export const SCOPE_COS = Math.cos((22 * Math.PI) / 180);
export const CAP_RANGE = 95;
/** Captures need the two characters on the same level (feet within this height). */
export const CAP_HEIGHT = 30;
export const PLAYER_WALK = 300;
export const PLAYER_DASH = 520;
/** AI run speed: equal to the player's walk (was 330), so walking away holds distance and dashing escapes. */
export const AI_SPEED = 300;
/** AI body turn speed (rad/s, ~260°/s). AI now turns smoothly like the player, so it cannot spin instantly to face you. */
export const AI_TURN_RATE = 4.5;
/** Time from first spotting an enemy until an AI reacts to it (ms). */
export const AI_REACTION_MS = 550;

/** Match length in seconds. */
export const GAME_TIME = 300;
/** All durations below are in milliseconds of game time. */
/**
 * Jail sentences scale with the v7.3 map (~1.9x wider than v6): v6's 22 s / +6 s
 * left no time to cross the map for a king rescue (0 of 10 simulated rescues
 * succeeded). v7.18: longer again so a rescue is a real race, not a lost cause —
 * normal 50 s, king 80 s (the whole war turns on a captured king).
 */
export const JAIL_TIME = 50000;
export const KING_JAIL_EXTRA = 30000;
export const STUN_TIME = 3000;
export const TOWER_CHANNEL = 3000;
export const KING_REVEAL_TIME = 24000;
export const KING_RESCUE_ALERT_TIME = 40000;
/** How long the jail holding a captured king is visible to every nation. */
export const JAIL_REVEAL_TIME = 45000;
export const JAIL_GUARD_TIME = 30000;
export const RADAR_TIME = 7000;
/** Tower: in the last third of the match its holder can light up the enemy kings for a while. */
export const KING_BEACON_TIME = 12000;
export const KING_BEACON_CD = 40000;
export const DISGUISE_TIME = 8000;
/** Ranger's 疾走 (sprint): how long, how much faster, and how much quicker stamina comes back. */
export const SPRINT_TIME = 4500;
export const SPRINT_SPEED = 1.3;
export const SPRINT_REGEN = 2.5;
/** Rangers get stamina back faster than everyone else. */
export const RANGER_REGEN = 1.7;
/** Walking up stairs and slopes: everyone slows down, rangers hardly at all. */
export const CLIMB_SLOW = 0.8;
export const RANGER_CLIMB_SLOW = 0.96;
export const EVIDENCE_INTERVAL = 7000;
export const FIRST_EVENT_AT = 30000;
export const SPEED_EVENT_TIME = 7000;
export const LEAK_EVENT_TIME = 5000;
export const TERMINAL_TIME = 18000;
export const MEETING_AUTO_CLOSE = 30000;
export const MEETINGS_PER_GAME = 2;
export const MEETING_RANGE = 90;
/** The half-time meeting (ハーフタイム会議): once, at half time, announced 5 s ahead, auto-closing after 20 s. */
export const SCHEDULED_MEETING_AT = (GAME_TIME * 1000) / 2;
export const SCHEDULED_MEETING_WARN = 5000;
export const SCHEDULED_MEETING_CLOSE = 32000;
/** Online, several people read and vote: a little longer. */
export const ONLINE_MEETING_CLOSE = 40000;

/** A/D turning speed (rad/s): about 200°/s, quick enough to dodge, smooth enough to read. */
export const PLAYER_TURN_RATE = 3.5;
/** Q (振り向き) half-turn speed (rad/s): a 180° turn takes ~0.26 s. */
export const PLAYER_QUICK_TURN_RATE = 12;

export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 30;
export const STAMINA_REGEN = 15;
