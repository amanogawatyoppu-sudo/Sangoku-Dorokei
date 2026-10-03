// Joint inspection in the real game: hold each clip at several phases, photograph from behind, side and front.
const { start, wait } = require('./start9.cjs');
const DUR = { Idle: 1.6, Walk: 1.08, Run: 0.78, Sprint: 0.61, Turn: 0.72, Trace: 0.83 };
const PLAN = [['Run', 4, [0, 1.5708, 3.1416]], ['Sprint', 4, [0, 1.5708, 3.1416]], ['Walk', 4, [1.5708]], ['Trace', 3, [3.1416, 1.5708, 0]], ['Turn', 2, [0.8]], ['Idle', 1, [3.1416, 0.8]]];
(async () => {
  const tag = process.argv[3] ?? 'j';
  const { browser, p, errs } = await start({ base: process.argv[2], deal: 'sun,ranger', seed: 7, q: process.env.Q ?? '&glb=meshy', dpr: 2 });
  const S = (f, ...a) => p.evaluate(f, ...a);
  for (let i = 0; i < 40 && !(await S(() => window.__sangoku.glb())); i++) await wait(500);
  const P = (await S(() => window.__sangoku.sites())).points[6];
  await S(([x, z, tm]) => { window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, 1); window.__sangoku.setTime(tm); }, [P.x, P.z, Number(process.env.T ?? 9000)]);
  await wait(1500);
  await S(() => { window.__sangoku.pause(true); window.__sangoku.zoom(105); });
  const shots = [];
  for (const [clip, n, angles] of PLAN) for (let k = 0; k < n; k++) for (const o of angles) {
    const t = (k / n) * DUR[clip];
    await S(([c, t, o]) => { window.__sangoku.glbHold(c, t); window.__sangoku.orbit(o); }, [clip, t, o]);
    await wait(700);
    const f = `../m3/${tag}-${clip}-${k}-${o.toFixed(1)}.png`;
    await p.screenshot({ path: f, clip: { x: 560, y: 330, width: 230, height: 300 } });
    shots.push([clip, k, o]);
  }
  console.log(JSON.stringify({ n: shots.length, errs }));
  await browser.close();
})();
