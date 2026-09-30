import { ROLE_TERMS } from './terminology';
export type RoleId = 'king' | 'soldier' | 'sniper' | 'communicator' | 'keyholder' | 'ranger';
export type KingPersona = 'cautious' | 'aggressive' | 'lurker' | 'commander';
export type Persona = 'cautious' | 'aggressive' | 'analytical';

export const ROLES: readonly RoleId[] = ['king', 'soldier', 'sniper', 'communicator', 'keyholder', 'ranger'];

/** Characters per nation the player can choose (one king each; the rest scale up). */
export type RosterSize = 6 | 10 | 15;
export const ROSTER_SIZES: readonly RosterSize[] = [6, 10, 15];
export const ROSTERS: Record<RosterSize, readonly RoleId[]> = {
  6: ROLES,
  10: ['king', 'soldier', 'soldier', 'soldier', 'sniper', 'sniper', 'communicator', 'keyholder', 'keyholder', 'ranger'],
  15: ['king', 'soldier', 'soldier', 'soldier', 'soldier', 'soldier', 'ranger', 'sniper', 'sniper', 'sniper', 'communicator', 'communicator', 'keyholder', 'keyholder', 'ranger'],
};

export const ROLE_INFO: Record<RoleId, { n: string; d: string }> = {
  king: { n: 'ANCHOR', d: '勢力の情報・指揮ネットワークを保つ中枢。敵からは誰がANCHORか分からない。目的:生き延びる。強み:TRACE回避能力、正面からでも確実にTRACEできる。1回だけDECOY（身代わり）を立てられる。弱み:LOCKされて時間切れになると勢力のネットワークが切断（NETWORK LOST）。おすすめ:目立たぬよう時々前線にも出て正体を隠そう。' },
  soldier: { n: 'VANGUARD', d: '前衛。目的:前線で戦い、戦区とANCHORを守る。強み:TRACEに3回耐える。弱み:情報収集力なし。おすすめ:広場や街道で敵を迎え撃ち、孤立しないこと。' },
  sniper: { n: 'SPOTTER', d: '観測手。高所から敵を観測し、遠距離から動きを止める。強み:前方±30°・約20m先の敵を撃って3秒スタン（照準が合うと赤いレーザーと照準の輪が出る。外しても装填は減らない）。スコープで前方は遠くまで見え、高所からは射程+25%。弱み:装填8秒・接近戦に弱い・銃でSPOTTERだと知られる。おすすめ:歩道橋・首都高・屋上から待ち構えよう。' },
  communicator: { n: 'RELAY', d: '中継手。情報戦の要。強み:管制塔の確保が最速、レーダーで戦況を共有。弱み:単体では非力。おすすめ:管制塔を守り、危険を感じたらすぐ退こう。' },
  keyholder: { n: 'BREAKER', d: '解除士。目的:LOCK POINTの拘束を解除して味方を解放する。強み:敵のLOCK POINTを解除できる（ANCHORの解放も）。弱み:解除中は無防備。おすすめ:護衛と一緒に敵勢力圏へ。ANCHORの解放は特に慎重に。' },
  ranger: { n: 'RUNNER', d: '遊撃手。目的:追跡・救援・前線移動。強み:スタミナの回復が速く、階段や坂でも速度が落ちにくい。特殊「疾走」で4.5秒間速さとスタミナ回復が上がる（再使用16秒）。弱み:VANGUARDのような耐久力はなく、TRACE性能は普通。おすすめ:逃げた敵を追う、LOCK POINTの攻防や救援に駆けつける、高台を先に取る。' },
};

export const KING_PERSONAS: readonly KingPersona[] = ['cautious', 'aggressive', 'lurker', 'commander'];
export const PERSONAS: readonly Persona[] = ['cautious', 'aggressive', 'analytical'];

/** Special-ability cooldowns in seconds (v6 values). */
export const SPECIAL_CD = {
  king: 15,
  soldier: 18,
  sniper: 8,
  communicator: 10,
  ranger: 16,
  keyholderRescue: 2.5,
  keyholderKingRescue: 5,
} as const;

export const CAPTURE_CD = 1.1;
export const KING_DODGE_CD = 15;

export function roleName(r: RoleId): string {
  return ROLE_INFO[r]?.n ?? r;
}

/** Japanese job name under the code name (アンカー, 前衛, 観測手, 中継手, 解除士, 遊撃手). */
export function roleJa(r: RoleId): string {
  return ROLE_TERMS[r]?.ja ?? '';
}
