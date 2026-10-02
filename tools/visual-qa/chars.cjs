// Character close-ups at 2x device pixels: back / side / front, run, sprint, day and night. node chars.cjs <tag> <base>
const { start, wait } = require('./start9.cjs');
const tag = process.argv[2], base = process.argv[3];
const out = (n) => `../qa/${tag}-c-${n}.png`;
(async () => {
  const { browser, p, errs } = await start({ base, dpr: 2 });
  const S = (f, ...a) => p.evaluate(f, ...a);
  const sites = await S(() => window.__sangoku.sites());
  const P = sites.points[6];
  const clip = { x: 433, y: 300, width: 500, height: 440 };
  for (const [ms, t] of [[9000, 'day'], [291000, 'night']]) {
    await S(([x, z, ms]) => { window.__sangoku.setTime(ms); window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, 1); window.__sangoku.zoom(74); }, [P.x, P.z, ms]);
    await wait(1800);
    await S(() => window.__sangoku.pause(true));
    for (const [n, o] of [['back', 0], ['side', Math.PI / 2], ['front', Math.PI]]) {
      await S((o) => window.__sangoku.orbit(o), o); await wait(1300);
      await p.screenshot({ path: out(`${t}-${n}`), clip });
    }
    await S(() => { window.__sangoku.orbit(Math.PI / 2); window.__sangoku.pause(false); });
    if (t === 'day') {
      await p.keyboard.down('ArrowUp'); await wait(1100);
      await p.screenshot({ path: out('run'), clip });
      await p.keyboard.down('Shift'); await wait(1000);
      await p.screenshot({ path: out('sprint'), clip });
      await p.keyboard.up('Shift'); await p.keyboard.up('ArrowUp');
    }
    await S(() => window.__sangoku.orbit(0));
  }
  console.log(JSON.stringify({ tag, errs }));
  await browser.close();
})();
