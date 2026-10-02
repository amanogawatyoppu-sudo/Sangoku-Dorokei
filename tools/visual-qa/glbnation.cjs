const { start, wait } = require('./start9.cjs');
(async () => {
  for (const deal of ['moon,soldier', 'star,keyholder']) {
    const { browser, p, errs } = await start({ base: process.argv[2], deal, seed: 7, q: '&glb=1' });
    const S = (f, ...a) => p.evaluate(f, ...a);
    for (let i = 0; i < 20 && !(await S(() => window.__sangoku.glb())); i++) await wait(500);
    const P = (await S(() => window.__sangoku.sites())).points[6];
    await S(([x, z]) => { window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, -1); window.__sangoku.setTime(9000); window.__sangoku.orbit(Math.PI * 0.8); }, [P.x, P.z]);
    await wait(2000);
    await p.screenshot({ path: `../g3/nation-${deal.split(',')[0]}.png` });
    console.log(deal, JSON.stringify(await S(() => window.__sangoku.glb())), errs);
    await browser.close();
  }
})();
