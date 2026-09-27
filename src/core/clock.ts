/** Simulation rate. Matches the ~60fps frame cadence v6 was tuned at. */
export const SIM_HZ = 60;
export const STEP_MS = 1000 / SIM_HZ;
export const STEP_SEC = 1 / SIM_HZ;
/** v6 clamped a frame to 50ms of simulation; keep the same catch-up limit. */
export const MAX_STEPS_PER_FRAME = 3;

/**
 * Converts variable real frame durations into fixed simulation steps.
 * Game time itself lives in `GameState.time` and only moves when a step runs,
 * so every timer freezes whenever steps stop (meetings, game over, hidden tab).
 */
export class FixedStepClock {
  private accumulator = 0;

  /** Returns how many fixed steps should run for this frame. */
  consume(frameMs: number): number {
    this.accumulator += Math.max(0, frameMs);
    let steps = Math.floor(this.accumulator / STEP_MS);
    if (steps > MAX_STEPS_PER_FRAME) {
      steps = MAX_STEPS_PER_FRAME;
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * STEP_MS;
    }
    return steps;
  }

  /** Fraction of a step not yet simulated, for render interpolation. */
  get alpha(): number {
    return Math.min(1, this.accumulator / STEP_MS);
  }

  reset(): void {
    this.accumulator = 0;
  }
}
