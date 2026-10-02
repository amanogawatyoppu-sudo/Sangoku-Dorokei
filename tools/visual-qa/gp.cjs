// Gameplay regression in the real build: TRACE from behind -> LOCK POINT, stairs climb, meeting opens.
// node gp.cjs <tag> <baseUrl>
const { start, wait } = require('./start9.cjs');
const tag = process.argv[2] ?? 'gp', base = process.argv[3] ?? 'http://localhost:5173/';
const out = (n) => `../qa/${tag}-${n}.png`;
(async () => {
  const { browser, p, errs } = await start({ base, deal: 'moon,soldier' });
  const S = (f, ...a) => p.evaluate(f, ...a);
  const res = {};
  const sites = await S(() => window.__sangoku.sites());
  let people = await S(() => window.__sangoku.people());
  const me = people.find((x) => x.player);
  // 1. TRACE from behind: an enemy (not ANCHOR) just ahead, facing away; press Space a few times.
  const P = sites.points[6];
  await S(([x, z]) => { window.__sangoku.teleport(x, z + 420); window.__sangoku.face(0, 1); }, [P.x, P.z]);
  await wait(800);
  const victim = people.find((x) => x.nation !== me.nation && x.role === 'keyholder' && x.alive && !x.jailed);
  for (let i = 0; i < 6; i++) {
    await S((id) => { window.__sangoku.pause(false); window.__sangoku.place(id, 0, 26, 0, 1); }, victim.id);
    await p.keyboard.press('Space');
    await wait(500);
    people = await S(() => window.__sangoku.people());
    if (people.find((x) => x.id === victim.id).jailed) break;
  }
  const v = people.find((x) => x.id === victim.id);
  res.trace = { victim: victim.id, jailed: v.jailed };
  if (v.jailed) {
    // 2. LOCK POINT: the captive sits at the capturing faction's LOCK POINT.
    const lock = sites.locks[['sun', 'moon', 'star'].indexOf(me.nation)];
    res.lock = { at: [v.x, v.z], lockPoint: [Math.round(lock.x), Math.round(lock.z)], dist: Math.round(Math.hypot(v.x - lock.x, v.z - lock.z)) };
    await S(([x, z]) => { window.__sangoku.teleport(x, z + 260); window.__sangoku.face(0, -1); }, [lock.x, lock.z]);
    await wait(2000);
    await p.screenshot({ path: out('lockpoint') });
  }
  // 3. Stairs: walk up the tallest flight from its foot for a few seconds; the player must climb.
  const r = sites.ramps.filter((x) => x.style === 'stairs' && x.low < 5 && Math.min(x.w, x.d) > 60).sort((a, b) => b.rise - a.rise)[0];
  const len = r.axis === 'x' ? r.w : r.d;
  const k = r.axis === 'x' ? { x: r.x - r.dir * (len / 2 + 40), z: r.z, fx: r.dir, fz: 0 } : { x: r.x, z: r.z - r.dir * (len / 2 + 40), fx: 0, fz: r.dir };
  await S(([k]) => { window.__sangoku.teleport(k.x, k.z); window.__sangoku.face(k.fx, k.fz); }, [k]);
  await wait(600);
  const y0 = (await S(() => window.__sangoku.people())).find((x) => x.player).y;
  const t0 = await S(() => window.__sangoku.time()); await p.keyboard.down("ArrowUp"); await wait(9000); await p.keyboard.up("ArrowUp"); res.stairsSimSec = ((await S(() => window.__sangoku.time())) - t0) / 1000;
  const y1 = (await S(() => window.__sangoku.people())).find((x) => x.player).y;
  res.stairs = { rise: r.rise, y0, y1, climbed: y1 - y0 };
  await p.screenshot({ path: out('stairs-climb') });
  // 4. Meeting: call one in a moment; it must open.
  await S(() => window.__sangoku.meetingIn(1));
  let opened = false;
  for (let i = 0; i < 40 && !opened; i++) { await wait(500); opened = await S(() => window.__sangoku.meeting()); }
  res.meeting = opened;
  if (opened) await p.screenshot({ path: out('meeting') });
  console.log(JSON.stringify({ tag, res, errs }));
  await browser.close();
})();
