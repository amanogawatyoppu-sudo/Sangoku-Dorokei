// Shibuya showcase block: same spots, same angles, day / sunset / night.
// Q='&art=v2' node block.cjs <tag> <base> [times]
const { start, wait } = require('./start9.cjs');
const tag = process.argv[2], base = process.argv[3], times = (process.argv[4] ?? 'day,sunset,night').split(',');
const T = { day: 9000, sunset: 150000, night: 291000 };
const SPOTS = (process.env.SPOTS ?? 'A,B,C,D').split(',');
const ALL = {
  A: [-2700, 1600, 0, 1],    // on the avenue north of the crossing, looking south over the scramble
  B: [-3060, 1899, 1, 0],    // west street, looking east at the crossing and the east storefronts
  C: [-2445, 2230, 0, 1],    // east sidewalk, looking south along the storefronts
  D: [-3080, 1950, -1, 0],   // west street looking west (the old "dark wall" view)
};
(async () => {
  const W = Number(process.env.W ?? 1366), H = Number(process.env.H ?? 768);
  const { browser, p, errs } = await start({ base, deal: 'sun,ranger', W, H, mobile: W < 900 });
  const S = (f, ...a) => p.evaluate(f, ...a);
  // Same camera as v9.1 (distance 160, tilt 0.42) for strict before/after pairs.
  if (process.env.CAM91) await S(() => { window.__sangoku.zoom(160); window.__sangoku.tilt(0.42); });
  for (const s of SPOTS) for (const t of times) {
    const [x, z, fx, fz] = ALL[s];
    await S(([x, z, fx, fz, ms]) => { window.__sangoku.pause(false); window.__sangoku.setTime(ms); window.__sangoku.teleport(x, z); window.__sangoku.face(fx, fz); }, [x, z, fx, fz, T[t]]);
    await wait(2200);
    await S(() => window.__sangoku.pause(true));
    await wait(700);
    await p.screenshot({ path: `../a2/${tag}-${s}-${t}.png` });
  }
  console.log(JSON.stringify({ tag, errs, info: await S(() => window.__sangoku.renderInfo()) }));
  await browser.close();
})();
