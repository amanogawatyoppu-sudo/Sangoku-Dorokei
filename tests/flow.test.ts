import { describe, expect, it } from 'vitest';
import type { KeyValue, Settings } from '../src/ui/flow';
import { DEFAULT_SETTINGS, bootScreen, canStart, loadSettings, missing, next, saveSettings, setIntent, summary, takeIntent } from '../src/ui/flow';

const mem = (): KeyValue & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
};
const ready: Settings = { nation: 'sun', role: 'soldier', size: 10, cpu: 'normal', mode: 'cpu' };

describe('screen flow', () => {
  it('starts on the TITLE', () => {
    expect(bootScreen(null, DEFAULT_SETTINGS)).toBe('TITLE');
    expect(bootScreen(takeIntent(mem()), DEFAULT_SETTINGS)).toBe('TITLE');
  });

  it('プレイする → SETUP, チュートリアル → TUTORIAL, and back to the title from the settings', () => {
    expect(next('TITLE', { type: 'PLAY' }, DEFAULT_SETTINGS)).toEqual({ screen: 'SETUP', effect: 'none' });
    expect(next('TITLE', { type: 'TUTORIAL' }, DEFAULT_SETTINGS)).toEqual({ screen: 'TUTORIAL', effect: 'startTutorial' });
    expect(next('SETUP', { type: 'TITLE' }, DEFAULT_SETTINGS)).toEqual({ screen: 'TITLE', effect: 'none' });
  });

  it('a CPU match starts without choosing a faction or role (dealt at random, v8.4)', () => {
    expect(canStart(DEFAULT_SETTINGS)).toBe(true);
    expect(canStart({ ...DEFAULT_SETTINGS, size: 7 as never })).toBe(false);
    expect(missing(DEFAULT_SETTINGS)).toEqual([]); // CPU戦: faction and role are dealt at random
    expect(missing({ ...DEFAULT_SETTINGS, mode: 'online' })).toEqual(['所属勢力', '役職']);
    expect(next('SETUP', { type: 'START' }, DEFAULT_SETTINGS).screen).toBe('PLAYING');
    expect(canStart({ ...ready, role: null })).toBe(true);
    expect(next('SETUP', { type: 'START' }, ready)).toEqual({ screen: 'PLAYING', effect: 'startMatch' });
  });

  it('対人戦 starts from the room (the lobby), not from the CPU start', () => {
    const online: Settings = { ...ready, mode: 'online' };
    expect(canStart(online)).toBe(false);
    expect(next('SETUP', { type: 'START' }, online).screen).toBe('SETUP');
    expect(summary(online)).toContain('対人戦');
  });

  it('match over → RESULT; もう一度 / 設定を変更 / タイトルへ', () => {
    expect(next('PLAYING', { type: 'GAME_OVER' }, ready).screen).toBe('RESULT');
    expect(next('RESULT', { type: 'RETRY' }, ready)).toEqual({ screen: 'PLAYING', effect: 'reload' });
    expect(next('RESULT', { type: 'RETRY' }, { ...ready, mode: 'online' })).toEqual({ screen: 'SETUP', effect: 'reload' });
    expect(next('RESULT', { type: 'CHANGE_SETTINGS' }, ready)).toEqual({ screen: 'SETUP', effect: 'reload' });
    expect(next('RESULT', { type: 'TITLE' }, ready)).toEqual({ screen: 'TITLE', effect: 'reload' });
  });

  it('after a reload the intended screen comes up once; a retry without settings falls back to SETUP', () => {
    const s = mem();
    setIntent(s, 'PLAYING');
    const intent = takeIntent(s);
    expect(bootScreen(intent, ready)).toBe('PLAYING');
    expect(takeIntent(s)).toBeNull();
    expect(bootScreen('PLAYING', DEFAULT_SETTINGS)).toBe('PLAYING'); // CPU戦 needs no picks
    expect(bootScreen('PLAYING', { ...DEFAULT_SETTINGS, mode: 'online' })).toBe('SETUP');
  });

  it('settings (including the CPU level) are kept', () => {
    const s = mem();
    saveSettings(s, { ...ready, cpu: 'hard', size: 15 });
    expect(loadSettings(s)).toEqual({ ...ready, cpu: 'hard', size: 15 });
    s.setItem('sangoku.settings.v1', '{"cpu":"cheat","size":7}');
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('the tutorial ends to the title or straight into play', () => {
    expect(next('TUTORIAL', { type: 'TITLE' }, ready)).toEqual({ screen: 'TITLE', effect: 'reload' });
    expect(next('TUTORIAL', { type: 'TUTORIAL_PLAY' }, ready)).toEqual({ screen: 'PLAYING', effect: 'reload' });
    expect(next('TUTORIAL', { type: 'TUTORIAL_PLAY' }, { ...DEFAULT_SETTINGS, mode: 'online' })).toEqual({ screen: 'SETUP', effect: 'reload' });
  });
});

describe('用語・戦場マップ', () => {
  it('opens from the title only, and goes back to the title without a reload', () => {
    const s = { ...DEFAULT_SETTINGS };
    expect(next('TITLE', { type: 'GUIDE' }, s)).toEqual({ screen: 'GUIDE', effect: 'none' });
    expect(next('SETUP', { type: 'GUIDE' }, s).screen).toBe('SETUP');
    expect(next('GUIDE', { type: 'TITLE' }, s)).toEqual({ screen: 'TITLE', effect: 'none' });
    expect(next('GUIDE', { type: 'START' }, { ...s, nation: 'sun', role: 'king' }).screen).toBe('GUIDE');
  });
});
