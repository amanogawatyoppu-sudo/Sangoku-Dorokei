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

import { BASE_SITES, JAIL_SITES } from './map';

const jail = (n: NationId) => ({ ...JAIL_SITES[n], w: 240, d: 60 });

/** SOL (太陽陣営) = 新宿, LUNA (月陣営) = 上野, STAR (星陣営) = 高輪 (品川). Positions come from config/map.ts. `name` is what players see (see config/terminology.ts). */
export const NATIONS: Record<NationId, Nation> = {
  sun: { name: 'SOL', emblem: '\u2600\uFE0E', color: 0xff9048, base: BASE_SITES.sun, jail: jail('sun') },
  moon: { name: 'LUNA', emblem: '\u263E\uFE0E', color: 0x57a8ff, base: BASE_SITES.moon, jail: jail('moon') },
  star: { name: 'STAR', emblem: '\u2605\uFE0E', color: 0xf5e05a, base: BASE_SITES.star, jail: jail('star') },
};

export function nationName(n: NationId): string {
  return NATIONS[n].name;
}

export function nationCss(n: NationId): string {
  return '#' + NATIONS[n].color.toString(16).padStart(6, '0');
}
