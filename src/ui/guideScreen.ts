import { NATIONS, NATION_IDS, nationCss } from '../config/nations';
import { DISTRICT_CODES } from '../config/terminology';
import type { NationId } from '../config/nations';
import { BOUNDS, KANDA, LOOP, STATIONS, TOWER } from '../config/map';
import { SECTORS, neighbours, sectorAt } from '../sim/war';
import { $ } from './dom';
import type { GlossaryCat } from './glossary';
import { GLOSSARY_CATS, searchGlossary } from './glossary';

/**
 * 用語・戦場マップ (from the title): the game's words, searchable by category, and
 * the battlefield — the nine sectors on a map you can tap for each one's details.
 */

const hexA = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

/** Which sector holds each kingdom's base and jail, and the tower. */
function sitesIn(id: number): string[] {
  const out: string[] = [];
  for (const n of NATION_IDS) {
    if (sectorAt(NATIONS[n].base.x, NATIONS[n].base.z) === id) out.push(`${NATIONS[n].name}の拠点（スタート地点）`);
    if (sectorAt(NATIONS[n].jail.x, NATIONS[n].jail.z) === id) out.push(`${NATIONS[n].name}のLOCK POINT`);
  }
  if (sectorAt(TOWER.x, TOWER.z) === id) out.push('管制塔（日比谷公園の電波塔）');
  return out;
}

const homeName = (h: NationId | null) => (h ? NATIONS[h].name : '中立');

export interface GuideControl {
  /** Draw the map (the tab may have been hidden while sizing). */
  show(): void;
}

export function initGuideScreen(): GuideControl {
  // ---- tabs
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#guideTabs button'));
  const panes: Record<string, HTMLElement> = { terms: $('guideTerms'), map: $('guideMap') };
  const pick = (name: string) => {
    for (const t of tabs) { const on = t.dataset.tab === name; t.classList.toggle('sel', on); t.setAttribute('aria-selected', String(on)); }
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
    if (name === 'map') requestAnimationFrame(drawMap);
  };
  for (const t of tabs) t.onclick = () => pick(t.dataset.tab!);

  // ---- glossary
  const q = $('glossQ') as HTMLInputElement, list = $('glossList'), cats = $('glossCats');
  let cat: GlossaryCat | null = null;
  const catBtns = [null, ...GLOSSARY_CATS].map((c) => {
    const b = document.createElement('button');
    b.className = 'pickbtn gl-cat';
    b.textContent = c ?? 'すべて';
    b.onclick = () => { cat = c; renderTerms(); };
    cats.append(b);
    return [c, b] as const;
  });
  function renderTerms(): void {
    for (const [c, b] of catBtns) b.classList.toggle('sel', c === cat);
    const found = searchGlossary(q.value, cat);
    list.replaceChildren(...found.map((t) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = t.term;
      const tag = document.createElement('small');
      tag.textContent = t.cat;
      dt.append(tag);
      dd.textContent = t.text;
      return [dt, dd];
    }).flat());
    if (!found.length) {
      const p = document.createElement('p');
      p.className = 'gl-none';
      p.textContent = '見つかりませんでした';
      list.append(p);
    }
  }
  q.oninput = renderTerms;
  renderTerms();

  // ---- map
  const canvas = $('guideCanvas') as HTMLCanvasElement, card = $('sectorCard'), secList = $('sectorList');
  let sel = 6; // 中央: the tower, where the three meet
  let proj: { X: (x: number) => number; Y: (z: number) => number; inv: (px: number, py: number) => { x: number; z: number } } | null = null;
  const secBtns = SECTORS.map((s) => {
    const b = document.createElement('button');
    b.className = 'pickbtn sec-btn';
    b.style.setProperty('--nc', s.home ? nationCss(s.home) : '#8e98b8');
    b.textContent = `${s.id + 1} ${s.name}`;
    b.onclick = () => select(s.id);
    secList.append(b);
    return b;
  });

  function select(id: number): void {
    sel = id;
    secBtns.forEach((b, i) => b.classList.toggle('sel', i === id));
    const s = SECTORS[id];
    card.style.setProperty('--nc', s.home ? nationCss(s.home) : '#8e98b8');
    card.replaceChildren();
    const h = document.createElement('h3');
    h.textContent = `${id + 1}. ${s.name}戦区`;
    const owner = document.createElement('span');
    owner.className = 'sc-owner';
    owner.textContent = s.home ? `${NATIONS[s.home].emblem} 最初の支配：${homeName(s.home)}` : '最初の支配：中立（どの勢力のものでもない）';
    const dl = document.createElement('dl');
    const row = (a: string, b: string) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = a; dd.textContent = b; dl.append(dt, dd); };
    row('戦略拠点', s.pointName + (s.pointNear.y && !s.pointName.includes('高台') ? '（高台の上）' : ''));
    row('コード', DISTRICT_CODES[s.id]);
    row('特徴', s.style);
    const here = sitesIn(id);
    if (here.length) row('ここにあるもの', here.join('・'));
    row('となりの戦区', [...neighbours(id)].sort((a, b) => a - b).map((n) => `${SECTORS[n].name}（${homeName(SECTORS[n].home)}）`).join('・'));
    card.append(h, owner, dl);
    drawMap();
  }

  function drawMap(): void {
    if (panes.map.hidden) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (W < 2 || H < 2) return;
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const mw = BOUNDS.maxX - BOUNDS.minX, mh = BOUNDS.maxZ - BOUNDS.minZ;
    const s = Math.min((W * 0.96) / mw, (H * 0.96) / mh);
    const ox = W / 2 - (mw * s) / 2, oy = H / 2 - (mh * s) / 2;
    const X = (x: number) => ox + (x - BOUNDS.minX) * s, Y = (z: number) => oy + (z - BOUNDS.minZ) * s;
    proj = { X, Y, inv: (px, py) => ({ x: (px * dpr - ox) / s + BOUNDS.minX, z: (py * dpr - oy) / s + BOUNDS.minZ }) };
    g.clearRect(0, 0, W, H);
    const loop = () => { g.beginPath(); LOOP.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z)))); g.closePath(); };
    // Sectors, cell by cell (each spot belongs to the nearest sector centre).
    g.save();
    loop();
    g.clip();
    const cell = Math.max(3, Math.round(5 * dpr));
    for (let py = 0; py < H; py += cell) {
      for (let px = 0; px < W; px += cell) {
        const x = (px + cell / 2 - ox) / s + BOUNDS.minX, z = (py + cell / 2 - oy) / s + BOUNDS.minZ;
        const id = sectorAt(x, z), home = SECTORS[id].home;
        const c = home ? NATIONS[home].color : 0x9aa6c8;
        g.fillStyle = hexA(c, id === sel ? 0.62 : home ? 0.26 : 0.12);
        g.fillRect(px, py, cell, cell);
        // Borders between sectors: red where two nations meet (a front), grey otherwise.
        const right = sectorAt(x + cell / s, z), down = sectorAt(x, z + cell / s);
        if (right !== id || down !== id) {
          const other = SECTORS[right !== id ? right : down].home;
          g.fillStyle = home && other && home !== other ? 'rgba(255,90,70,.95)' : 'rgba(220,226,240,.35)';
          g.fillRect(px + cell / 2 - dpr, py + cell / 2 - dpr, 2 * dpr, 2 * dpr);
        }
      }
    }
    // The river.
    g.strokeStyle = 'rgba(90,170,230,.85)';
    g.lineWidth = Math.max(2, 120 * s);
    g.lineJoin = 'round';
    g.beginPath();
    KANDA.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z))));
    g.stroke();
    g.restore();
    // The loop line and stations.
    loop();
    g.strokeStyle = 'rgba(154,205,50,.9)';
    g.lineWidth = 2.5 * dpr;
    g.stroke();
    g.fillStyle = '#e8f5d0';
    for (const st of STATIONS) { g.beginPath(); g.arc(X(st.x), Y(st.z), 1.8 * dpr, 0, Math.PI * 2); g.fill(); }
    // Icons: strategic points, bases, jails, tower.
    const icon = (x: number, y: number, text: string, bg: string, r = 9) => {
      g.beginPath();
      g.arc(x, y, r * dpr, 0, Math.PI * 2);
      g.fillStyle = bg;
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.lineWidth = 1.5 * dpr;
      g.stroke();
      g.fillStyle = '#fff';
      g.font = `800 ${r * 1.15 * dpr}px 'Zen Kaku Gothic New', sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, x, y + 0.5 * dpr);
    };
    // Icons first as positions, so each sector's name plate can sit clear of them.
    const icons: [number, number, string, string, number][] = [];
    for (const sec of SECTORS) icons.push([X(sec.pointNear.x), Y(sec.pointNear.z), '旗', sec.home ? nationCss(sec.home) : '#6e7898', 8]);
    for (const n of NATION_IDS) {
      icons.push([X(NATIONS[n].base.x), Y(NATIONS[n].base.z), NATIONS[n].emblem, nationCss(n), 12]);
      icons.push([X(NATIONS[n].jail.x), Y(NATIONS[n].jail.z), 'L', '#3a2a2a', 9]);
    }
    icons.push([X(TOWER.x), Y(TOWER.z), '塔', '#c9a24e', 11]);
    // Smaller plates on a small map.
    const fs = Math.max(9, Math.min(12, W / dpr / 32));
    g.font = `800 ${fs * dpr}px 'Shippori Mincho B1', serif`;
    const placed: [number, number, number, number][] = [];
    const clear = (x0: number, y0: number, x1: number, y1: number) =>
      icons.every(([ix, iy, , , r]) => ix + r * dpr + 2 < x0 || ix - r * dpr - 2 > x1 || iy + r * dpr + 2 < y0 || iy - r * dpr - 2 > y1)
      && placed.every(([a0, b0, a1, b1]) => a1 < x0 || a0 > x1 || b1 < y0 || b0 > y1);
    for (const sec of SECTORS) {
      const label = `${sec.id + 1} ${sec.name}`;
      const tw = g.measureText(label).width + fs * dpr, th = fs * 1.7 * dpr;
      const cx = X(sec.center.x), cy = Y(sec.center.z);
      let lx = cx, ly = cy;
      for (const [dx, dy] of [[0, -16], [0, 18], [0, -34], [0, 34], [-36, 0], [36, 0], [-30, -22], [30, -22], [-30, 22], [30, 22], [0, 0]]) {
        const x = Math.max(tw / 2 + 2, Math.min(W - tw / 2 - 2, cx + dx * dpr)), y = Math.max(th / 2 + 2, Math.min(H - th / 2 - 2, cy + dy * dpr));
        // Only spots inside the sector itself, so a plate never names the wrong area.
        const mine = sectorAt((x - ox) / s + BOUNDS.minX, (y - oy) / s + BOUNDS.minZ) === sec.id;
        if (mine && clear(x - tw / 2, y - th / 2, x + tw / 2, y + th / 2)) { lx = x; ly = y; break; }
      }
      placed.push([lx - tw / 2, ly - th / 2, lx + tw / 2, ly + th / 2]);
      g.fillStyle = sec.id === sel ? 'rgba(243,212,138,.95)' : 'rgba(8,10,16,.85)';
      g.fillRect(lx - tw / 2, ly - th / 2, tw, th);
      g.fillStyle = sec.id === sel ? '#1b1405' : '#f4ead6';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, lx, ly + 1 * dpr);
    }
    for (const [x, y, t, bg, r] of icons) icon(x, y, t, bg, r);
  }

  canvas.onclick = (ev) => {
    if (!proj) return;
    const r = canvas.getBoundingClientRect();
    const p = proj.inv(ev.clientX - r.left, ev.clientY - r.top);
    select(sectorAt(p.x, p.z));
  };
  window.addEventListener('resize', () => { if (!panes.map.hidden) drawMap(); });
  select(sel);
  pick('terms');
  return { show: () => { if (!panes.map.hidden) requestAnimationFrame(drawMap); } };
}
