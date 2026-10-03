// Shared: open the game (?debug), start a CPU match, wait until playing.
const { chromium } = require('playwright');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function start({ base = 'http://localhost:5173/', W = 1366, H = 768, mobile = false, tier = '0', seed, deal = 'moon,communicator', dpr = 1, q = process.env.Q ?? '', video = null } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: dpr, ...(video ? { recordVideo: { dir: video, size: { width: W, height: H } } } : {}) });
  await ctx.addInitScript((t) => { try { localStorage.setItem('sangoku.quality.v1', t); } catch {} }, tier);
  // Deterministic "random" (the CPU-match deal, names…), so two builds can be compared shot for shot.
  if (seed !== undefined) await ctx.addInitScript((sd) => { let x = sd >>> 0; Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }, seed);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_/.test(m.text())) errs.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.goto(base + '?debug' + (deal ? '&deal=' + deal : '') + q); await wait(2500);
  await p.evaluate(() => setTimeout(() => document.getElementById('btnPlay').click(), 10)); await wait(500);
  await p.evaluate(() => setTimeout(() => document.getElementById('btnStart').click(), 10));
  for (let i = 0; i < 200; i++) { if (await p.evaluate(() => !!window.__sangoku && window.__sangoku.screen() === 'PLAYING' && (!document.getElementById('loading') || document.getElementById('loading').hidden))) break; await wait(500); }
  await wait(4000);
  await p.evaluate(() => window.__sangoku.meetingIn(99999));
  return { browser, ctx, p, errs, wait };
}
module.exports = { start, wait };
