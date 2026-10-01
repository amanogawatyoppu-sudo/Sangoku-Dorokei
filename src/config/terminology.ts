import type { NationId } from './nations';
import type { RoleId } from './roles';

/**
 * TRI//TRACE : TOKYO — every player-facing name in one place (v8.0).
 *
 * The code keeps its original identifiers (nations sun / moon / star, roles king /
 * soldier / …, events KING_CAPTURED …, "jail" for the lock points): only what the
 * player reads comes from here, so the words stay the same on every screen.
 */

export const GAME = {
  title: 'TRI//TRACE : TOKYO',
  logo: 'TRI//TRACE',
  logoSub: 'TOKYO',
  catch: '3勢力。9戦区。敵のANCHORを追え。',
  sub: '東京を駆け、痕跡を追い、敵勢力の中枢をLOCKせよ。',
  /** The long introduction (title screen, README). */
  intro: [
    '東京・山手線内は9つの戦区に分断された。',
    'SOL、LUNA、STAR。3勢力は前線を奪い合いながら、敵部隊に隠されたANCHORを追う。',
    '戦況を読み、痕跡を追跡し、敵の背後を取れ。ANCHORをLOCKし、東京の戦線を制圧せよ。',
  ],
} as const;

/** The three factions (内部 id: sun / moon / star). Symbols and colours are unchanged. */
export const FACTIONS: Record<NationId, { code: string; ja: string }> = {
  sun: { code: 'SOL', ja: '太陽陣営' },
  moon: { code: 'LUNA', ja: '月陣営' },
  star: { code: 'STAR', ja: '星陣営' },
};

/** "SOL" — the short name used in running text, logs and banners. */
export const fac = (n: NationId): string => FACTIONS[n].code;
/** "SOL / 太陽陣営" — where there is room (setup, results). */
export const facFull = (n: NationId): string => `${FACTIONS[n].code} / ${FACTIONS[n].ja}`;
/** "太陽陣営". */
export const facJa = (n: NationId): string => FACTIONS[n].ja;

/** Roles (内部 id in brackets): code name shown everywhere, Japanese reading / job underneath. */
export const ROLE_TERMS: Record<RoleId, { code: string; ja: string; brief: string }> = {
  king: { code: 'ANCHOR', ja: 'アンカー', brief: '正体を隠して生き延びろ。LOCKされたら勢力の危機' },
  soldier: { code: 'VANGUARD', ja: '前衛', brief: '前線で戦い、戦区とANCHORを守れ' },
  sniper: { code: 'SPOTTER', ja: '観測手', brief: '高所から敵を観測し、遠くから動きを止めろ（Z）' },
  communicator: { code: 'RELAY', ja: '中継手', brief: '管制塔を押さえ、レーダーで戦況を共有しろ（Z）' },
  keyholder: { code: 'BREAKER', ja: '解除士', brief: 'LOCK POINTの仲間のそばでZ。拘束を解除して解放しろ' },
  ranger: { code: 'RUNNER', ja: '遊撃手', brief: '走って追跡・救援に駆けつけろ。Zで疾走' },
};

/** The world's words. */
export const T = {
  faction: '勢力',
  myFaction: '自勢力',
  enemyFaction: '敵勢力',
  myTerritory: '自勢力圏',
  enemyTerritory: '敵勢力圏',
  anchor: 'ANCHOR',
  anchorJa: 'アンカー',
  anchorSuspect: 'ANCHOR候補',
  /** The core action (was 捕獲): take someone's back and lock them. */
  trace: 'TRACE',
  traceHint: '敵の背後から実行',
  /** Where the traced are held (was 牢屋). */
  lockPoint: 'LOCK POINT',
  /** Freeing someone from a lock point (was 救出). */
  release: '解放',
  /** A member held too long drops out of the match (was 処刑). */
  dropOut: '戦線離脱',
  /** An ANCHOR held too long: the faction's network goes down (was 王の処刑・滅亡). */
  linkSever: 'LINK SEVER',
  linkSevered: 'LINK SEVERED',
  networkLost: 'NETWORK LOST',
  networkSecured: 'NETWORK SECURED',
  anchorLocked: 'ANCHOR LOCKED',
  anchorReleased: 'ANCHOR RELEASED',
  truce: 'TRUCE',
  truceJa: '一時停戦',
  /** The ANCHOR's one-time stand-in (was 影武者). */
  decoy: 'DECOY',
  decoyJa: '身代わり',
  /** Lighting up the enemy ANCHORs from the tower (last third). */
  scan: 'ANCHOR SCAN',
  strategy: '作戦方針',
} as const;

/** District codenames by sector id (新宿, 渋谷, 池袋, 文京, 上野, 秋葉原, 中央, 東京タワー, 品川). */
export const DISTRICT_CODES = [
  'VERTICAL CITY', 'NEON MAZE', 'ROOFTOP NETWORK', 'QUIET SLOPES', 'GREEN HEIGHTS',
  'ELECTRIC GRID', 'CONTROL CORE', 'RED HEIGHT', 'FUTURE GATEWAY',
] as const;
