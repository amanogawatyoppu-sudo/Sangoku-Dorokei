import type { FixedStepClock } from '../core/clock';
import { STEP_SEC } from '../core/clock';
import { updateMeeting } from '../meeting/meetingSystem';
import type { GameState } from './state';
import { stepSimulation } from './step';

/**
 * Runs the simulation for one rendered frame. Returns the number of fixed
 * steps executed. No steps run while a meeting is open or after the game ends,
 * so game time (and every timer derived from it) is frozen then; an open
 * meeting only advances its own real-time auto-close countdown.
 */
export function advanceFrame(state: GameState, clock: FixedStepClock, frameMs: number): number {
  if (state.meeting) updateMeeting(state, frameMs);
  if (state.over || state.meeting) {
    clock.reset();
    return 0;
  }
  const steps = clock.consume(frameMs);
  for (let i = 0; i < steps && !state.over && !state.meeting; i++) stepSimulation(state, STEP_SEC);
  return steps;
}
