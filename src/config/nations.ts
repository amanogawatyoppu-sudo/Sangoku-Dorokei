export type NationId = 'sun' | 'moon' | 'star';

export interface Point {
  x: number;
  z: number;
}

export interface JailArea extends Point {
  w: number;
  d: number;
}

export interface Nation {
  name: string;
  /** Text glyph used on banners and UI (rendered as text, not emoji). */
  emblem: string;
  color: number;
  base: Point;
  jail: JailArea;
}

/** Iteration order matches v6 (`for (n in NATIONS)`). */
export const NATION_IDS: readonly NationId[] = ['sun', 'moon', 'star'];

export const NATIONS: Record<NationId, Nation> = {
  sun: { name: '太陽', emblem: '\u2600\uFE0E', color: 0xff9048, base: { x: -1560, z: 800 }, jail: { x: -1560, z: 1110, w: 240, d: 60 } },
  moon: { name: '月', emblem: '\u263E\uFE0E', color: 0x57a8ff, base: { x: 1560, z: 800 }, jail: { x: 1560, z: 1110, w: 240, d: 60 } },
  star: { name: '星', emblem: '\u2605\uFE0E', color: 0xf5e05a, base: { x: 0, z: -1030 }, jail: { x: 0, z: -1180, w: 240, d: 60 } },
};

export function nationName(n: NationId): string {
  return NATIONS[n].name;
}

export function nationCss(n: NationId): string {
  return '#' + NATIONS[n].color.toString(16).padStart(6, '0');
}
