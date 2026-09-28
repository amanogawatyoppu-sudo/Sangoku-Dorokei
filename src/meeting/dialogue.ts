import type { NationId } from '../config/nations';
import { NATIONS } from '../config/nations';
import { roleName } from '../config/roles';
import { nameOf } from '../config/names';
import { JAIL_TIME, KING_JAIL_EXTRA } from '../config/constants';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { suspStars } from '../sim/systems/suspicion';

/**
 * Meeting talk (会議の議論): teammates speak in turn about what the nation actually
 * knows (sightings, suspects, prisoners, the tower), answer each other (agree,
 * doubt, push back, sum up) and answer the people in the meeting. Pure text from
 * the match state; the meeting reveals it a line at a time.
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

type Pick = <T>(xs: readonly T[]) => T;

/** The AI teammates who talk, loudest first, and helpers to pick voices by temperament. */
function voices(state: GameState, n: NationId): { all: Entity[]; bold: Entity; careful: Entity; sharp: Entity; other: (not: Entity[]) => Entity } | null {
  const all = state.entities.filter((e) => e.nation === n && e.alive && !e.jailed && !e.isPlayer && !e.remote);
  if (!all.length) return null;
  // Three different people if there are three (a hothead, a worrier, a thinker).
  const order = all.slice().sort(() => state.rng() - 0.5);
  const taken: Entity[] = [];
  const by = (p: string) => {
    const e = order.find((o) => o.persona === p && !taken.includes(o)) ?? order.find((o) => !taken.includes(o)) ?? order[0];
    taken.push(e);
    return e;
  };
  const bold = by('aggressive'), careful = by('cautious'), sharp = by('analytical');
  const other = (not: Entity[]) => order.find((e) => !not.includes(e)) ?? order[0];
  return { all, bold, careful, sharp, other };
}

/** The discussion for nation `n` (already-known facts in the header are not repeated). */
export function discussionLines(state: GameState, n: NationId, facts: TalkFacts): string[] {
  const v = voices(state, n);
  if (!v) return ['（生存している仲間がいない…）'];
  const pick: Pick = (xs) => xs[Math.floor(state.rng() * xs.length)];
  const out: string[] = [];
  const { bold, careful, sharp } = v;
  const king = v.all.find((e) => e.role === 'king');
  const lead = king ?? sharp;
  out.push(say(lead, pick(['集まったな。手短にいこう。', 'みんな無事か？ 状況を整理しよう。', '時間がない。見たことを順番に話してくれ。'])));

  // Our king in a jail comes first.
  const myKing = state.entities.find((e) => e.nation === n && e.role === 'king');
  if (myKing?.jailed && myKing.capturedBy) {
    const left = Math.max(0, Math.ceil((myKing.jailedAt + JAIL_TIME + KING_JAIL_EXTRA - state.time) / 1000));
    out.push(say(bold, `王が${N(myKing.capturedBy)}の牢屋に捕まってる！ 処刑まであと${left}秒だぞ！`));
    const kh = v.all.find((e) => e.role === 'keyholder');
    out.push(kh ? say(kh, pick(['俺が行く。誰か護衛についてくれ。', '鍵は開けられる。ただ見張りが多い、ひとりじゃ無理だ。']))
      : say(careful, '鍵使いがいない…どうする？'));
    out.push(say(sharp, `全員で${N(myKing.capturedBy)}の牢屋に向かうしかない。ほかは後回しだ。`));
  }
  // Friends in jail.
  const jailed = state.entities.filter((e) => e.nation === n && e.jailed && e.role !== 'king' && e.capturedBy);
  if (jailed.length) {
    const j = jailed[0];
    out.push(say(careful, jailed.length > 1 ? `${nameOf(j.id)}たち${jailed.length}人が牢屋にいる。` : `${nameOf(j.id)}が${N(j.capturedBy!)}の牢屋に捕まってる。`));
    out.push(say(bold, pick(['助けに行こう。放っておけない。', '見張りが薄いうちに取り返そう。'])));
  }

  // Sightings: each one reported, and argued over.
  const reporters = v.all.slice().sort(() => state.rng() - 0.5);
  facts.seen.slice(0, 2).forEach((g, i) => {
    const who = reporters[i % reporters.length];
    const answer = (pref: Entity, alt: Entity) => (pref !== who ? pref : alt !== who ? alt : v.other([who]));
    const ago = g.ageSec < 5 ? 'ついさっき' : `${Math.round(g.ageSec)}秒くらい前`;
    out.push(say(who, g.count > 1 ? `${g.place}で${N(g.nation)}の${g.count}人組を見た。${ago}だ。` : `${g.place}で${N(g.nation)}のやつをひとり見た。${ago}。`));
    if (g.king >= 2) {
      out.push(say(answer(bold, sharp), pick(['真ん中のやつ、ずっと囲まれてなかったか？ あれが王だろう。', '護衛の付き方が普通じゃない。王の可能性が高い。'])));
      out.push(say(answer(careful, sharp), pick(['囮かもしれない。決めつけるのは早いよ。', 'わざと固まって見せてる可能性もある。'])));
      out.push(say(answer(sharp, bold), `でも手がかりはそれしかない。${g.place}は候補に入れよう。`));
    } else if (g.count >= 3) {
      out.push(say(answer(bold, sharp), `${g.count}人もいたなら何か守ってるはずだ。行くべきだ。`));
      out.push(say(answer(careful, sharp), pick(['人数が多いなら、こっちも揃えてから行こう。', '待ち伏せかもしれない。気をつけて。'])));
    } else {
      out.push(say(answer(careful, sharp), pick(['ひとりなら偵察か、はぐれただけかも。', 'それだけじゃ何とも言えないな。', 'どっちへ向かってた？ …まあいい、覚えておこう。'])));
    }
  });
  if (!facts.seen.length) {
    out.push(say(careful, '誰か敵を見たか？'));
    out.push(say(v.other([careful]), pick(['いや、見てない。', 'こっちは静かだった。'])));
    out.push(say(bold, '静かすぎるな…どこかに固まってるんじゃないか。'));
  }

  // The prime suspect and the evidence against it.
  const s = facts.suspect;
  if (s) {
    const ev = s.e.evidence[0]?.text;
    const stars = suspStars(s.e.susp);
    out.push(say(sharp, ev ? `${N(s.e.nation)}の、${s.dir}にいたやつ。「${ev}」。${stars >= 3 ? 'かなり怪しい。' : '少し気になる。'}`
      : `${N(s.e.nation)}の、${s.dir}にいたやつの動きがおかしい。`));
    out.push(stars >= 3 ? say(bold, '同感だ。次に見かけたら後ろを取る。') : say(careful, 'それだけで王とは言えないけど、目は離さないでおこう。'));
  }

  // The tower.
  const owner = state.tower.owner;
  if (owner && owner !== n) {
    out.push(say(v.all.find((e) => e.role === 'communicator') ?? careful, `管制塔は${N(owner)}に取られてる。レーダーを使われたらこっちが丸見えだ。`));
    out.push(say(bold, pick(['なら取り返そう。', '塔より王探しが先だろ。'])));
  } else if (owner === n) {
    out.push(say(v.all.find((e) => e.role === 'communicator') ?? careful, '塔はうちが押さえてる。このまま守りたい。'));
  } else {
    out.push(say(careful, '管制塔はまだ誰のものでもない。先に取れば有利だ。'));
  }

  // Sum up and ask for the vote.
  const places = facts.seen.slice(0, 2).map((g) => g.place);
  out.push(say(sharp, places.length ? `まとめると、候補は${places.join('か')}だ。${VOTE_CALL}` : `手がかりが少ないな。${VOTE_CALL}`));
  return out;
}

/** The line asking for the vote (dropped if someone already voted). */
export const VOTE_CALL = 'どこを捜すか、投票で決めよう。';

/** Teammates answer what a person said in the meeting. */
export function replyLines(state: GameState, n: NationId, choice: string): string[] {
  const v = voices(state, n);
  if (!v) return [];
  const pick: Pick = (xs) => xs[Math.floor(state.rng() * xs.length)];
  const { bold, careful, sharp } = v;
  if (choice.includes('怪しい')) {
    return [say(sharp, pick(['了解、そっちを重点的に見よう。', '根拠は？ …いや、あり得るな。'])), say(careful, 'ただ、囮には気をつけて。')];
  }
  if (choice.includes('管制塔')) return [say(bold, pick(['塔より王探しだろ…まあ、レーダーは欲しいか。', '塔を取れば探しやすくなる。賛成だ。'])), say(careful, '賛成。情報が先だ。')];
  if (choice.includes('牢屋')) return [say(careful, 'そうだな、救出に来る敵を待ち伏せできる。'), say(bold, pick(['守ってばかりじゃ勝てないぞ。', '仲間を取り返すのが先だ。']))];
  if (choice.includes('情報が足りない')) return [say(sharp, '散って探すしかないな。見つけたらすぐ知らせてくれ。')];
  return [say(v.all[0], 'わかった。')];
}

/** Teammates react to a vote. */
export function voteLines(state: GameState, n: NationId, who: string, place: string): string[] {
  const v = voices(state, n);
  const head = `→ ${who}の投票:「${place}」`;
  place = place.replace(/（[^）]*人）/g, '').replace(/付近$/, '');
  if (!v) return [head];
  const pick: Pick = (xs) => xs[Math.floor(state.rng() * xs.length)];
  return [head, say(pick([v.bold, v.careful, v.sharp]), pick([`${place}か。いいと思う。`, `${place}だな、了解。`, `${place}…悪くない。行こう。`]))];
}
