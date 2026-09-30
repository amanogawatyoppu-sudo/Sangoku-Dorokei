import { describe, expect, it } from 'vitest';
import { NATIONS } from '../src/config/nations';
import { ROLES, roleJa, roleName } from '../src/config/roles';
import { FACTIONS, GAME, facFull } from '../src/config/terminology';
import { EventBus } from '../src/core/events';
import type { GameEvent } from '../src/sim/events';
import { PING_LABEL } from '../src/sim/ping';
import { contribution } from '../src/sim/contrib';
import { scoreBreakdown } from '../src/sim/systems/winCondition';
import { bindMessages } from '../src/ui/messages';
import type { Hud } from '../src/ui/hud';
import type { LogPanel } from '../src/ui/log';
import { GLOSSARY } from '../src/ui/glossary';
import { find, newGame } from './helpers';

const raw = (g: Record<string, string>) => Object.values(g)[0];
const html = raw(import.meta.glob<string>('../index.html', { query: '?raw', import: 'default', eager: true }));
const readme = raw(import.meta.glob<string>('../README.md', { query: '?raw', import: 'default', eager: true }));
const pkgText = raw(import.meta.glob<string>('../package.json', { query: '?raw', import: 'default', eager: true }));
/** Every source file's text (the whole game). */
const sources = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

/** Words of the old world that must not reach a player (v8.0). */
const OLD = ['三国ドロケイ', 'ドロケイ', '王', '牢屋', '処刑', '滅亡', '鍵使い', '自国', '敵国', '捕獲', '捕縛', '影武者', '兵士', '狙撃手', '通信士', '遊撃兵', '太陽国', '月国', '星国'];
/** Real place names that happen to contain one of the characters. */
const PLACES = ['国会議事堂', '国立競技場', '国立博物館'];

/** The string literals of a TypeScript file, comments removed (what could be shown to a player). */
function literals(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  return [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

const oldIn = (text: string) => {
  let t = text;
  for (const p of PLACES) t = t.split(p).join('');
  return OLD.filter((w) => t.includes(w));
};

describe('TRI//TRACE : TOKYO branding (v8.0)', () => {
  it('the page title, metadata and title screen carry the new name', () => {
    expect(html).toMatch(/<title>TRI\/\/TRACE : TOKYO/);
    expect(html).toContain('og:title" content="TRI//TRACE : TOKYO');
    expect(html).toContain('"name":"TRI//TRACE : TOKYO"');
    expect(html).toContain('class="tt-tri">TRI<');
    expect(html).toContain(GAME.catch);
    expect(html).toContain('PLAY');
    expect(html).toContain('TUTORIAL');
  });

  it('the setup screen asks for a faction (所属勢力), not a country', () => {
    expect(html).toContain('1 所属勢力');
    expect(html).not.toContain('所属する国');
  });

  it('no old-world word is left anywhere in the page or in any string the code can show', () => {
    const body = html.replace(/<!--[\s\S]*?-->/g, '');
    expect(oldIn(body)).toEqual([]);
    const hits: string[] = [];
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    for (const [f, text] of Object.entries(sources)) {
      // Glossary readings (kana) are search aliases, never displayed: old words there still find the new entry.
      const src = text.replace(/kana: '[^']*'/g, '');
      for (const s of literals(src)) for (const w of oldIn(s)) hits.push(`${f}: ${w} in "${s.slice(0, 60)}"`);
    }
    expect(hits).toEqual([]);
  });

  it('factions: SOL / LUNA / ASTER with their Japanese names, symbols unchanged', () => {
    expect(NATIONS.sun.name).toBe('SOL');
    expect(NATIONS.moon.name).toBe('LUNA');
    expect(NATIONS.star.name).toBe('ASTER');
    expect(facFull('sun')).toBe('SOL / 太陽陣営');
    expect(FACTIONS.moon.ja).toBe('月陣営');
    expect(NATIONS.star.emblem).toBe('★︎');
  });

  it('roles: ANCHOR, VANGUARD, SPOTTER, RELAY, BREAKER, RUNNER (with Japanese job names)', () => {
    expect(ROLES.map(roleName)).toEqual(['ANCHOR', 'VANGUARD', 'SPOTTER', 'RELAY', 'BREAKER', 'RUNNER']);
    expect(ROLES.map(roleJa)).toEqual(['アンカー', '前衛', '観測手', '中継手', '解除士', '遊撃手']);
  });

  it('ANCHOR候補, LOCK POINT and TRACE are what the player reads', () => {
    expect(PING_LABEL.king).toBe('ここにANCHOR！');
    const state = newGame();
    expect(scoreBreakdown(state, 'sun').map((b) => b.label)).toEqual(['TRACE', '解放', 'ANCHORへの攻撃', '生存', '管制塔', 'ANCHOR拘束中']);
    expect(GLOSSARY.some((t) => t.term === 'LOCK POINT')).toBe(true);
    expect(GLOSSARY.some((t) => t.term === 'ANCHOR候補')).toBe(true);
    const c = contribution(state, state.player);
    for (const b of [...c.base, ...c.role]) expect(oldIn(b.label), b.label).toEqual([]);
  });

  it('big events: ANCHOR LOCKED, ANCHOR RELEASED, NETWORK LOST, NETWORK SECURED', () => {
    const state = newGame();
    const cards: { title: string; sub: string; kicker: string; note?: string }[] = [];
    const lines: string[] = [];
    const hud = { eventCard: (c: { title: string; sub: string; kicker: string }) => cards.push(c), banner: () => {}, toast: () => {}, addCasualty: () => {} } as unknown as Hud;
    const log = { add: (t: string) => lines.push(t) } as unknown as LogPanel;
    const bus = new EventBus<GameEvent>();
    bindMessages(bus, state, log, hud);
    bus.emit({ type: 'KING_CAPTURED', nation: 'moon' });
    expect(cards.at(-1)).toMatchObject({ title: 'ANCHOR LOCKED', kicker: 'LUNA ANCHOR' });
    expect(cards.at(-1)!.note).toMatch(/^LINK SEVERまで \d+$/);
    bus.emit({ type: 'KING_RESCUED', nation: 'moon' });
    expect(cards.at(-1)!.title).toBe('ANCHOR RELEASED');
    bus.emit({ type: 'NATION_FALLEN', nation: 'sun' });
    expect(cards.at(-1)).toMatchObject({ title: 'NETWORK LOST', kicker: 'SOL' });
    expect(cards.at(-1)!.sub).toContain('太陽陣営');
    bus.emit({ type: 'GAME_OVER', winner: 'star' });
    expect(cards.at(-1)).toMatchObject({ title: 'NETWORK SECURED', kicker: 'ASTER VICTORY' });
    bus.emit({ type: 'JAILED', entityId: find(state, 'moon', 'soldier').id, capNation: 'sun' });
    expect(lines.at(-1)).toMatch(/^【LOCK】LUNAの.*（VANGUARD）がSOLにTRACEされ、LOCK POINTへ拘束された/);
    for (const l of lines) expect(oldIn(l), l).toEqual([]);
  });

  it('README and package are TRI//TRACE : TOKYO', () => {
    expect(readme.split('\n')[0]).toMatch(/^# TRI\/\/TRACE : TOKYO/);
    expect(oldIn(readme.replace(/## 旧名称[\s\S]*$/, ''))).toEqual([]);
    const pkg = JSON.parse(pkgText);
    expect(pkg.version).toBe('8.0.0');
  });
});
