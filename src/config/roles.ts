export type RoleId = 'king' | 'soldier' | 'sniper' | 'communicator' | 'keyholder' | 'impostor';
export type KingPersona = 'cautious' | 'aggressive' | 'lurker' | 'commander';
export type Persona = 'cautious' | 'aggressive' | 'analytical' | 'trickster';

export const ROLES: readonly RoleId[] = ['king', 'soldier', 'sniper', 'communicator', 'keyholder', 'impostor'];

export const ROLE_INFO: Record<RoleId, { n: string; d: string }> = {
  king: { n: '王', d: '目的:生き延びる。強み:捕獲回避能力。弱み:捕まると牢屋処刑で即敗北。おすすめ:目立たぬよう時々前線にも出て正体を隠そう。' },
  soldier: { n: '兵士', d: '目的:前線で戦い王を守る。強み:捕獲に3回耐える。弱み:情報収集力なし。おすすめ:広場や街道で敵を迎撃、孤立しないこと。' },
  sniper: { n: '狙撃手', d: '目的:遠距離支援。強み:前方の敵を一時スタン(射線必要)。弱み:連射不可・接近戦は弱い。おすすめ:高台(西/東の丘)で待ち構えよう。' },
  communicator: { n: '通信士', d: '目的:情報戦の要。強み:管制塔占領が最速、レーダー取得。弱み:単体では非力。おすすめ:管制塔死守、危険を感じたら即撤退。' },
  keyholder: { n: '鍵使い', d: '目的:味方の救出。強み:敵牢屋を解錠。弱み:解錠中は無防備。おすすめ:護衛と一緒に敵陣へ、王の救出は特に慎重に。' },
  impostor: { n: '詐欺師', d: '目的:潜入と攪乱。強み:一定時間他国のふりができる、会議で誤誘導も可能。弱み:捕獲行動で正体露見、戦闘力は低い。おすすめ:偽装中に敵陣を観察しよう。' },
};

export const KING_PERSONAS: readonly KingPersona[] = ['cautious', 'aggressive', 'lurker', 'commander'];
export const PERSONAS: readonly Persona[] = ['cautious', 'aggressive', 'analytical'];

/** Special-ability cooldowns in seconds (v6 values). */
export const SPECIAL_CD = {
  king: 15,
  soldier: 18,
  sniper: 8,
  communicator: 10,
  impostor: 14,
  keyholderRescue: 2.5,
  keyholderKingRescue: 5,
} as const;

export const CAPTURE_CD = 1.1;
export const KING_DODGE_CD = 15;

export function roleName(r: RoleId): string {
  return ROLE_INFO[r]?.n ?? r;
}
