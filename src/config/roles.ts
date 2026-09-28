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
  king: { n: '王', d: '目的:生き延びる。強み:捕獲回避能力、スーパーハンド（正面からでも確実に捕まえられる）。弱み:捕まると牢屋処刑で即敗北。おすすめ:目立たぬよう時々前線にも出て正体を隠そう。' },
  soldier: { n: '兵士', d: '目的:前線で戦い王を守る。強み:捕獲に3回耐える。弱み:情報収集力なし。おすすめ:広場や街道で敵を迎撃、孤立しないこと。' },
  sniper: { n: '狙撃手', d: '目的:遠距離支援。強み:ライフルで前方±30°・射程約20mの敵を狙撃し3秒スタン（照準が合うと赤いレーザーと照準の輪が出る。外しても装填は減らない）。スコープで前方は遠くまで見え、高所から撃つと射程+25%。弱み:装填8秒・接近戦は弱い・銃を持つので狙撃手だと知られる。おすすめ:歩道橋・首都高・屋上から待ち構えよう。' },
  communicator: { n: '通信士', d: '目的:情報戦の要。強み:管制塔占領が最速、レーダー取得。弱み:単体では非力。おすすめ:管制塔死守、危険を感じたら即撤退。' },
  keyholder: { n: '鍵使い', d: '目的:味方の救出。強み:敵牢屋を解錠。弱み:解錠中は無防備。おすすめ:護衛と一緒に敵陣へ、王の救出は特に慎重に。' },
  ranger: { n: '遊撃兵', d: '目的:機動・追跡・救援。強み:スタミナの回復が速く、階段や坂でも速度が落ちにくい。特殊「疾走」で4.5秒間速さとスタミナ回復が上がる（再使用16秒）。弱み:兵士のような耐久力はなく、捕獲性能は普通。おすすめ:逃げた敵を追う、牢屋戦や救援に駆けつける、高台を先に取る。' },
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
