import { ROLE_INFO, ROLES } from '../config/roles';

/** One entry in 用語集. */
export interface Term {
  term: string;
  /** Reading or English, for search (optional). */
  kana?: string;
  cat: GlossaryCat;
  text: string;
}

export type GlossaryCat = '基本ルール' | '役職' | '戦場' | '行動・操作' | '試合の流れ' | '結果・記録';
export const GLOSSARY_CATS: readonly GlossaryCat[] = ['基本ルール', '役職', '戦場', '行動・操作', '試合の流れ', '結果・記録'];

/** The game's words, as the game actually works (kept in step with the rules in sim/). */
export const GLOSSARY: readonly Term[] = [
  // ---- basic rules
  { term: 'TRI//TRACE : TOKYO', kana: 'とらいとれーす とうきょう', cat: '基本ルール', text: '東京・山手線内の9戦区を舞台に、3勢力が戦う3D追跡ストラテジー。全員が「追う側」でも「追われる側」でもある。敵部隊に隠されたANCHORを推理して追い、背後からTRACEしてLOCK POINTへ拘束する。' },
  { term: '3勢力', kana: 'せいりょく じんえい SOL LUNA ASTER 太陽 月 星', cat: '基本ルール', text: 'SOL / 太陽陣営（新宿）・LUNA / 月陣営（上野）・ASTER / 星陣営（高輪）。同じ勢力は味方、ほかの2勢力は敵。勢力の色（SOL＝橙、LUNA＝青、ASTER＝黄）が服の布と背中の紋でわかる。' },
  { term: '勝利条件', kana: 'しょうり かち NETWORK SECURED', cat: '基本ルール', text: '敵勢力のANCHORをLOCKし、時間内に解放されなければその勢力はNETWORK LOST（戦線離脱）。最後までネットワークを保った勢力がNETWORK SECURED（勝利）。5分経っても複数のANCHORが健在なら「戦功ポイント」で決まる。' },
  { term: 'TRACE', kana: 'とれーす 捕獲 ほかく 背後', cat: '基本ルール', text: '敵の背後から相手を拘束する基本アクション。敵に近づいて Space（スマホは「TRACE」）。正面からはできない。真後ろなら確実、斜め後ろは 15%、横は 50% の確率で失敗する。足元の輪が緑ならTRACEできる相手。' },
  { term: 'ANCHOR候補', kana: 'あんかーこうほ 推理 すいり', cat: '基本ルール', text: '敵のANCHORは普通のメンバーに紛れていて誰か分からない。「周りにVANGUARDが集まっていた」「戦闘が始まると一人だけ前線から離れた」「救援が集中した」などの痕跡から推理する。会議でも共有できる。' },
  { term: '背中', kana: 'せなか はいご', cat: '基本ルール', text: 'TRACEは後ろからしかできないので、背中を取られないことが一番大事。カメラは常に自分の背後にあり背中側は見えない。Q で振り向いて確かめよう。' },
  { term: 'LOCK POINT', kana: 'ろっくぽいんと 拘束 こうそく ろうや', cat: '基本ルール', text: 'TRACEされた人は、TRACEした勢力のLOCK POINTへ拘束され動けなくなる。ANCHORは 80 秒、ほかは 50 秒で時間切れ。それまでに仲間が来れば解放できる。ANCHORが拘束されたLOCK POINTは 45 秒間、全勢力に位置が知られる。' },
  { term: 'NETWORK LOST', kana: 'ねっとわーくろすと 戦線離脱 せんせんりだつ LINK SEVER', cat: '基本ルール', text: 'LOCK POINTで時間が切れたメンバーは戦線離脱し、その試合から外れる（幽霊になって観戦できる）。ANCHORの時間が切れるとリンクが切断（LINK SEVERED）され、その勢力はNETWORK LOST。全員が戦線離脱する。' },
  { term: '解放', kana: 'かいほう 解除 かいじょ BREAKER たすける', cat: '基本ルール', text: 'LOCK POINTの仲間のすぐそばで Z を押し続けて拘束を解除する。できるのはBREAKER・ANCHOR・「最後の一人」。BREAKER以外は 1.5 倍時間がかかり、ANCHORの解放は特に長い。離れたりスタンすると失敗。' },
  { term: '最後の一人', kana: 'さいごのひとり', cat: '基本ルール', text: '勢力で動ける（拘束されていない）のが自分だけになると、役職に関係なく拘束を解除できるようになる。バナーで知らされる。' },
  { term: '戦功ポイント', kana: 'せんこう じかんぎれ', cat: '基本ルール', text: '時間切れでANCHORが複数健在のときの勝敗判定。TRACE×3・解放×3・ANCHORへの攻撃×2・生き残り×2・管制塔 15 秒ごとに 1・自勢力のANCHORが拘束中だと −10。戦区（勢力圏）は数えない。' },
  // ---- roles
  ...ROLES.map((r): Term => ({ term: ROLE_INFO[r].n, kana: r, cat: '役職', text: ROLE_INFO[r].d })),
  { term: 'スーパーハンド', kana: 'すーぱーはんど ANCHOR', cat: '役職', text: 'ANCHORだけの力。正面からでも、どの向きからでも確実にTRACEできる。' },
  { term: 'DECOY', kana: 'でこい 身代わり みがわり かげむしゃ', cat: '役職', text: 'ANCHORだけ・1 試合 1 回（F か上部のボタン）。近く（約 30 m）の味方を 30 秒間、ANCHORの身代わりにする。護衛・敵の疑い・ANCHOR SCANの光がDECOYに向く。' },
  { term: 'スタン', kana: 'すたん 狙撃 SPOTTER', cat: '役職', text: 'SPOTTERに撃たれると 3 秒間動けない（頭の上を星が回る）。その間に近くの敵にTRACEされやすい。敵のSPOTTERに狙われると赤いレーザーが見える。' },
  // ---- battlefield
  { term: '戦区', kana: 'せんく', cat: '戦場', text: '東京（山手線の内側）を 9 つに分けた地域。勢力ごとに最初から持っている戦区があり、文京と中央は中立。戦区は勝敗を直接は決めないが、各勢力の作戦は戦区の奪い合いを中心に動き、ANCHORは自勢力圏の奥にいることが多い。' },
  { term: '戦略拠点', kana: 'せんりゃくきょてん 拠点 旗', cat: '戦場', text: '各戦区にひとつある旗の立つ場所。画面の紋章マーカーで場所と持ち主がわかる。輪の中に立ち続けると制圧ゲージがたまる。' },
  { term: '制圧', kana: 'せいあつ ゲージ', cat: '戦場', text: '1勢力だけで拠点の輪に立ち続けると制圧ゲージが進む（1 人で 10 秒、人数が多いほど速い）。満タンでその戦区が自勢力圏に。持ち主が立つとゲージが戻る。' },
  { term: '交戦中', kana: 'こうせんちゅう contested', cat: '戦場', text: '拠点の輪に複数の勢力がいる状態。ゲージは止まる。マーカーが点滅する。' },
  { term: '前線', kana: 'ぜんせん', cat: '戦場', text: '違う勢力の戦区が接する境目。ミニマップの赤い線、街の光る線で見える。戦区を取り合うたびに動き、2勢力がぶつかる隙を3つ目の勢力が突く「漁夫の利」も起きる。' },
  { term: '勢力圏の幟', kana: 'のぼり 勢力圏', cat: '戦場', text: '街灯や建物の正面の幟の色が、その戦区を持っている勢力の色。' },
  { term: '管制塔', kana: 'かんせいとう タワー', cat: '戦場', text: '中央戦区・日比谷公園の電波塔。足元に1勢力だけで 3 秒立つと占領（RELAYがいると速い）。持っている勢力はRELAYのレーダーが使え、試合の最後の 3 分の 1 ではANCHOR SCANで敵のANCHORを照らせる。' },
  { term: 'レーダー', kana: 'れーだー RELAY', cat: '戦場', text: 'RELAYが管制塔の足元で Z。7 秒間、敵の位置が見える。' },
  { term: 'ANCHOR SCAN', kana: 'あんかーすきゃん ビーコン 光の柱', cat: '戦場', text: '残り 1:40 を切ると、管制塔を持つ勢力は B（上部のボタン）で敵勢力のANCHORの位置を 12 秒間、金色の光の柱で照らせる。再使用 40 秒。照らされた側にも知らされる。' },
  { term: '勢力の拠点', kana: 'きょてん 本拠地', cat: '戦場', text: '各勢力のスタート地点（SOL＝新宿三丁目、LUNA＝上野広小路、ASTER＝高輪）。近くで緊急会議を開ける。LOCK POINTもその近くにある。' },
  { term: '夜', kana: 'よる 街灯', cat: '戦場', text: '試合は夕暮れに始まり、約 1:45 から暗くなる。夜は遠くが見えにくい（終盤は昼の 70%）が、街灯の光の輪の中にいる人は遠くからでも見える。' },
  { term: '足跡・足音', kana: 'あしあと あしおと', cat: '戦場', text: '近くを走る敵の足跡が数秒残る。見えないが聞こえる敵の方向は、画面の端に赤い弧で出る。ダッシュ中は足音が大きい。' },
  // ---- actions
  { term: 'ダッシュ', kana: 'だっしゅ スタミナ', cat: '行動・操作', text: 'Shift（スマホは「ダッシュ」）で加速。スタミナを使い、止まると回復する。足音が大きくなり気付かれやすい。' },
  { term: '振り向き', kana: 'ふりむき Q', cat: '行動・操作', text: 'Q（スマホは「振向」）で真後ろを向く。背中を狙う敵を確かめるのに使う。' },
  { term: '特殊', kana: 'とくしゅ Z スキル', cat: '行動・操作', text: 'Z（スマホは「特殊」）で役職ごとの能力。ANCHOR＝回避を強化、VANGUARD＝耐久を全回復、SPOTTER＝狙撃、RELAY＝レーダー（管制塔で）、BREAKER＝拘束の解除、RUNNER＝疾走。' },
  { term: '分隊', kana: 'ぶんたい X C V', cat: '行動・操作', text: 'あなたには 2〜4 人の分隊が付く。X「付いてこい」／C「周りを警戒しろ」（囲んで外側を見張る）／V「ここを守れ」。スマホは「分隊」。' },
  { term: '合図', kana: 'あいず ピン 1 2 3 4', cat: '行動・操作', text: '1〜4 キー（スマホは「合図」）で味方だけに知らせる。1 ここにANCHOR！・2 助けて！・3 ここに集合・4 敵多数！ 14 秒間、光の柱とマーカーで見える。AI の味方も反応する。' },
  { term: 'TRUCE', kana: 'とるーす 一時停戦 ていせん', cat: '行動・操作', text: 'いちばん強い勢力に対抗するため、もう一方の勢力に 45 秒の一時停戦を持ちかけられる（1 試合 2 回）。TRUCE中の2勢力は互いにTRACEしない。' },
  { term: '幽霊', kana: 'ゆうれい 観戦', cat: '行動・操作', text: '戦線離脱したあとの観戦モード。壁を抜けて自由に飛び回れ、全員の姿が見える。' },
  // ---- match flow
  { term: 'ハーフタイム会議', kana: 'かいぎ', cat: '試合の流れ', text: '経過 2:30 に 1 回、勢力ごとに全員が集まる会議（その間は全員停止）。目撃情報を共有してANCHOR候補を推理し、次の重点捜索先に投票する。' },
  { term: '緊急会議', kana: 'きんきゅうかいぎ', cat: '試合の流れ', text: '自勢力の拠点の近くで 1 試合 2 回まで開ける（拠点が一時的に敵に見える代償あり）。オンライン対戦では使えない。' },
  { term: 'CPUレベル', kana: 'しーぴーゆー 難易度', cat: '試合の流れ', text: '初級・標準・上級・超級。変わるのは CPU の判断（気付く速さ・探す長さ・回り込み・連携・作戦）だけで、速さやTRACEの強さは全レベル同じ。' },
  { term: '対人戦', kana: 'たいじんせん オンライン 部屋', cat: '試合の流れ', text: 'ゲーム設定で「対人戦」→「部屋を作る」で出る 5 文字の部屋コードを友達に伝え、友達は同じページで「部屋に参加する」。最大 9 人、残りは CPU。' },
  // ---- results
  { term: '貢献度', kana: 'こうけんど ポイント', cat: '結果・記録', text: '試合での活躍を点数にしたもの（勝敗とは別）。TRACE 100、敵ANCHORへの有効TRACE 150、敵ANCHORのLOCK 500、解放 150、味方ANCHORの解放 500、戦区制圧参加 80、敵戦区の奪取 120、管制塔の占領 100、前線での戦闘、勝利 200 に、役職ごとの加点。CPU も人も同じ計算。' },
  { term: '称号', kana: 'しょうごう', cat: '結果・記録', text: 'リザルトでもらえるひとこと（「ANCHOR HUNTER」「救援のスペシャリスト」「HIGH GROUND」「TRACE MASTER」など）。いちばん目立った活躍から選ばれる。' },
  { term: '通算戦績', kana: 'せんせき', cat: '結果・記録', text: '試合数・勝率・TRACE・解放・連勝などをこのブラウザに保存し、タイトルとリザルトに表示する。' },
];

/** Entries matching a search word (term, reading or text), in a category or all. */
export function searchGlossary(q: string, cat: GlossaryCat | null): Term[] {
  const w = q.trim().toLowerCase();
  return GLOSSARY.filter((t) => (!cat || t.cat === cat) && (!w || (t.term + ' ' + (t.kana ?? '') + ' ' + t.text).toLowerCase().includes(w)));
}
