// The player character in the actual game view: idle, run, sprint, sharp turn, stop — normal camera and a close camera.
// Q='&art=v2' node game2.cjs <tag> <base>
const { start, wait } = require('./start9.cjs');
const tag = process.argv[2], base = process.argv[3];
(async () => {
  const { browser, p, errs } = await start({ base, deal: 'sun,ranger', W: Number(process.env.W ?? 1366), H: Number(process.env.H ?? 768), mobile: Number(process.env.W ?? 1366) < 900 });
  const S = (f, ...a) => p.evaluate(f, ...a);
  const sites = await S(() => window.__sangoku.sites());
  const P = sites.points[6];
  const shot = (n) => p.screenshot({ path: `../a2/${tag}-${n}.png` });
  await S(([x, z]) => { window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, 1); window.__sangoku.setTime(9000); }, [P.x, P.z]);
  await wait(2000);
  await shot('idle');
  await p.keyboard.down('ArrowUp'); await wait(1300); await shot('run');
  await p.keyboard.down('Shift'); await wait(1100); await shot('sprint');
  await p.keyboard.down('ArrowLeft'); await wait(450); await shot('turn');
  await p.keyboard.up('ArrowLeft'); await p.keyboard.up('Shift'); await p.keyboard.up('ArrowUp'); await wait(250); await shot('stop');
  // Measure the player's on-screen height in the normal camera (projected head and feet).
  const px = await S(() => window.__sangoku.playerScreenBox ? window.__sangoku.playerScreenBox() : null);
  console.log(JSON.stringify({ tag, px, errs }));
  await browser.close();
})();
