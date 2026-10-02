// Visual QA set (v9.0 review). node qa.cjs <tag> <baseUrl>
// Same seed-free procedure for before/after: quality HIGH, 1366x768, debug photo hooks.
const { start, wait } = require('./start9.cjs');
const tag = process.argv[2] ?? 'qa', base = process.argv[3] ?? 'http://localhost:5173/';
const out = (n) => `../qa/${tag}-${n}.png`;
(async () => {
  const { browser, p, errs } = await start({ base, seed: Number(process.env.SEED ?? 7) });
  const S = (f, ...a) => p.evaluate(f, ...a);
  const sites = await S(() => window.__sangoku.sites());
  const people = await S(() => window.__sangoku.people());
  const me = people.find((x) => x.player);
  const zoom = async (n) => { await p.mouse.move(683, 400); for (let i = 0; i < Math.abs(n); i++) { await p.mouse.wheel(0, n < 0 ? -120 : 120); await wait(40); } };
  // Open ground near the central strategic point.
  const P = sites.points[6];
  await S(([x, z]) => { window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, 1); window.__sangoku.setTime(9000); }, [P.x, P.z]);
  await wait(1500);
  await zoom(-8); await wait(600);
  // 1. Character: back / side / front (frozen).
  await S(() => window.__sangoku.pause(true));
  for (const [n, o] of [['char-back', 0], ['char-side', Math.PI / 2], ['char-front', Math.PI]]) {
    await S((o) => window.__sangoku.orbit(o), o); await wait(1400);
    await p.screenshot({ path: out(n) });
  }
  await S(() => { window.__sangoku.orbit(0); window.__sangoku.pause(false); });
  // 2. Running and sprinting, seen from the side and from behind.
  await p.keyboard.down('ArrowUp'); await wait(900);
  await S(() => window.__sangoku.orbit(Math.PI / 2)); await wait(700);
  await p.screenshot({ path: out('run-side') });
  await p.keyboard.down('Shift'); await wait(900);
  await p.screenshot({ path: out('sprint-side') });
  await S(() => window.__sangoku.orbit(0)); await wait(600);
  await p.screenshot({ path: out('sprint-back') });
  await p.keyboard.up('Shift'); await p.keyboard.up('ArrowUp'); await wait(600);
  // 3. Line-ups: one of each enemy role facing us and facing away; then our own side.
  await S(([x, z]) => { window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, 1); }, [P.x, P.z]);
  await wait(800);
  const roles = ['king', 'soldier', 'sniper', 'communicator', 'keyholder', 'ranger'];
  const enemyNation = ['sun', 'moon', 'star'].find((n) => n !== me.nation);
  const pick = (nat) => roles.map((r) => people.find((x) => x.nation === nat && x.role === r && x.alive && !x.player)).filter(Boolean);
  for (const [grp, nat] of [['enemy', enemyNation], ['ally', me.nation]]) {
    const row = pick(nat);
    for (const [face, fz] of [['front', -1], ['back', 1]]) {
      await S(() => window.__sangoku.pause(false)); await wait(100);
      await S(([row, fz]) => { row.forEach((e, i) => window.__sangoku.place(e.id, (i - (row.length - 1) / 2) * 24, 92, 0, fz)); window.__sangoku.pause(true); }, [row, fz]);
      await wait(1500);
      await p.screenshot({ path: out(`${grp}-${face}`) });
    }
    await S((row) => row.forEach((e, i) => window.__sangoku.place(e.id, 3000 + i * 40, 3000, 0, 1)), row);
  }
  await S(() => window.__sangoku.pause(false));
  console.error('lineup roles', JSON.stringify(pick(enemyNation).map((e) => e.role)), 'me', me.nation, me.role);
  // 4. Street level in three districts (a crossing near the strategic point), and day / sunset / night at Shibuya.
  // Along the longest street segment near the district's strategic point, looking down the street.
  const street = (sec) => {
    const pt = sites.points[sec];
    const c = sites.streets.filter((g) => g.s === sec && g.kind !== 'alley' && Math.max(g.w, g.d) > 500);
    c.sort((a, b) => Math.hypot(a.x - pt.x, a.z - pt.z) - Math.hypot(b.x - pt.x, b.z - pt.z));
    const g = c[0];
    if (!g) return { x: pt.x, z: pt.z + 230, fx: 0, fz: -1 };
    return g.axis === 'z' ? { x: g.x + g.w * 0.3, z: g.z + g.d / 2 - 120, fx: 0, fz: -1 } : { x: g.x + g.w / 2 - 120, z: g.z + g.d * 0.3, fx: -1, fz: 0 };
  };
  for (const [sec, nm] of [[1, 'shibuya'], [5, 'akihabara'], [4, 'ueno']]) {
    const k = street(sec);
    for (const [f, t] of nm === 'shibuya' ? [[0.03, 'day'], [0.5, 'sunset'], [0.97, 'night']] : [[0.03, 'day'], [0.97, 'night']]) {
      await S(([k, ms]) => { window.__sangoku.setTime(ms); window.__sangoku.teleport(k.x, k.z); window.__sangoku.face(k.fx, k.fz); }, [k, f * 300000]);
      await wait(2300);
      await p.screenshot({ path: out(`${nm}-${t}`) });
    }
  }
  // 5. A stair / ramp entrance (the first ramp inside the loop), day.
  // The tallest flight of stairs inside the loop, from its foot, looking up it.
  const r = sites.ramps.filter((x) => x.style === 'stairs' && x.low < 5 && Math.min(x.w, x.d) > 60).sort((a, b) => b.rise - a.rise)[0];
  if (r) {
    const len = r.axis === 'x' ? r.w : r.d;
    const k = r.axis === 'x' ? { x: r.x - r.dir * (len / 2 + 140), z: r.z, fx: r.dir, fz: 0 } : { x: r.x, z: r.z - r.dir * (len / 2 + 140), fx: 0, fz: r.dir };
    for (const [ms, t] of [[9000, 'day'], [291000, 'night']]) {
      await S(([k, ms]) => { window.__sangoku.setTime(ms); window.__sangoku.teleport(k.x, k.z); window.__sangoku.face(k.fx, k.fz); }, [k, ms]);
      await wait(2300);
      await p.screenshot({ path: out(`stairs-${t}`) });
    }
  }
  console.log(JSON.stringify({ tag, errs, info: await S(() => window.__sangoku.renderInfo()) }));
  await browser.close();
})();
