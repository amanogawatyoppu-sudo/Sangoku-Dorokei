import type { NationId } from '../config/nations';
import { NATIONS, NATION_IDS } from '../config/nations';
import { roleName } from '../config/roles';
import { nameOf } from '../config/names';
import { JAIL_TIME, KING_JAIL_EXTRA } from '../config/constants';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { timeLeftSec } from '../sim/state';
import { suspStars } from '../sim/systems/suspicion';
import { SECTORS, held, isFrontline, strength } from '../sim/war';

/**
 * Meeting talk (会議の議論): teammates speak in turn about what the nation actually
 * knows and argue over it. Urgent news (our king or friends in a jail) always comes
 * first; after that each meeting picks a few topics from a pool — the war for the
 * sectors, our national strategy, a ceasefire, losses, who did well, the clock, the
 * tower, sightings, the prime suspect, small talk — in a different order, so no two
 * meetings sound alike. Every topic has many phrasings, flavoured by the speaker's
 * temperament, and a line already said in this match is not said again.
 * Pure text from the match state; the meeting reveals it a line at a time.
 */

/** What the nation has seen, prepared by the meeting. */
export interface TalkFacts {
  /** Busiest recent sightings of enemies: nation, place, how many, how long ago, king-likeness. */
  seen: { nation: NationId; place: string; count: number; ageSec: number; king: number }[];
  /** The most suspicious visible enemy and where it is from the speaker's side. */
  suspect: { e: Entity; dir: string } | null;
}

const N = (n: NationId) => NATIONS[n].name;
const label = (m: Entity) => `${nameOf(m.id)}（${roleName(m.role)}）`;
const say = (m: Entity, text: string) => `${label(m)}「${text}」`;

/** Lines already spoken in this match (per game state), so talk does not repeat itself. */
const spoken = new WeakMap<GameState, Set<string>>();

interface Talk {
  state: GameState;
  n: NationId;
  all: Entity[];
  bold: Entity;
  careful: Entity;
  sharp: Entity;
  other: (not: Entity[]) => Entity;
  /** One of the options, preferring ones not yet said this match. */
  pick: (xs: readonly string[]) => string;
  /** Random order. */
  shuffle: <T>(xs: T[]) => T[];
}

function talk(state: GameState, n: NationId): Talk | null {
  const all = state.entities.filter((e) => e.nation === n && e.alive && !e.jailed && !e.isPlayer && !e.remote);
  if (!all.length) return null;
  const said = spoken.get(state) ?? new Set<string>();
  spoken.set(state, said);
  const shuffle = <T>(xs: T[]): T[] => {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(state.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pick = (xs: readonly string[]) => {
    const fresh = xs.filter((x) => !said.has(x));
    const pool = fresh.length ? fresh : xs;
    const x = pool[Math.floor(state.rng() * pool.length)];
    said.add(x);
    return x;
  };
  // Three different people if there are three (a hothead, a worrier, a thinker).
  const order = shuffle(all);
  const taken: Entity[] = [];
  const by = (p: string) => {
    const e = order.find((o) => o.persona === p && !taken.includes(o)) ?? order.find((o) => !taken.includes(o)) ?? order[0];
    taken.push(e);
    return e;
  };
  const bold = by('aggressive'), careful = by('cautious'), sharp = by('analytical');
  const other = (not: Entity[]) => order.find((e) => !not.includes(e)) ?? order[0];
  return { state, n, all, bold, careful, sharp, other, pick, shuffle };
}

/** A quick "yes / hmm / no" from someone other than the speaker, in their own voice. */
function react(t: Talk, speaker: Entity, mood: 'agree' | 'doubt' | 'push'): string {
  const who = mood === 'agree' ? (t.bold !== speaker ? t.bold : t.sharp) : mood === 'doubt' ? (t.careful !== speaker ? t.careful : t.sharp) : (t.bold !== speaker ? t.bold : t.other([speaker]));
  const lines = {
    agree: ['賛成だ。', 'それでいこう。', '異論なし。', 'だな。俺もそう思ってた。', 'いいね、乗った。', '決まりだな。'],
    doubt: ['本当に大丈夫か？', 'ちょっと待って、それは危なくない？', '慎重にいこうよ。', '裏があるかもしれない。', '焦らないほうがいい気がする。', 'うーん…賭けだね。'],
    push: ['考えすぎだ、動こう。', '迷ってる時間がもったいない。', '守ってばかりじゃ勝てないぞ。', 'やるなら今だ。', '臆病風に吹かれるなよ。'],
  }[mood];
  return say(who, t.pick(lines));
}

// ---------------------------------------------------------------- opening

function opening(t: Talk, lead: Entity): string[] {
  const { state, n } = t;
  const mine = strength(state, n);
  const best = Math.max(...NATION_IDS.map((k) => strength(state, k)));
  const worst = Math.min(...NATION_IDS.map((k) => strength(state, k)));
  const pool = mine >= best - 0.01
    ? ['今のところ押してる。油断せずにいこう。', '悪くない流れだ。この勢いを保とう。', 'いい調子だ。だからこそ気を抜くな。', 'うちが一番勢いがある。狙われるのもうちだぞ。']
    : mine <= worst + 0.01
      ? ['正直、苦しい。ここで立て直すぞ。', '押されてる。まずは落ち着こう。', 'このままじゃまずい。知恵を出し合おう。', '劣勢だが、ANCHORが健在な限り負けじゃない。']
      : ['集まったな。手短にいこう。', 'みんな無事か？ 状況を整理しよう。', '時間がない。見たことを順番に話してくれ。', 'よし、揃ったな。報告を頼む。', '一息つこう。まずは情報交換だ。'];
  return [say(lead, t.pick(pool))];
}

// ---------------------------------------------------------------- urgent news

function kingInJail(t: Talk): string[] {
  const { state, n } = t;
  const myKing = state.entities.find((e) => e.nation === n && e.role === 'king');
  if (!myKing?.jailed || !myKing.capturedBy) return [];
  const left = Math.max(0, Math.ceil((myKing.jailedAt + JAIL_TIME + KING_JAIL_EXTRA - state.time) / 1000));
  const c = N(myKing.capturedBy);
  const kh = t.all.find((e) => e.role === 'keyholder');
  return [
    say(t.bold, t.pick([`ANCHORが${c}のLOCK POINTに拘束されてる！ LINK SEVERまであと${left}秒だぞ！`, `大変だ、ANCHORが${c}にLOCKされた！ 残り${left}秒！`, `${c}のLOCK POINTにANCHORがいる。リンク切断まであと${left}秒しかない！`])),
    kh ? say(kh, t.pick(['俺が行く。誰か護衛についてくれ。', '拘束は解ける。ただ見張りが多い、ひとりじゃ無理だ。', '任せろ。解除する間だけ守ってくれ。', '解除に数秒かかる。その間に囲まれたら終わりだ。']))
      : say(t.careful, t.pick(['BREAKERがいない…どうする？', 'BREAKERが残ってない。力ずくで守りを崩すしかない。'])),
    say(t.sharp, t.pick([`全員で${c}のLOCK POINTに向かうしかない。ほかは後回しだ。`, `二手に分かれよう。囮が見張りを引きつけて、本隊が${c}のLOCK POINTへ。`, `${c}も待ち構えてるはずだ。正面からは行くな、回り込め。`])),
  ];
}

function friendsInJail(t: Talk): string[] {
  const { state, n } = t;
  const jailed = state.entities.filter((e) => e.nation === n && e.jailed && e.role !== 'king' && e.capturedBy);
  if (!jailed.length) return [];
  const j = jailed[0];
  const left = Math.max(0, Math.ceil((j.jailedAt + JAIL_TIME - state.time) / 1000));
  return [
    say(t.careful, jailed.length > 1 ? t.pick([`${nameOf(j.id)}たち${jailed.length}人がLOCKされてる。`, `LOCK POINTに${jailed.length}人も取られてる。`])
      : t.pick([`${nameOf(j.id)}が${N(j.capturedBy!)}のLOCK POINTに拘束されてる。あと${left}秒だ。`, `${nameOf(j.id)}がやられた。${N(j.capturedBy!)}のLOCK POINTだ。`])),
    say(t.bold, t.pick(['助けに行こう。放っておけない。', '見張りが薄いうちに取り返そう。', '仲間を見捨てる勢力に勝ちはないぞ。', '解放ついでに見張りもTRACEしてやる。'])),
    ...(t.state.rng() < 0.5 ? [react(t, t.bold, 'doubt')] : []),
  ];
}

// ---------------------------------------------------------------- topics

function sightings(t: Talk, facts: TalkFacts): string[] {
  const out: string[] = [];
  if (!facts.seen.length) {
    const second = t.other([t.careful, t.bold]);
    out.push(say(t.careful, t.pick(['誰か敵を見たか？', '敵の姿、誰か見てない？', '報告できることはある？'])));
    out.push(say(second, t.pick(['いや、見てない。', 'こっちは静かだった。', '足音は聞いたけど、姿は見てない。', '見てない。気味が悪いくらいだ。'])));
    out.push(say(t.bold !== second && t.bold !== t.careful ? t.bold : t.other([second, t.careful]), t.pick(['静かすぎるな…どこかに固まってるんじゃないか。', '隠れてるなら炙り出すまでだ。', '見えないなら、こっちから探しに行くぞ。'])));
    return out;
  }
  const reporters = t.shuffle(t.all);
  facts.seen.slice(0, 2).forEach((g, i) => {
    const who = reporters[i % reporters.length];
    const answer = (pref: Entity, alt: Entity) => (pref !== who ? pref : alt !== who ? alt : t.other([who]));
    const ago = g.ageSec < 5 ? 'ついさっき' : `${Math.round(g.ageSec)}秒くらい前`;
    out.push(say(who, g.count > 1
      ? t.pick([`${g.place}で${N(g.nation)}の${g.count}人組を見た。${ago}だ。`, `${ago}、${g.place}に${N(g.nation)}が${g.count}人いた。`, `${g.place}だ。${N(g.nation)}が${g.count}人でうろついてた。${ago}の話だ。`])
      : t.pick([`${g.place}で${N(g.nation)}のやつをひとり見た。${ago}。`, `${ago}、${g.place}に${N(g.nation)}がひとり。`, `${g.place}で${N(g.nation)}の背中を見かけた。${ago}だ。`])));
    if (g.king >= 2) {
      out.push(say(answer(t.bold, t.sharp), t.pick(['真ん中のやつ、ずっとVANGUARDに囲まれてなかったか？ あれがANCHORだろう。', '護衛の付き方が普通じゃない。ANCHOR候補だ。', 'あの動き、守られてる側の動きだ。ANCHORだな。'])));
      out.push(say(answer(t.careful, t.sharp), t.pick(['囮かもしれない。決めつけるのは早いよ。', 'わざと固まって見せてる可能性もある。', 'ANCHORに見せかけたDECOYってこともある。'])));
      out.push(say(answer(t.sharp, t.bold), t.pick([`でも手がかりはそれしかない。${g.place}は候補に入れよう。`, `確かめる価値はある。${g.place}だ。`])));
    } else if (g.count >= 3) {
      out.push(say(answer(t.bold, t.sharp), t.pick([`${g.count}人もいたなら何か守ってるはずだ。行くべきだ。`, '大所帯だな。ANCHORの護衛か、攻めの本隊か。', 'それだけいれば、どこかに穴がある。'])));
      out.push(say(answer(t.careful, t.sharp), t.pick(['人数が多いなら、こっちも揃えてから行こう。', '待ち伏せかもしれない。気をつけて。', '真正面からぶつかるのは損だよ。'])));
    } else {
      out.push(say(answer(t.careful, t.sharp), t.pick(['ひとりなら偵察か、はぐれただけかも。', 'それだけじゃ何とも言えないな。', 'どっちへ向かってた？ …まあいい、覚えておこう。', 'ひとりで動くのはSPOTTERかRUNNERが多い。気をつけて。'])));
    }
  });
  return out;
}

function suspect(t: Talk, facts: TalkFacts): string[] {
  const s = facts.suspect;
  if (!s) return [];
  const ev = s.e.evidence[0]?.text;
  const stars = suspStars(s.e.susp);
  return [
    say(t.sharp, ev ? t.pick([`${N(s.e.nation)}の、${s.dir}にいたやつ。「${ev}」。${stars >= 3 ? 'かなり怪しい。' : '少し気になる。'}`, `${s.dir}の${N(s.e.nation)}のやつだが、「${ev}」。${stars >= 3 ? 'ANCHORだと思う。' : 'まだ断定はできない。'}`])
      : t.pick([`${N(s.e.nation)}の、${s.dir}にいたやつの動きがおかしい。`, `${s.dir}の${N(s.e.nation)}、妙に周りを気にしてた。`])),
    stars >= 3 ? say(t.bold, t.pick(['同感だ。次に見かけたら後ろを取る。', 'なら狩りに行こう。', '背中を取れば終わりだ。俺がやる。']))
      : say(t.careful, t.pick(['それだけでANCHORとは言えないけど、ANCHOR候補として目は離さないでおこう。', '覚えておく。でも深追いはしないで。', '怪しいのは確かだね。次の情報を待とう。'])),
  ];
}

function tower(t: Talk): string[] {
  const { state, n } = t;
  const owner = state.tower.owner;
  const comm = t.all.find((e) => e.role === 'communicator') ?? t.careful;
  if (owner && owner !== n) {
    return [
      say(comm, t.pick([`管制塔は${N(owner)}に取られてる。レーダーを使われたらこっちが丸見えだ。`, `${N(owner)}が塔を持ってる。こっちの動きは筒抜けだと思ったほうがいい。`, `塔を${N(owner)}に押さえられたままだ。取り返したい。`])),
      say(t.bold, t.pick(['なら取り返そう。', '塔よりANCHOR探しが先だろ。', '塔の守りは薄いはずだ。一気に行ける。'])),
    ];
  }
  if (owner === n) {
    return [say(comm, t.pick(['塔はうちが押さえてる。このまま守りたい。', 'レーダーは使える。敵の位置は任せてくれ。', '塔を持ってるうちは情報で勝てる。']))];
  }
  return [
    say(t.careful, t.pick(['管制塔はまだ誰のものでもない。先に取れば有利だ。', '塔が空いてる。誰か取りに行かない？'])),
    ...(state.rng() < 0.5 ? [say(t.bold, t.pick(['塔なんか後だ。', '取れるなら取っておこう。']))] : []),
  ];
}

/** The war for the sectors: what we hold, where the front is burning, who is strongest. */
function war(t: Talk): string[] {
  const { state, n } = t;
  const mine = held(state, n);
  const out: string[] = [];
  const hot = mine.find((id) => state.war.sectors[id].contested || (state.war.sectors[id].capturer && state.war.sectors[id].capturer !== n));
  if (hot !== undefined) {
    const s = state.war.sectors[hot];
    const foe = s.capturer && s.capturer !== n ? N(s.capturer) : '敵';
    out.push(say(t.bold, t.pick([`${SECTORS[hot].name}が${foe}に攻められてる！`, `${SECTORS[hot].name}の拠点が危ない。${foe}が乗り込んできた。`, `${SECTORS[hot].name}で押し合いになってる。`])));
    out.push(say(t.careful, t.pick([`${SECTORS[hot].name}を落とされたら前線が下がる。守りに人を回そう。`, '戦区を取られても負けにはならない。ANCHORを守るのが先だよ。', `${SECTORS[hot].name}は捨てて、ほかで取り返す手もある。`])));
    return out;
  }
  const strongest = NATION_IDS.slice().sort((a, b) => strength(state, b) - strength(state, a))[0];
  const front = mine.filter((id) => isFrontline(state, id)).map((id) => SECTORS[id].name);
  out.push(say(t.sharp, t.pick([
    `うちの戦区は${mine.length}つ。${front.length ? `前線は${front.slice(0, 2).join('と')}だ。` : '今は前線がない。'}`,
    `支配してるのは${mine.map((id) => SECTORS[id].name).join('・') || 'ゼロ'}。${mine.length >= 3 ? '悪くない。' : '心細いな。'}`,
    strongest === n ? 'いま一番勢いがあるのはうちだ。他の2勢力に狙われるぞ。' : `いちばん勢いがあるのは${N(strongest)}だ。放っておくと手がつけられなくなる。`,
  ])));
  const neutral = SECTORS.findIndex((_s, id) => !state.war.sectors[id].owner);
  if (neutral >= 0 && state.rng() < 0.6) out.push(say(t.bold, t.pick([`${SECTORS[neutral].name}がまだ空いてる。取りに行こう。`, `中立の${SECTORS[neutral].name}、先に押さえたもん勝ちだ。`])));
  else out.push(react(t, t.sharp, state.rng() < 0.5 ? 'agree' : 'doubt'));
  return out;
}

const STRATEGY_TALK: Record<string, string[]> = {
  ATTACK_SECTOR: ['いまの方針は{s}への侵攻だ。', '{s}を取りに行く。VANGUARDとRUNNERは前へ。', '{s}の拠点を落とす。SPOTTERは高いところから援護してくれ。'],
  DEFEND_SECTOR: ['{s}の守りを固める。', 'まずは{s}を守りきる。攻めるのはその後だ。', '{s}を取られるわけにはいかない。'],
  TAKE_TOWER: ['管制塔を取りに行く。', '塔を押さえて、情報で勝つ。'],
  HUNT_KING: ['{s}あたりに敵のANCHORがいるはずだ。探し出す。', '痕跡を追う。{s}を洗うぞ。'],
  RESCUE_KING: ['ANCHORの解放が最優先だ。', '全力でANCHORを取り返す。リンクを切らせるな。'],
  HOLD_KING: ['LOCKした敵のANCHORを、リンクが切れるまで守りきる。LOCK POINTを固めろ。', 'LOCK POINTの守りが最優先。解放に来る部隊を返り討ちにする。'],
  OPPORTUNIST: ['2勢力がやり合ってる隙に漁夫の利を狙う。', '弱ったほうを後ろから突く。'],
  RECOVER: ['いったん立て直す。無理はするな。', '態勢を整える。散らばってる仲間を集めよう。'],
  ALL_OUT: ['拘束を解ける者がもういない。こうなったら敵のANCHORをLOCKするしかない。', '総攻撃だ。{s}あたりを洗って、敵のANCHORを追え。'],
  HOLD_LEAD: ['点では勝ってる。無理に攻めず、TRACEされないことが一番だ。', 'このまま逃げ切る。ANCHORの守りを厚くしろ。'],
};

/** Our national strategy, explained by the king or a commander, and argued over. */
function strategyTalk(t: Talk): string[] {
  const { state, n } = t;
  const st = state.factions[n]?.strategy;
  if (!st) return [];
  const lines = STRATEGY_TALK[st.kind];
  if (!lines) return [];
  const king = t.all.find((e) => e.role === 'king');
  const speaker = king ?? t.sharp;
  const s = st.sector !== null && st.sector !== undefined ? SECTORS[st.sector].name : 'そこ';
  return [
    say(speaker, t.pick(lines).replace('{s}', s)),
    react(t, speaker, st.kind === 'RECOVER' || st.kind === 'DEFEND_SECTOR' ? 'push' : state.rng() < 0.55 ? 'agree' : 'doubt'),
  ];
}

/** A ceasefire in force, or the idea of one against the strongest. */
function truceTalk(t: Talk): string[] {
  const { state, n } = t;
  const now = state.war.truces.find((x) => x.until > state.time && (x.a === n || x.b === n));
  if (now) {
    const partner = now.a === n ? now.b : now.a;
    const left = Math.ceil((now.until - state.time) / 1000);
    return [
      say(t.careful, t.pick([`${N(partner)}とはTRUCE中だ。あと${left}秒は手を出すな。`, `一時停戦はあと${left}秒。${N(partner)}とは揉めないように。`])),
      say(t.bold, t.pick([`TRUCEが切れた瞬間、${N(partner)}も敵に戻る。忘れるなよ。`, '停戦中に稼げるだけ稼ごう。', `${N(partner)}を信用しすぎるな。`])),
    ];
  }
  const strongest = NATION_IDS.slice().sort((a, b) => strength(state, b) - strength(state, a))[0];
  if (strongest === n || state.war.trucesHeld >= 2) return [];
  const third = NATION_IDS.find((k) => k !== n && k !== strongest)!;
  return [
    say(t.sharp, t.pick([`${N(strongest)}が強すぎる。${N(third)}と組むのも手だ。`, `${N(third)}にTRUCEを持ちかけてみるか？ ${N(strongest)}を止めないと。`])),
    say(t.bold, t.pick(['組むなんて性に合わないが…勝つためなら。', `${N(third)}なんか信用できるか。`, 'ありだな。背中を気にせず戦える。'])),
  ];
}

/** Who is left, who fell. */
function losses(t: Talk): string[] {
  const { state, n } = t;
  const ours = state.entities.filter((e) => e.nation === n);
  const dead = ours.filter((e) => !e.alive).length;
  const free = ours.filter((e) => e.alive && !e.jailed).length;
  if (!dead) {
    return state.rng() < 0.5 ? [say(t.careful, t.pick(['まだ誰も戦線離脱してない。この調子で。', `全員無事だ。${free}人で動ける。`]))] : [];
  }
  return [
    say(t.careful, t.pick([`もう${dead}人が戦線離脱した。残りは${free}人だ。`, `${dead}人失った。これ以上減らすわけにはいかない。`, `動けるのは${free}人。無茶はできないよ。`])),
    say(t.bold, t.pick(['その分、取り返せばいい。', '数が減ったなら、固まって動こう。', 'あいつらの分までTRACEしてやる。'])),
  ];
}

/** Credit where it is due. */
function praise(t: Talk): string[] {
  const { state, n } = t;
  const star = state.entities.filter((e) => e.nation === n && e.alive && e.capturesMade > 0).sort((a, b) => b.capturesMade - a.capturesMade)[0];
  const saver = state.entities.filter((e) => e.nation === n && e.alive && e.rescuesMade > 0).sort((a, b) => b.rescuesMade - a.rescuesMade)[0];
  if (!star && !saver) return [];
  const speaker = t.other([star ?? saver!]);
  const out: string[] = [];
  if (star) out.push(say(speaker, t.pick([`${nameOf(star.id)}、もう${star.capturesMade}人TRACEしたんだって？ やるな。`, `${nameOf(star.id)}の${star.capturesMade}人TRACEは大きい。`, `さすが${nameOf(star.id)}だ。${star.capturesMade}人LOCKしてる。`])));
  else if (saver) out.push(say(speaker, t.pick([`${nameOf(saver.id)}が仲間を${saver.rescuesMade}人助けた。ありがとう。`, `${nameOf(saver.id)}の解放、見事だった。`])));
  const hero = star ?? saver!;
  if (!hero.isPlayer && !hero.remote) out.push(say(hero, t.pick(['運が良かっただけだ。', 'まだまだこれからだ。', '次は敵のANCHORをLOCKしてみせる。', 'みんなが追い込んでくれたおかげだ。'])));
  return out;
}

/** The clock. */
function clockTalk(t: Talk): string[] {
  const left = timeLeftSec(t.state);
  if (!Number.isFinite(left)) return [];
  const m = Math.floor(left / 60), s = Math.floor(left % 60);
  const when = m ? `${m}分${s ? `${s}秒` : ''}` : `${s}秒`;
  if (left > 200) return [say(t.sharp, t.pick([`残り${when}。まだ時間はある。焦らず確実に。`, `あと${when}。前半は情報集めでいい。`]))];
  if (left > 90) return [say(t.sharp, t.pick([`残り${when}。そろそろ勝負に出る頃だ。`, `あと${when}。ANCHOR候補の目星をつけておきたい。`])), react(t, t.sharp, 'push')];
  return [say(t.bold, t.pick([`残り${when}しかないぞ！`, `あと${when}！ 一気に行くぞ！`])), say(t.careful, t.pick(['時間切れなら戦功ポイントで決まる。無理に突っ込んでLOCKされるのが一番まずい。', '焦ってTRACEされたら元も子もないよ。']))];
}

/** A moment of character between the business: a remark and a fitting answer. */
const SMALL_TALK: [string, string[]][] = [
  ['腹減ったな…終わったら何か食おう。', ['勝ってからな。', 'ラーメンがいいな。', '今それ言う？']],
  ['さっき階段で転びかけた。', ['ははっ、気をつけろよ。', '転んだところをTRACEされたら笑えないぞ。']],
  ['足音がして振り向いたら猫だった。', ['それ、敵じゃなくてよかったな。', '猫でも油断するなよ。']],
  ['夕焼けがきれいだな、こんな時に。', ['見とれてると背中を取られるぞ。', 'たしかに。勝って見たいもんだ。']],
  ['この街、路地が多すぎる。', ['逃げるには好都合だけどな。', '裏を返せば待ち伏せし放題だ。']],
  ['背中がぞわっとした。誰かに見られてた気がする。', ['気のせいであってほしいな。', '次からは二人で動こう。']],
  ['走りすぎて脇腹が痛い。', ['スタミナ管理も仕事のうちだ。', '会議のうちに休んでおけ。']],
  ['アンカー、顔色が悪いですよ。', ['誰のせいだと思ってる。', '大丈夫だ。心配するな。']],
];
function smallTalk(t: Talk): string[] {
  const line = t.pick(SMALL_TALK.map(([a]) => a));
  const answers = SMALL_TALK.find(([a]) => a === line)![1];
  const king = t.all.find((e) => e.role === 'king');
  const who = line.startsWith('アンカー、') ? t.other(king ? [king] : []) : t.other([t.sharp]);
  const answerer = line.startsWith('アンカー、') && king ? king : who !== t.bold ? t.bold : t.careful;
  if (line.startsWith('アンカー、') && !king) return [];
  return [say(who, line), say(answerer, t.pick(answers))];
}

// ---------------------------------------------------------------- the discussion

/** The discussion for nation `n` (already-known facts in the header are not repeated). */
export function discussionLines(state: GameState, n: NationId, facts: TalkFacts): string[] {
  const t = talk(state, n);
  if (!t) return ['（生存している仲間がいない…）'];
  const king = t.all.find((e) => e.role === 'king');
  const out: string[] = [...opening(t, king ?? t.sharp)];
  // Urgent news first.
  out.push(...kingInJail(t), ...friendsInJail(t));
  // Sightings are what the vote is about, so they always come up; then a few other topics.
  const pool: (() => string[])[] = [
    () => suspect(t, facts), () => tower(t), () => war(t), () => strategyTalk(t),
    () => truceTalk(t), () => losses(t), () => praise(t), () => clockTalk(t), () => smallTalk(t),
  ];
  const budget = out.length > 3 ? 2 : 3;
  let used = 0, reported = false;
  const at = Math.floor(state.rng() * 2); // sightings come up first or second
  for (const topic of t.shuffle(pool)) {
    if (used >= budget) break;
    if (used === at && !reported) { out.push(...sightings(t, facts)); reported = true; }
    const lines = topic();
    if (lines.length) { out.push(...lines); used++; }
  }
  if (!reported) out.push(...sightings(t, facts));
  // Sum up and ask for the vote.
  const places = facts.seen.slice(0, 2).map((g) => g.place);
  out.push(say(t.sharp, places.length
    ? t.pick([`まとめると、候補は${places.join('か')}だ。${VOTE_CALL}`, `${places.join('と')}が怪しい。${VOTE_CALL}`, `よし、${places[0]}が有力だ。${VOTE_CALL}`])
    : t.pick([`手がかりが少ないな。${VOTE_CALL}`, `決め手はない。勘でもいい、${VOTE_CALL}`])));
  return out;
}

/** The line asking for the vote (dropped if someone already voted). */
export const VOTE_CALL = 'どこを捜すか、投票で決めよう。';

/** Teammates answer what a person said in the meeting. */
export function replyLines(state: GameState, n: NationId, choice: string): string[] {
  const t = talk(state, n);
  if (!t) return [];
  const { bold, careful, sharp } = t;
  if (choice.includes('怪しい')) {
    return [say(sharp, t.pick(['了解、そっちを重点的に見よう。', '根拠は？ …いや、あり得るな。', 'なるほど。そっちに人を寄せよう。', 'いい読みだと思う。'])), say(careful, t.pick(['ただ、囮には気をつけて。', '決めつけすぎないようにね。', '裏をかかれてないといいけど。']))];
  }
  if (choice.includes('管制塔')) return [say(bold, t.pick(['塔よりANCHOR探しだろ…まあ、レーダーは欲しいか。', '塔を取れば探しやすくなる。賛成だ。', '塔か。守りの薄いうちに取っちまおう。'])), say(careful, t.pick(['賛成。情報が先だ。', 'RELAYがいれば一瞬で取れる。']))];
  if (choice.includes('LOCK POINT')) return [say(careful, t.pick(['そうだな、解放に来る敵を待ち伏せできる。', 'LOCK POINTは狙われやすい。見張りを置こう。'])), say(bold, t.pick(['守ってばかりじゃ勝てないぞ。', '仲間を取り返すのが先だ。', 'ならLOCK POINTの前で返り討ちにしてやる。']))];
  if (choice.includes('情報が足りない')) return [say(sharp, t.pick(['散って探すしかないな。見つけたらすぐ知らせてくれ。', '二人一組で広く探そう。', 'まずは高いところから見渡そう。']))];
  return [say(t.all[0], t.pick(['わかった。', '了解。', 'そうしよう。']))];
}

/** Teammates react to a vote. */
export function voteLines(state: GameState, n: NationId, who: string, place: string, target = false): string[] {
  const t = talk(state, n);
  const head = `→ ${who}の投票:「${place}」`;
  if (target) {
    if (!t) return [head];
    const voice = [t.bold, t.careful, t.sharp][Math.floor(state.rng() * 3)];
    return [head, say(voice, t.pick([`${place}を次の標的に。了解だ。`, `${place}か。見つけたら背後を取る。`, `${place}だな。ANCHORかどうか確かめてやる。`, `${place}に一票。追いかけるぞ。`, `${place}…怪しいと思ってた。`]))];
  }
  place = place.replace(/（[^）]*人）/g, '').replace(/付近$/, '');
  if (!t) return [head];
  const voice = [t.bold, t.careful, t.sharp][Math.floor(state.rng() * 3)];
  return [head, say(voice, t.pick([`${place}か。いいと思う。`, `${place}だな、了解。`, `${place}…悪くない。行こう。`, `${place}ね。気をつけて行こう。`, `${place}に一票、了解した。`, `${place}か、俺も気になってた。`]))];
}
