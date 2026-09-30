/** Given names for the AI characters (shown in meetings and the squad panel). Same on every device. */
/** Call names for the near-future Tokyo of TRI//TRACE (v8.0: modern names instead of old-era ones; 46 as before). */
const NAMES = [
  'ハヤト', 'ミオ', 'レン', 'ユイ', 'ソウタ', 'アオイ', 'カイ', 'サクラ', 'リク', 'ヒナ', 'シン', 'ツムギ', 'ユウマ', 'カエデ', 'ジン', 'ノア',
  'トウマ', 'ミヅキ', 'ケイ', 'シズク', 'アキラ', 'ハナ', 'ナギ', 'イロハ', 'タクミ', 'アヤメ', 'ソラ', 'ユズ', 'イオリ', 'コト', 'ダイチ', 'リオ',
  'ゲン', 'ユナ', 'リュウ', 'セナ', 'ミナト', 'モミジ', 'コウ', 'アサヒ', 'ジュン', 'ヒヨリ', 'ハル', 'ツバキ', 'レイジ', 'ワカナ',
] as const;

export function nameOf(id: number): string {
  return NAMES[(id * 17 + 5) % NAMES.length];
}
