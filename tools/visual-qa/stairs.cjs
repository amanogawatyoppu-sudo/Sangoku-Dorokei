// Stair entrances: the three tallest ground-level flights, from their foot, day and night. node stairs.cjs <tag> <base>
const { start, wait } = require('./start9.cjs');
const tag = process.argv[2], base = process.argv[3];
(async () => {
  const { browser, p, errs } = await start({ base });
  const S = (f, ...a) => p.evaluate(f, ...a);
  const sites = await S(() => window.__sangoku.sites());
  const flights = sites.ramps.filter((x) => x.style === 'stairs' && x.low < 5 && Math.min(x.w, x.d) > 60).sort((a, b) => b.rise - a.rise).slice(0, 3);
  for (const [i, r] of flights.entries()) {
    const len = r.axis === 'x' ? r.w : r.d;
    const k = r.axis === 'x' ? { x: r.x - r.dir * (len / 2 + 170), z: r.z, fx: r.dir, fz: 0 } : { x: r.x, z: r.z - r.dir * (len / 2 + 170), fx: 0, fz: r.dir };
    for (const [ms, t] of [[9000, 'day'], [291000, 'night']]) {
      await S(([k, ms]) => { window.__sangoku.setTime(ms); window.__sangoku.teleport(k.x, k.z); window.__sangoku.face(k.fx, k.fz); }, [k, ms]);
      await wait(2300);
      await p.screenshot({ path: `../qa/${tag}-stairs${i}-${t}.png` });
    }
  }
  console.log(JSON.stringify({ tag, flights: flights.map((f) => [Math.round(f.x), Math.round(f.z), f.rise, f.group]), errs }));
  await browser.close();
})();
