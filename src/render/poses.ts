import type { BoneName } from './humanModel';

/** Target rotations (x, y, z) per bone for this frame; missing = rest. */
export type Pose = Partial<Record<BoneName, [number, number, number]>>;

/** A whole-body pose: bone rotations, how far the hips drop (units), and a sideways sway of the root. */
export interface BodyPose {
  pose: Pose;
  hipsY: number;
  rootZ: number;
}

/*
 * Poses that hold the body still (made for the v9 operator body: hips 23 units
 * up, thighs and shins about 10 each). Rotations are about each bone's own joint;
 * +x on a thigh swings the leg back, -x forward; +x on a shin folds the knee.
 */

/** 体育座り in jail: sitting on the ground, hugging the knees, looking round now and then. */
export function jailPose(t: number): BodyPose {
  const look = Math.sin(t * 0.4) * 0.35;
  return {
    hipsY: -15.35,
    rootZ: 0,
    pose: {
      hips: [-0.12, 0, 0],
      spine: [0.16, 0, 0],
      chest: [0.08, 0, 0],
      neck: [0.05, look * 0.4, 0],
      head: [0.18 + Math.sin(t * 0.9) * 0.03, look * 0.6, 0],
      thighL: [-2.05, 0, 0.1], thighR: [-2.05, 0, -0.1],
      shinL: [2.35, 0, 0], shinR: [2.35, 0, 0],
      footL: [-0.3, 0, 0], footR: [-0.3, 0, 0],
      // Arms round the knees: out and forward, forearms folded in across the shins.
      armL: [-1.05, 0.2, 0.32], armR: [-1.05, -0.2, -0.32],
      foreL: [-0.55, 0, -0.85], foreR: [-0.55, 0, 0.85],
    },
  };
}

/** Kneeling at a lock (or the tower terminal), both hands busy at chest height. */
export function lockPose(t: number): BodyPose {
  const w = Math.sin(t * 9) * 0.12;
  return {
    hipsY: -6.9,
    rootZ: 0,
    pose: {
      spine: [0.32, 0, 0],
      chest: [0.1, 0, 0],
      head: [0.22, 0, 0],
      // Right knee down, left foot planted.
      thighL: [-1.25, 0, 0.12], shinL: [1.3, 0, 0], footL: [-0.05, 0, 0],
      thighR: [-0.2, 0, -0.1], shinR: [1.75, 0, 0], footR: [0.45, 0, 0],
      armL: [-1.35 + w, 0, -0.28], armR: [-1.35 - w, 0, 0.28],
      foreL: [-0.45, 0, 0], foreR: [-0.45, 0, 0],
    },
  };
}

/** Stunned (狙撃): knees buckling, swaying on the spot, the big head lolling in a slow circle, arms hanging loose. */
export function stunPose(t: number): BodyPose {
  const a = t * 3.2;
  const sway = Math.sin(a), roll = Math.cos(a);
  return {
    hipsY: -0.8 + Math.sin(t * 6.4) * 0.25,
    // The feet stay planted: the sway is in the body, the whole figure tilts only a little.
    rootZ: sway * 0.03,
    pose: {
      spine: [0.12, 0, sway * 0.16],
      chest: [0.04, 0, 0],
      neck: [0, 0, 0],
      head: [0.1 + roll * 0.12, sway * 0.18, sway * 0.26],
      thighL: [-0.42, 0, 0.18], thighR: [-0.3, 0, -0.16],
      shinL: [0.7, 0, 0], shinR: [0.55, 0, 0],
      footL: [-0.28, 0, -0.1], footR: [-0.25, 0, 0.1], // flat on the ground
      armL: [0.12 + roll * 0.12, 0, 0.42], armR: [0.08 - roll * 0.12, 0, -0.42],
      foreL: [-0.3, 0, 0], foreR: [-0.3, 0, 0],
    },
  };
}
