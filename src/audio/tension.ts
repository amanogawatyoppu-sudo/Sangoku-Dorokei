import type { GameState } from '../sim/state';
import { timeLeftSec } from '../sim/state';
import { visibleTo } from '../sim/systems/vision';

/** How tense the moment is for the music (0 calm … 1 desperate). */
export function tensionOf(state: GameState): number {
  if (state.over || state.meeting) return 0;
  const p = state.player;
  let t = 0.1;
  const near = state.entities.filter((e) => e.nation !== p.nation && e.alive && !e.jailed && Math.hypot(e.x - p.x, e.z - p.z) < 450 && visibleTo(state, e, p)).length;
  if (near) t = Math.max(t, 0.35 + 0.1 * Math.min(4, near));
  if (p.jailed || p.stunUntil > state.time || p.channeling) t = Math.max(t, 0.6);
  if (state.entities.some((e) => e.nation === p.nation && e.role === 'king' && e.jailed)) t = Math.max(t, 0.8);
  const left = timeLeftSec(state);
  if (left < 60) t = Math.max(t, 0.7 + 0.3 * (1 - left / 60));
  return t;
}
