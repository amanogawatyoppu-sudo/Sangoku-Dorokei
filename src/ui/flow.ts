import type { CpuLevel } from '../ai/difficulty';
import { CPU_LEVELS, CPU_LEVEL_NAME } from '../ai/difficulty';
import type { NationId } from '../config/nations';
import { NATIONS, NATION_IDS } from '../config/nations';
import type { RoleId, RosterSize } from '../config/roles';
import { ROLES, ROSTER_SIZES, roleName } from '../config/roles';

/**
 * The game's screens and how you move between them:
 * TITLE → (プレイする) SETUP → (ゲームスタート！) PLAYING → RESULT → (もう一度 / 設定を変更 / タイトル)
 * TITLE → (チュートリアル) TUTORIAL → (タイトルへ / そのままプレイ)
 * TITLE → (用語・戦場マップ) GUIDE → (← タイトル) TITLE
 * Pure logic (no DOM), so it can be tested; the screens follow `screen`.
 */
export type AppScreen = 'TITLE' | 'SETUP' | 'GUIDE' | 'TUTORIAL' | 'PLAYING' | 'RESULT';
export type GameMode = 'cpu' | 'online';

export interface Settings {
  nation: NationId | null;
  role: RoleId | null;
  size: RosterSize;
  cpu: CpuLevel;
  mode: GameMode;
}

export const DEFAULT_SETTINGS: Settings = { nation: null, role: null, size: 10, cpu: 'normal', mode: 'cpu' };

export type FlowEvent =
  | { type: 'PLAY' }
  | { type: 'TUTORIAL' }
  | { type: 'GUIDE' }
  | { type: 'TITLE' }
  | { type: 'START' }
  | { type: 'GAME_OVER' }
  | { type: 'RETRY' }
  | { type: 'CHANGE_SETTINGS' }
  | { type: 'TUTORIAL_PLAY' };

/** What must happen besides changing screen. */
export type FlowEffect = 'none' | 'startMatch' | 'startTutorial' | 'reload';

export interface FlowResult { screen: AppScreen; effect: FlowEffect }

/** What is still missing before a CPU match can start (empty = ready). Online starts come from the room. */
export function missing(s: Settings): string[] {
  const out: string[] = [];
  if (!s.nation) out.push('所属勢力');
  if (!s.role) out.push('役職');
  if (!ROSTER_SIZES.includes(s.size)) out.push('プレイ人数');
  if (!CPU_LEVELS.includes(s.cpu)) out.push('CPUレベル');
  return out;
}

export function canStart(s: Settings): boolean {
  return s.mode === 'cpu' && missing(s).length === 0;
}

/**
 * The next screen for an event. Coming back from a match or the tutorial reloads the
 * page (the 3D city is built once per page) and lands on the screen it names.
 */
export function next(screen: AppScreen, ev: FlowEvent, s: Settings): FlowResult {
  const stay = { screen, effect: 'none' as const };
  switch (ev.type) {
    case 'PLAY': return screen === 'TITLE' ? { screen: 'SETUP', effect: 'none' } : stay;
    case 'TUTORIAL': return screen === 'TITLE' ? { screen: 'TUTORIAL', effect: 'startTutorial' } : stay;
    case 'GUIDE': return screen === 'TITLE' ? { screen: 'GUIDE', effect: 'none' } : stay;
    case 'TITLE':
      if (screen === 'SETUP' || screen === 'GUIDE') return { screen: 'TITLE', effect: 'none' };
      if (screen === 'RESULT' || screen === 'TUTORIAL') return { screen: 'TITLE', effect: 'reload' };
      return stay;
    case 'START': return screen === 'SETUP' && canStart(s) ? { screen: 'PLAYING', effect: 'startMatch' } : stay;
    case 'GAME_OVER': return screen === 'PLAYING' ? { screen: 'RESULT', effect: 'none' } : stay;
    case 'RETRY':
      // Same settings, straight into a match (an online match needs its room again: the settings screen).
      if (screen !== 'RESULT') return stay;
      return s.mode === 'cpu' && canStart(s) ? { screen: 'PLAYING', effect: 'reload' } : { screen: 'SETUP', effect: 'reload' };
    case 'CHANGE_SETTINGS': return screen === 'RESULT' ? { screen: 'SETUP', effect: 'reload' } : stay;
    case 'TUTORIAL_PLAY': return screen === 'TUTORIAL' ? { screen: canStart(s) ? 'PLAYING' : 'SETUP', effect: 'reload' } : stay;
    default: return stay;
  }
}

/** "太陽国 / 兵士 / 10人 / CPU：標準 / CPU戦" */
export function summary(s: Settings): string[] {
  return [
    s.nation ? NATIONS[s.nation].name : '所属勢力：未選択',
    s.role ? roleName(s.role) : '役職：未選択',
    `${s.size}人`,
    `CPU：${CPU_LEVEL_NAME[s.cpu]}`,
    s.mode === 'cpu' ? 'CPU戦' : '対人戦',
  ];
}

// ---------------------------------------------------------------- persistence

export interface KeyValue { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const SETTINGS_KEY = 'sangoku.settings.v1';
const INTENT_KEY = 'sangoku.intent.v1';

/** Settings from last time (a bad or missing entry gives the defaults). */
export function loadSettings(store: KeyValue | null): Settings {
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      nation: NATION_IDS.includes(v.nation as NationId) ? (v.nation as NationId) : null,
      role: ROLES.includes(v.role as RoleId) ? (v.role as RoleId) : null,
      size: ROSTER_SIZES.includes(v.size as RosterSize) ? (v.size as RosterSize) : DEFAULT_SETTINGS.size,
      cpu: CPU_LEVELS.includes(v.cpu as CpuLevel) ? (v.cpu as CpuLevel) : DEFAULT_SETTINGS.cpu,
      mode: v.mode === 'online' ? 'online' : 'cpu',
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(store: KeyValue | null, s: Settings): void {
  try { store?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage off */ }
}

/** Where to land after a reload (read once). */
export function takeIntent(store: KeyValue | null): AppScreen | null {
  try {
    const v = store?.getItem(INTENT_KEY) ?? null;
    store?.removeItem(INTENT_KEY);
    return v === 'SETUP' || v === 'PLAYING' || v === 'TUTORIAL' || v === 'TITLE' ? v : null;
  } catch { return null; }
}

export function setIntent(store: KeyValue | null, screen: AppScreen): void {
  try { store?.setItem(INTENT_KEY, screen); } catch { /* storage off */ }
}

/** The first screen at start-up: the title, unless a reload asked for another one. */
export function bootScreen(intent: AppScreen | null, s: Settings): AppScreen {
  if (intent === 'PLAYING') return canStart(s) ? 'PLAYING' : 'SETUP';
  if (intent === 'SETUP' || intent === 'TUTORIAL') return intent;
  return 'TITLE';
}
