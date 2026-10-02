// Which GLB clips play in real play: start from rest, run, stop, spin on the spot, TRACE.
const { start, wait } = require('./start9.cjs');
(async () => {
  const { browser, p, errs } = await start({ base: process.argv[2], deal: 'sun,ranger', seed: 7, q: '&glb=1' });
  const S = (f, ...a) => p.evaluate(f, ...a);
  for (let i = 0; i < 20 && !(await S(() => window.__sangoku.glb())); i++) await wait(500);
  const P = (await S(() => window.__sangoku.sites())).points[6];
  await S(([x, z]) => { window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, 1); window.__sangoku.setTime(9000); }, [P.x, P.z]);
  await wait(1500);
  const seen = {}, took = {};
  const poll = async (label, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const c = (await S(() => window.__sangoku.glb())).clip; seen[c] = (seen[c] || 0) + 1; if (!took[c]) { took[c] = label; await p.screenshot({ path: `../g3/clip-${c}.png` }); } await wait(40); } };
  await poll('rest', 500);
  await p.keyboard.down('ArrowUp'); await poll('start', 1500);
  await p.keyboard.down('Shift'); await poll('sprint', 1200); await p.keyboard.up('Shift'); await p.keyboard.up('ArrowUp');
  await poll('stop', 1200);
  // Turning on the spot: the facing swings round while standing.
  for (let k = 0; k < 14; k++) { const a = k * 2.2; await S((a) => window.__sangoku.face(Math.sin(a), Math.cos(a)), a); await poll('spin', 60); }
  await poll('after-spin', 800);
  await S(() => window.__sangoku.glbTrace()); await poll('trace', 1200);
  console.log(JSON.stringify({ seen, took, errs }));
  await browser.close();
})();
