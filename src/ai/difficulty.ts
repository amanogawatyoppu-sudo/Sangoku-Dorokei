import type { GameState } from '../sim/state';

/** CPU level (CPUレベル). Only how the AI *decides* changes; speed, reach, toughness and every rule stay the same. */
export type CpuLevel = 'easy' | 'normal' | 'hard' | 'expert';
export const CPU_LEVELS: readonly CpuLevel[] = ['easy', 'normal', 'hard', 'expert'];
export const CPU_LEVEL_NAME: Record<CpuLevel, string> = { easy: '初級', normal: '標準', hard: '上級', expert: '超級' };

export interface AiTuning {
  /** From first sight to reacting (ms). */
  reactionMs: number;
  /** How long a lost target is searched for around its last spot (ms). */
  searchMs: number;
  /** How old a last sighting may be and still be followed up (ms). */
  followUpMs: number;
  /** How long a sighting is remembered at all (ms). */
  forgetMs: number;
  /** Chance that a second/third chaser cuts off or flanks instead of running straight after the target. */
  flankChance: number;
  /** Whether rangers (and, on hard, soldiers) run ahead to stair exits and bridges. */
  ambush: 'none' | 'rangers' | 'rangersAndSoldiers';
  /** Chance a sniper takes an aligned shot when it thinks (less sure hands on easy). */
  sniperFireChance: number;
  /** How often the nation's commander re-plans (ms). */
  strategyTickMs: number;
  /** Every n-th unit goes in by the high route (stairs, footbridge, high ground); 0 = none. */
  highRouteEvery: number;
  /** Extra escorts sent with a king rescue / left guarding a jail. */
  rescueExtra: number;
  /**
   * How much the commander plays to win (0..1): share of hunters sent looking for enemy
   * kings in ordinary times, how eagerly it goes for the tower's beacon in the last third.
   */
  kingHunt: number;
  /** Seconds before time-up when the commander starts playing the score (catch up or protect a lead); 0 = never. */
  endgameSec: number;
}

export const AI_TUNING: Record<CpuLevel, AiTuning> = {
  easy: { reactionMs: 950, searchMs: 3500, followUpMs: 3500, forgetMs: 12000, flankChance: 0.25, ambush: 'none', sniperFireChance: 0.35, strategyTickMs: 1800, highRouteEvery: 0, rescueExtra: 0, kingHunt: 0.1, endgameSec: 0 },
  normal: { reactionMs: 550, searchMs: 6500, followUpMs: 7000, forgetMs: 20000, flankChance: 1, ambush: 'rangers', sniperFireChance: 1, strategyTickMs: 1000, highRouteEvery: 3, rescueExtra: 0, kingHunt: 0.25, endgameSec: 75 },
  hard: { reactionMs: 320, searchMs: 10000, followUpMs: 11000, forgetMs: 30000, flankChance: 1, ambush: 'rangersAndSoldiers', sniperFireChance: 1, strategyTickMs: 700, highRouteEvery: 2, rescueExtra: 1, kingHunt: 0.35, endgameSec: 100 },
  expert: { reactionMs: 220, searchMs: 14000, followUpMs: 15000, forgetMs: 40000, flankChance: 1, ambush: 'rangersAndSoldiers', sniperFireChance: 1, strategyTickMs: 450, highRouteEvery: 2, rescueExtra: 2, kingHunt: 0.45, endgameSec: 130 },
};

export function tuning(state: Pick<GameState, 'cpuLevel'>): AiTuning {
  return AI_TUNING[state.cpuLevel] ?? AI_TUNING.normal;
}
