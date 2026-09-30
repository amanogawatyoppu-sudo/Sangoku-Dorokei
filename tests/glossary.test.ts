import { describe, expect, it } from 'vitest';
import { GLOSSARY, GLOSSARY_CATS, searchGlossary } from '../src/ui/glossary';
import { ROLE_INFO, ROLES } from '../src/config/roles';

describe('用語集', () => {
  it('every category has entries, every role is explained, and no word appears twice', () => {
    for (const c of GLOSSARY_CATS) expect(GLOSSARY.some((t) => t.cat === c), c).toBe(true);
    for (const r of ROLES) expect(GLOSSARY.some((t) => t.term === ROLE_INFO[r].n)).toBe(true);
    expect(new Set(GLOSSARY.map((t) => t.term)).size).toBe(GLOSSARY.length);
  });

  it('search finds words by name, reading and text, within a category', () => {
    expect(searchGlossary('ろっくぽいんと', null).map((t) => t.term)).toContain('LOCK POINT');
    expect(searchGlossary('かんせいとう', null).map((t) => t.term)).toContain('管制塔');
    expect(searchGlossary('', '役職').every((t) => t.cat === '役職')).toBe(true);
    expect(searchGlossary('存在しない言葉xyz', null)).toEqual([]);
  });
});
