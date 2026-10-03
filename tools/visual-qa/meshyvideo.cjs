// A short real-play recording: sprint down a Shibuya road, a sharp turn, a TRACE, then night.
// Video (webm, Playwright) + a frame sequence for a GIF (every captured frame is a real game frame).
const { start, wait } = require('./start9.cjs');
const tag = process.argv[3] ?? 'meshy';
(async () => {
  const { browser, p, errs } = await start({ base: process.argv[2], deal: 'sun,ranger', seed: 7, q: process.env.Q ?? '&glb=meshy', video: `../m3/video-${tag}` });
  const S = (f, ...a) => p.evaluate(f, ...a);
  for (let i = 0; i < 40 && !(await S(() => window.__sangoku.glb())) && !/glb=0/.test(process.env.Q ?? ''); i++) await wait(500);
  let n = 0;
  const frames = async (k) => { for (let i = 0; i < k; i++) await p.screenshot({ path: `../m3/vf-${tag}-${String(n++).padStart(3, '0')}.png`, clip: { x: 380, y: 150, width: 600, height: 560 } }); };
  for (const [t, ms] of [['day', 9000], ['night', 291000]]) {
    await S(([ms]) => { window.__sangoku.setTime(ms); window.__sangoku.teleport(-3060, 1899); window.__sangoku.face(1, 0); }, [ms]);
    await wait(1500);
    await p.keyboard.down('ArrowUp'); await frames(4);
    await p.keyboard.down('Shift'); await frames(8);
    await p.keyboard.down('ArrowLeft'); await frames(3); await p.keyboard.up('ArrowLeft');
    await p.keyboard.up('Shift'); await p.keyboard.up('ArrowUp'); await frames(3);
    await S(() => window.__sangoku.glbTrace()); await frames(4);
  }
  console.log(JSON.stringify({ frames: n, errs }));
  await p.close();
  await browser.close();
})();
