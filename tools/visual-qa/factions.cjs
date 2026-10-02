// SOL / LUNA / STAR side by side in front of the Shibuya signs (night / sunset), to check
// that faction colours are not confused with sign and lamp light. Q='&art=v2all' node factions.cjs <tag> <base>
const { start, wait } = require('./start9.cjs');
const tag = process.argv[2], base = process.argv[3];
const T = { sunset: 150000, night: 291000, day: 9000 };
const SPOTS = { B: [-3060, 1899, 1, 0], C: [-2445, 2230, 0, 1] };
(async () => {
  const { browser, p, errs } = await start({ base, deal: 'sun,ranger' });
  const S = (f, ...a) => p.evaluate(f, ...a);
  const people = await S(() => window.__sangoku.people());
  const pick = (n) => people.find((x) => x.nation === n && !x.player && x.alive && !x.jailed).id;
  const ids = [pick('sun'), pick('moon'), pick('star')];
  for (const [s, [x, z, fx, fz]] of Object.entries(SPOTS)) for (const t of ['night', 'sunset']) {
    await S(([x, z, fx, fz, ms]) => { window.__sangoku.pause(false); window.__sangoku.setTime(ms); window.__sangoku.teleport(x, z); window.__sangoku.face(fx, fz); }, [x, z, fx, fz, T[t]]);
    await wait(1800);
    await S(([ids, fx, fz]) => ids.forEach((id, i) => {
      const side = (i - 1) * 34 + 30, ahead = 62;
      window.__sangoku.place(id, fx * ahead + fz * side, fz * ahead - fx * side, -fx, -fz);
    }), [ids, fx, fz]);
    await wait(300);
    await S(() => window.__sangoku.pause(true));
    await wait(900);
    await p.screenshot({ path: `../a2/${tag}-${s}-${t}.png` });
  }
  console.log(JSON.stringify({ tag, errs }));
  await browser.close();
})();
