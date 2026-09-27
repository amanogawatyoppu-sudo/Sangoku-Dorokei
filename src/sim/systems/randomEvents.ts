import { LEAK_EVENT_TIME, SPEED_EVENT_TIME } from '../../config/constants';
import type { RandomEventKind } from '../events';
import type { GameState } from '../state';
import { emit } from '../state';
import { freeFromJail } from './jail';

const KINDS: readonly RandomEventKind[] = ['speed', 'jailbreak', 'leak'];

export function eventTick(state: GameState): void {
  const now = state.time;
  if (now < state.nextEventAt) return;
  state.nextEventAt = now + 30000 + state.rng() * 20000;
  const kind = KINDS[Math.floor(state.rng() * 3)];
  if (kind === 'speed') {
    state.speedBoostUntil = now + SPEED_EVENT_TIME;
    emit(state, { type: 'RANDOM_EVENT', kind });
  } else if (kind === 'jailbreak') {
    let n = 0;
    for (const e of state.entities) if (e.jailed) { freeFromJail(e); n++; }
    emit(state, { type: 'RANDOM_EVENT', kind, count: n });
  } else {
    state.radarAll = now + LEAK_EVENT_TIME;
    emit(state, { type: 'RANDOM_EVENT', kind });
  }
}
