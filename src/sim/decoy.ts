import type { NationId } from '../config/nations';
import type { Entity } from './entity';
import type { GameState } from './state';
import { emit } from './state';

/**
 * 影武者 (the king's double), once per match: the king names the nearest free ally
 * (within 800) as its double for 30 s. Meanwhile the escorts screen the double, the
 * enemy commanders take the double for the king and forget the real one, and the
 * tower's light falls on the double.
 */
export const DECOY_TIME = 30000;
const DECOY_RANGE = 800;

/** The nation's double right now, if any. */
export function decoyOf(state: GameState, n: NationId): Entity | null {
  const d = state.decoy[n];
  if (!d || d.until <= state.time) return null;
  const e = state.entities[d.id];
  return e.alive && !e.jailed ? e : null;
}

export function canUseDecoy(state: GameState, king: Entity): boolean {
  return king.role === 'king' && king.alive && !king.jailed && !state.decoyUsed[king.nation] && !state.over;
}

export function useDecoy(state: GameState, king: Entity): boolean {
  if (!canUseDecoy(state, king)) return false;
  const double = state.entities
    .filter((e) => e.nation === king.nation && e !== king && e.alive && !e.jailed && Math.hypot(e.x - king.x, e.z - king.z) < DECOY_RANGE)
    .sort((a, b) => Math.hypot(a.x - king.x, a.z - king.z) - Math.hypot(b.x - king.x, b.z - king.z))[0];
  if (!double) { emit(state, { type: 'DECOY_FAILED', kingId: king.id }); return false; }
  state.decoyUsed[king.nation] = true;
  state.decoy[king.nation] = { id: double.id, until: state.time + DECOY_TIME };
  // The enemies' suspicion moves to the double.
  for (const n of ['sun', 'moon', 'star'] as NationId[]) {
    if (n === king.nation) continue;
    const f = state.factions[n];
    const was = f.belief.get(king.id) ?? 0;
    f.belief.set(king.id, 0);
    f.belief.set(double.id, Math.max(was, 3, f.belief.get(double.id) ?? 0));
    const seen = f.intel.get(king.id);
    if (seen) { f.intel.delete(king.id); f.intel.set(double.id, { ...seen, id: double.id, x: double.x, y: double.y, z: double.z }); }
  }
  emit(state, { type: 'DECOY', kingId: king.id, doubleId: double.id });
  return true;
}
