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

export function nationScore(state: GameState, n: NationId): number {
  const s = state.natStats[n];
  return s.cap * 3 + s.res * 2 + s.tower + s.hit * 2;
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
