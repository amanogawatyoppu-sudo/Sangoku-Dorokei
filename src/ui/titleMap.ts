import { NATIONS, nationCss } from '../config/nations';
import type { NationId } from '../config/nations';
import { BOUNDS, GRID, KANDA, LOOP, PARKS, STATIONS, STREET_SEGS, TOWER, insideLoop, prng } from '../config/map';
import { SECTORS, sectorAt } from '../sim/war';

/**
 * The start screen's backdrop: Tokyo inside the Yamanote loop at dusk as a war map —
 * the three kingdoms' territory glowing in their colours, the fronts between them,
 * the loop line, rivers and avenues lit up, and each sector's name on a plate.
 * Drawn once per size from the game's own map data (not an image).
 */

const hexA = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

export function drawTitleMap(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
  if (W < 2 || H < 2) return;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;

  // Place the (portrait) loop: to the right on wide screens (the title sits left), centred on tall ones.
  const wide = W / H > 1.15;
  const mw = BOUNDS.maxX - BOUNDS.minX, mh = BOUNDS.maxZ - BOUNDS.minZ;
  const s = Math.min((wide ? W * 0.56 : W * 1.02) / mw, (H * (wide ? 1.02 : 0.9)) / mh);
  const ox = wide ? W * 0.64 - (mw * s) / 2 : W / 2 - (mw * s) / 2;
  const oy = H / 2 - (mh * s) / 2;
  const X = (x: number) => ox + (x - BOUNDS.minX) * s, Y = (z: number) => oy + (z - BOUNDS.minZ) * s;

  // Night sky over the city.
  const bg = g.createRadialGradient(ox + (mw * s) / 2, H * 0.45, 0, ox + (mw * s) / 2, H * 0.45, Math.max(W, H) * 0.8);
  bg.addColorStop(0, '#1d2340');
  bg.addColorStop(0.55, '#10131f');
  bg.addColorStop(1, '#07080d');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const loopPath = () => {
    g.beginPath();
    LOOP.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z))));
    g.closePath();
  };

  // Inside the loop: dark ground, then territory glows (additive), clipped to the loop.
  g.save();
  loopPath();
  g.fillStyle = '#161a24';
  g.fill();
  g.clip();
  g.globalCompositeOperation = 'lighter';
  for (const sec of SECTORS) {
    const c = sec.home ? NATIONS[sec.home].color : 0xb8c4ff;
    const r = (sec.home ? 2600 : 1700) * s;
    const grd = g.createRadialGradient(X(sec.center.x), Y(sec.center.z), 0, X(sec.center.x), Y(sec.center.z), r);
    grd.addColorStop(0, hexA(c, sec.home ? 0.5 : 0.12));
    grd.addColorStop(0.6, hexA(c, sec.home ? 0.2 : 0.05));
    grd.addColorStop(1, hexA(c, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  g.globalCompositeOperation = 'source-over';
  // Parks.
  for (const pk of PARKS) {
    g.fillStyle = pk.kind === 'park' ? 'rgba(60,110,70,.55)' : 'rgba(150,140,110,.35)';
    g.fillRect(X(pk.x - pk.w / 2), Y(pk.z - pk.d / 2), pk.w * s, pk.d * s);
  }
  // A dense city: every block of the street grid filled with buildings (dark roofs, a lit edge),
  // tinted by the territory it lies in.
  const rnd = prng(7);
  for (let i = 0; i < GRID.xs.length - 1; i++) {
    for (let k = 0; k < GRID.zs.length - 1; k++) {
      const a = GRID.xs[i], b = GRID.xs[i + 1], c = GRID.zs[k], d = GRID.zs[k + 1];
      const x0 = a.c + a.w / 2, x1 = b.c - b.w / 2, z0 = c.c + c.w / 2, z1 = d.c - d.w / 2;
      if (x1 - x0 < 60 || z1 - z0 < 60 || !insideLoop((x0 + x1) / 2, (z0 + z1) / 2, 0)) continue;
      const home = SECTORS[sectorAt((x0 + x1) / 2, (z0 + z1) / 2)].home;
      const tint = home ? NATIONS[home].color : 0x9aa6c8;
      // Split the block into lots.
      const lots: [number, number, number, number][] = [[x0, z0, x1, z1]];
      for (let n = 0; n < 5; n++) {
        const [lx0, lz0, lx1, lz1] = lots.shift()!;
        const alongX = lx1 - lx0 > lz1 - lz0;
        const t = 0.35 + rnd() * 0.3;
        if (alongX) { const m = lx0 + (lx1 - lx0) * t; lots.push([lx0, lz0, m, lz1], [m, lz0, lx1, lz1]); }
        else { const m = lz0 + (lz1 - lz0) * t; lots.push([lx0, lz0, lx1, m], [lx0, m, lx1, lz1]); }
      }
      for (const [lx0, lz0, lx1, lz1] of lots) {
        if (!insideLoop((lx0 + lx1) / 2, (lz0 + lz1) / 2, 0)) continue;
        const gap = 14, h = rnd();
        const x = X(lx0 + gap), y = Y(lz0 + gap), w = Math.max(1, (lx1 - lx0 - 2 * gap) * s), dd = Math.max(1, (lz1 - lz0 - 2 * gap) * s);
        const shade = 16 + h * 16;
        g.fillStyle = `rgb(${shade + ((tint >> 16) & 255) * 0.1},${shade + 2 + ((tint >> 8) & 255) * 0.1},${shade + 8 + (tint & 255) * 0.1})`;
        g.fillRect(x, y, w, dd);
        g.fillStyle = hexA(tint, 0.25 + h * 0.45);
        g.fillRect(x, y, w, Math.max(0.8, dd * 0.1));
        // Lit windows: a few specks.
        if (h > 0.55) {
          g.fillStyle = 'rgba(255,214,150,.55)';
          for (let q = 0; q < 3; q++) g.fillRect(x + rnd() * w, y + rnd() * dd, 1.2, 1.2);
        }
      }
    }
  }
  // Avenues glow like streams of traffic lights.
  g.globalCompositeOperation = 'lighter';
  for (const st of STREET_SEGS) {
    if (st.kind !== 'avenue' || !insideLoop(st.x, st.z, 0)) continue;
    g.fillStyle = 'rgba(255,196,120,.16)';
    g.fillRect(X(st.x - st.w / 2), Y(st.z - st.d / 2), Math.max(1, st.w * s), Math.max(1, st.d * s));
  }
  g.globalCompositeOperation = 'source-over';
  // Rivers (神田川) and the palace moat.
  g.strokeStyle = 'rgba(90,170,230,.8)';
  g.shadowColor = 'rgba(90,170,255,.9)';
  g.shadowBlur = 10 * dpr;
  g.lineWidth = Math.max(2, 150 * s);
  g.lineJoin = 'round';
  g.beginPath();
  KANDA.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z))));
  g.stroke();
  g.shadowBlur = 0;

  // Fronts: where two nations' territories meet, a burning red line.
  const step = 70;
  g.fillStyle = 'rgba(255,96,70,1)';
  g.shadowColor = 'rgba(255,50,30,1)';
  g.shadowBlur = 12 * dpr;
  for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += step) {
    for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += step) {
      const a = SECTORS[sectorAt(x, z)].home;
      if (!a) continue;
      for (const [dx, dz] of [[step, 0], [0, step]]) {
        const b = SECTORS[sectorAt(x + dx, z + dz)].home;
        if (b && b !== a) g.fillRect(X(x + dx / 2) - 1.8 * dpr, Y(z + dz / 2) - 1.8 * dpr, 3.6 * dpr, 3.6 * dpr);
      }
    }
  }
  g.shadowBlur = 0;
  g.restore();

  // The loop line (山手線): glowing green, with stations.
  g.save();
  loopPath();
  g.strokeStyle = 'rgba(154,205,50,.95)';
  g.lineWidth = 3 * dpr;
  g.shadowColor = 'rgba(154,230,60,.9)';
  g.shadowBlur = 14 * dpr;
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(10,20,5,.8)';
  g.setLineDash([6 * dpr, 6 * dpr]);
  g.lineWidth = 1 * dpr;
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#e8f5d0';
  for (const st of STATIONS) {
    g.beginPath();
    g.arc(X(st.x), Y(st.z), 2.2 * dpr, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // The control tower: a beacon at the centre of it all.
  const tx = X(TOWER.x), ty = Y(TOWER.z);
  const tg = g.createRadialGradient(tx, ty, 0, tx, ty, 60 * dpr);
  tg.addColorStop(0, 'rgba(255,240,200,.9)');
  tg.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = tg;
  g.fillRect(tx - 60 * dpr, ty - 60 * dpr, 120 * dpr, 120 * dpr);

  // Sector plates and the kingdoms' seats.
  const plate = (x: number, y: number, text: string, color: string, big: boolean) => {
    g.font = `800 ${(big ? 15 : 11) * dpr}px 'Shippori Mincho B1', serif`;
    const tw = g.measureText(text).width, ph = (big ? 22 : 17) * dpr, pw = tw + 14 * dpr;
    g.fillStyle = 'rgba(8,10,16,.82)';
    g.strokeStyle = color;
    g.lineWidth = 1.2 * dpr;
    g.beginPath();
    g.rect(x - pw / 2, y - ph / 2, pw, ph);
    g.fill();
    g.stroke();
    g.fillStyle = '#f4ead6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x, y + 1 * dpr);
  };
  for (const sec of SECTORS) plate(X(sec.center.x), Y(sec.center.z) + 26 * dpr, sec.name + '戦区', sec.home ? nationCss(sec.home) : '#8e98b8', false);
  for (const n of ['sun', 'moon', 'star'] as NationId[]) {
    const b = NATIONS[n].base, x = X(b.x), y = Y(b.z);
    const eg = g.createRadialGradient(x, y - 30 * dpr, 0, x, y - 30 * dpr, 48 * dpr);
    eg.addColorStop(0, hexA(NATIONS[n].color, 0.55));
    eg.addColorStop(1, hexA(NATIONS[n].color, 0));
    g.fillStyle = eg;
    g.fillRect(x - 48 * dpr, y - 78 * dpr, 96 * dpr, 96 * dpr);
    g.font = `${30 * dpr}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = nationCss(n);
    g.shadowColor = nationCss(n);
    g.shadowBlur = 16 * dpr;
    g.fillText(NATIONS[n].emblem, x, y - 30 * dpr);
    g.shadowBlur = 0;
    plate(x, y - 62 * dpr, NATIONS[n].name, nationCss(n), true);
  }

  // Vignette so the title and the picks read on top.
  const v = g.createLinearGradient(0, 0, wide ? W : 0, wide ? 0 : H);
  if (wide) {
    v.addColorStop(0, 'rgba(6,7,11,.92)');
    v.addColorStop(0.42, 'rgba(6,7,11,.55)');
    v.addColorStop(0.7, 'rgba(6,7,11,.05)');
    v.addColorStop(1, 'rgba(6,7,11,.3)');
  } else {
    v.addColorStop(0, 'rgba(6,7,11,.35)');
    v.addColorStop(0.3, 'rgba(6,7,11,.72)');
    v.addColorStop(1, 'rgba(6,7,11,.9)');
  }
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}
