import { describe, expect, it } from 'vitest';

/** Source text of the layers that must stay free of rendering/DOM/audio. */
const sources = import.meta.glob<string>(
  ['../src/sim/**/*.ts', '../src/ai/**/*.ts', '../src/meeting/**/*.ts', '../src/core/**/*.ts', '../src/config/**/*.ts',
    // requestAnimationFrame driver: the one intended browser boundary in core/.
    '!../src/core/loop.ts'],
  { query: '?raw', import: 'default', eager: true },
);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('simulation layer purity', () => {
  it('finds the simulation sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(15);
  });

  it.each(Object.entries(sources))('%s does not use three.js, the DOM or audio', (_path, raw) => {
    const src = stripComments(raw);
    expect(src).not.toMatch(/from ['"]three['"]/);
    expect(src).not.toMatch(/\b(document|window|AudioContext|performance\.now|setTimeout)\b/);
    expect(src).not.toMatch(/from ['"](\.\.\/)+(ui|render|audio|input)\//);
  });
});
