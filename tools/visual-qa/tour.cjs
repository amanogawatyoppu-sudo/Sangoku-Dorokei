// Visual tour: same spots/angles for before/after comparison, with renderer.info and fps.
const { chromium } = require('playwright');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = process.argv[2] ?? 'before';
const W = Number(process.argv[3] ?? 1366), H = Number(process.argv[4] ?? 768);
const SPOTS = [
  ['spawn', null],
  ['shinjuku', [-2847, -700, 0, 1]], ['shibuya', [-3067, 2420, 0, -1]], ['akihabara', [2661, -1900, 0, -1]],
  ['ueno', [2750, -3800, 0, -1]], ['tokyotower', [487, 3100, 0, -1]], ['shinagawa', [300, 4850, 0, -1]], ['central', [1150, 1100, 0, -1]],
];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: W < 900, isMobile: W < 900 });
  await ctx.addInitScript(() => { try { localStorage.setItem('sangoku.quality.v1', '0'); } catch {} });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_/.test(m.text())) errs.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.goto((process.env.BASE ?? 'http://localhost:4173/') + '?debug&deal=moon,communicator'); await wait(1500);
  await p.evaluate(() => setTimeout(() => document.getElementById('btnPlay').click(), 10)); await wait(500);
  await p.evaluate(() => setTimeout(() => document.getElementById('btnStart').click(), 10));
  for (let i = 0; i < 200; i++) { if (await p.evaluate(() => !!window.__sangoku && window.__sangoku.screen() === 'PLAYING' && (!document.getElementById('loading') || document.getElementById('loading').hidden))) break; await wait(500); }
  await wait(6500);
  await p.evaluate(() => window.__sangoku.meetingIn(99999));
  const rows = [];
  const fps = () => p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
  for (const [name, at] of SPOTS) {
    if (at) await p.evaluate(([x, z, dx, dz]) => { window.__sangoku.teleport(x, z); window.__sangoku.face(dx, dz); }, at);
    await wait(2500);
    const f = await fps();
    const info = await p.evaluate(() => window.__sangoku.renderInfo());
    await p.screenshot({ path: `../perf/${tag}-${name}.png` });
    rows.push({ name, fps: Math.round(f * 10) / 10, ...info });
  }
  // Night at Shinjuku.
  await p.evaluate(() => { window.__sangoku.teleport(-2847, -700); window.__sangoku.face(0, 1); window.__sangoku.setTime(292000); });
  await wait(3000);
  rows.push({ name: 'night', fps: Math.round((await fps()) * 10) / 10, ...(await p.evaluate(() => window.__sangoku.renderInfo())) });
  await p.screenshot({ path: `../perf/${tag}-night.png` });
  const q = await p.evaluate(() => window.__sangoku.renderer());
  const mem = await p.evaluate(() => window.__sangoku.memory ? window.__sangoku.memory() : null);
  console.log(JSON.stringify({ tag, W, H, renderer: q, mem, rows, errs }, null, 0));
  await browser.close();
})();
