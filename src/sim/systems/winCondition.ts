import type { NationId } from '../../config/nations';
import { NATION_IDS } from '../../config/nations';
import type { GameState } from '../state';
import { emit } from '../state';

function aliveKingNations(state: GameState): NationId[] {
  return NATION_IDS.filter((n) => state.entities.some((e) => e.nation === n && e.role === 'king' && e.alive));
}

function endGame(state: GameState, winner: NationId | 'draw'): void {
  state.winner = winner;
  state.over = true;
  emit(state, { type: 'GAME_OVER', winner });
}

/** Called whenever a king dies: last kingdom standing wins. */
export function checkWin(state: GameState): void {
  const alive = aliveKingNations(state);
  if (alive.length <= 1 && !state.winner) endGame(state, alive[0] ?? 'draw');
}

/**
 * War score for a time-up finish (v7.20). The whole war counts, not only the tower:
 * v7.19's score gave the tower 1 point a second, so whoever held it late won 11 of 12
 * simulated matches. Sectors never count (territory does not decide the match, v7.13).
 * - captures ×3, rescues ×3, hits on a king ×2
 * - people still free at the end ×2; a king still in a jail −10
 * - the tower: 1 point per 15 s held
 */
export function scoreBreakdown(state: GameState, n: NationId): { label: string; pts: number }[] {
  const s = state.natStats[n];
  const free = state.entities.filter((e) => e.nation === n && e.alive && !e.jailed).length;
  const kingJailed = state.entities.some((e) => e.nation === n && e.role === 'king' && e.alive && e.jailed);
  return [
    { label: '捕獲', pts: s.cap * 3 },
    { label: '救出', pts: s.res * 3 },
    { label: '王への攻撃', pts: s.hit * 2 },
    { label: '生存', pts: free * 2 },
    { label: '管制塔', pts: Math.floor(s.tower / 15) },
    { label: '王が牢屋', pts: kingJailed ? -10 : 0 },
  ];
}

export function nationScore(state: GameState, n: NationId): number {
  return scoreBreakdown(state, n).reduce((a, b) => a + b.pts, 0);
}

/** Time-up: a sole surviving king wins, otherwise the best score among survivors (ties draw). */
export function forceEndByTime(state: GameState): void {
  if (state.over) return;
  const aliveN = aliveKingNations(state);
  if (aliveN.length === 1) { endGame(state, aliveN[0]); return; }
  let best: NationId | null = null, bs = -1;
  for (const n of aliveN) { const s = nationScore(state, n); if (s > bs) { bs = s; best = n; } }
  const tie = aliveN.filter((n) => nationScore(state, n) === bs);
  endGame(state, tie.length === 1 && best ? best : 'draw');
}
