// Inlines the built JS/CSS into dist/index.html so the game opens straight from disk
// (browsers block module scripts loaded from file:// URLs). No dependencies.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+\.css)"[^>]*>/g, (_, f) => `<style>${readFileSync(join(dist, 'assets', f), 'utf8')}</style>`);
html = html.replace(/<script type="module"[^>]*src="\.\/assets\/([^"]+\.js)"[^>]*><\/script>/g, (_, f) => {
  const js = readFileSync(join(dist, 'assets', f), 'utf8');
  if (/<\/script/i.test(js)) throw new Error('bundle contains </script>');
  return `<script type="module">${js}</script>`;
});
// Module scripts in <head> run after parsing anyway; keep them where Vite put them.
writeFileSync(join(dist, 'index.html'), html);
console.log(`dist/index.html: ${(html.length / 1024).toFixed(0)} kB self-contained (${assets.length} assets inlined)`);
