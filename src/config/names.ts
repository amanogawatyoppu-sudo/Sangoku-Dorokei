/** Given names for the AI characters (shown in meetings and the squad panel). Same on every device. */
const NAMES = [
  '源太', '小春', '弥助', '千代', '新八', 'りん', '勘兵衛', 'さくら', '十兵衛', '葵', '吉次', '小雪', '太一', '楓', '権六', 'おとめ',
  '清十郎', '菊', '半蔵', '静', '與一', 'はな', '左近', '初音', '平助', 'あやめ', '宗介', '柚', '伊織', '琴', '藤吉', '桔梗',
  '又兵衛', '結', '竜之介', '夕霧', '三郎', '紅葉', '松之助', '朝顔', '仁吉', '雛', '孫市', '椿', '文五郎', '若菜',
] as const;

export function nameOf(id: number): string {
  return NAMES[(id * 17 + 5) % NAMES.length];
}
