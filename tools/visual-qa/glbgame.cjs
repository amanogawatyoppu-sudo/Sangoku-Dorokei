// GLB player integration test: same spot / same time, ?glb=0 vs ?glb=1.
// Q='&glb=1' node glbgame.cjs <tag> <base>
const { start, wait } = require('./start9.cjs');
const tag = process.argv[2], base = process.argv[3];
(async () => {
  const W = Number(process.env.W ?? 1366), H = Number(process.env.H ?? 768);
  const { browser, p, errs } = await start({ base, deal: 'sun,ranger', W, H, mobile: W < 900, seed: 7 });
  const S = (f, ...a) => p.evaluate(f, ...a);
  const shot = (n) => p.screenshot({ path: `../${process.env.OUT ?? 'g3'}/${tag}-${n}.png` });
  const clip = () => S(() => (window.__sangoku.glb() || {}).clip || '-');
  const log = {};
  const P = (await S(() => window.__sangoku.sites())).points[6];
  for (let i = 0; i < 20 && !(await S(() => window.__sangoku.glb())) && process.env.Q; i++) await wait(500);
  log.stats = await S(() => window.__sangoku.glb());
  // 1. Front and back: still, facing +z (back to the camera), then the camera swung round to the front.
  await S(([x, z]) => { window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, 1); window.__sangoku.setTime(9000); }, [P.x, P.z]);
  await wait(2200);
  await shot('back'); log.back = await clip();
  await S(() => { window.__sangoku.orbit(Math.PI); window.__sangoku.zoom(110); });
  await wait(1500); await shot('front');
  await S(() => { window.__sangoku.orbit(0); window.__sangoku.zoom(0); });
  await wait(800);
  // 2. Run, sprint, sharp turn, stop (real input).
  await p.keyboard.down('ArrowUp'); await wait(1300); await shot('run'); log.run = await clip();
  await p.keyboard.down('Shift'); await wait(1100); await shot('sprint'); log.sprint = await clip();
  await p.keyboard.down('ArrowLeft'); await wait(450); await shot('turn'); log.turn = await clip();
  await p.keyboard.up('ArrowLeft'); await p.keyboard.up('Shift'); await p.keyboard.up('ArrowUp'); await wait(250); await shot('stop'); log.stop = await clip();
  // Side view while running (feet on the ground?).
  await p.keyboard.down('ArrowUp'); await wait(900);
  await S(() => { window.__sangoku.orbit(Math.PI / 2); }); await wait(500); await shot('run-side'); log.runSide = await clip();
  await p.keyboard.up('ArrowUp'); await S(() => window.__sangoku.orbit(0)); await wait(900);
  // Turn on the spot.
  await S(([x, z]) => { window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, 1); window.__sangoku.orbit(0.6); }, [P.x, P.z]); await wait(1200);
  for (let k = 1; k <= 4; k++) { await S((a) => window.__sangoku.face(Math.sin(a), Math.cos(a)), k * 1.9); await wait(150); }
  log.spin = await clip(); await shot('spin');
  await S(() => { window.__sangoku.face(0, 1); window.__sangoku.orbit(0); }); await wait(900);
  // 3. TRACE clip (front three-quarter view).
  await S(() => { window.__sangoku.orbit(2.4); window.__sangoku.glbTrace(); }); await wait(350); await shot('trace'); log.trace = await clip();
  await S(() => window.__sangoku.orbit(0)); await wait(900);
  // 4. Shibuya road, day and night, running.
  for (const [t, ms] of [['shibuya-day', 9000], ['shibuya-night', 291000]]) {
    await S(([ms]) => { window.__sangoku.setTime(ms); window.__sangoku.teleport(-3060, 1899); window.__sangoku.face(1, 0); }, [ms]);
    await wait(1500);
    await p.keyboard.down('ArrowUp'); await p.keyboard.down('Shift'); await wait(1200); await shot(t); log[t] = await clip();
    await p.keyboard.up('Shift'); await p.keyboard.up('ArrowUp'); await wait(600);
  }
  log.box = await S(() => window.__sangoku.playerScreenBox ? window.__sangoku.playerScreenBox() : null);
  console.log(JSON.stringify({ tag, log, errs }));
  await browser.close();
})();
