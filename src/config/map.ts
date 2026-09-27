import type { Point } from './nations';

export interface Obstacle extends Point {
  w: number;
  d: number;
  h: number;
}

export interface Circle extends Point {
  r: number;
}

export const OBST: readonly Obstacle[] = [
  { x: -300, z: -150, w: 60, d: 400, h: 60 }, { x: 300, z: -150, w: 60, d: 400, h: 60 },
  { x: -650, z: 150, w: 300, d: 70, h: 50 }, { x: 650, z: 150, w: 300, d: 70, h: 50 },
  { x: 0, z: -250, w: 340, d: 60, h: 55 }, { x: -150, z: 450, w: 70, d: 300, h: 55 }, { x: 150, z: 450, w: 70, d: 300, h: 55 },
  { x: -900, z: -150, w: 70, d: 350, h: 45 }, { x: 900, z: -150, w: 70, d: 350, h: 45 },
  { x: -450, z: -500, w: 250, d: 60, h: 40 }, { x: 450, z: -500, w: 250, d: 60, h: 40 },
  { x: 0, z: 220, w: 120, d: 120, h: 45 }, { x: -120, z: -40, w: 55, d: 55, h: 40 }, { x: 120, z: -40, w: 55, d: 55, h: 40 },
  { x: -750, z: 600, w: 260, d: 60, h: 40 }, { x: 750, z: 600, w: 260, d: 60, h: 40 },
  { x: -330, z: 700, w: 60, d: 220, h: 40 }, { x: 330, z: 700, w: 60, d: 220, h: 40 },
  { x: -550, z: -700, w: 60, d: 220, h: 40 }, { x: 550, z: -700, w: 60, d: 220, h: 40 },
  { x: 0, z: 560, w: 400, d: 55, h: 40 },
  { x: -1000, z: 0, w: 55, d: 520, h: 40 }, { x: 1000, z: 0, w: 55, d: 520, h: 40 }, { x: 0, z: -620, w: 700, d: 55, h: 40 },
];

/** Sniper high-ground zones. */
export const SNIPE: readonly Circle[] = [
  { x: -550, z: 0, r: 110 },
  { x: 550, z: 0, r: 110 },
];

export const TOWER: Circle = { x: 0, z: 0, r: 80 };

/** Movement clamp (v6 clampMove). */
export const BOUNDS = { minX: -1050, maxX: 1050, minZ: -650, maxZ: 650 };

export const GROUND = { w: 2400, d: 1400 };
