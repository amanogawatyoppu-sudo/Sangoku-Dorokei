import type { NationId } from '../config/nations';
import { NATION_IDS, NATIONS, nationCss } from '../config/nations';
import type { RoleId } from '../config/roles';
import type { RosterSize } from '../config/roles';
import { ROLE_INFO, ROLES, ROSTER_SIZES } from '../config/roles';
import { $ } from './dom';
import { drawTitleMap } from './titleMap';
import type { CpuLevel } from '../ai/difficulty';
import { CPU_LEVELS, CPU_LEVEL_NAME } from '../ai/difficulty';
import type { GameMode, Settings } from './flow';
import { canStart, missing, summary } from './flow';

/** One-character seal shown on each role card. */
const ROLE_SEAL: Record<RoleId, string> = { king: '王', soldier: '兵', sniper: '狙', communicator: '通', keyholder: '鍵', ranger: '遊' };

export interface SetupPicks {
  nation: NationId | null;
  role: RoleId | null;
  size: RosterSize;
}

/** What the online lobby needs from the start screen. */
export interface SetupControl {
  picks(): SetupPicks;
  /** Fills in a random nation / role if none was picked. */
  fillPicks(): { nation: NationId; role: RoleId; size: RosterSize };
  onChange(f: () => void): void;
  /** Online: the start button starts the room's match instead (null = back to single player). */
  redirectStart(handler: (() => void) | null, label?: string, disabled?: boolean): void;
  /** Friends in a room don't choose the size; the host does. */
  lockSize(locked: boolean): void;
}

const CPU_DESC: Record<CpuLevel, string> = {
  easy: '初級：CPUの反応が少し遅く、追跡をすぐ諦め、回り込みも少ない。初めての人向け。',
  normal: '標準：いつものCPU。',
  hard: '上級：敵に気付くのが速く、見失っても長く探す。挟み撃ち・先回り・高台や階段を多用し、救出や牢屋の守りの連携も上手い。',
};

/**
 * ゲーム設定: nation, role, size, CPU level and CPU戦 / 対人戦, with a summary and the
 * big start button (only when everything is chosen). Calls `onStart` once.
 */
export function initSetupScreen(initial: Settings, onStart: (s: Settings) => void, onSettings: (s: Settings) => void): SetupControl {
  const cur: Settings = { ...initial };
  let selNation: NationId | null = cur.nation, selRole: RoleId | null = cur.role, selSize: RosterSize = cur.size;
  const pn = $('pickNation'), pr = $('pickRole'), desc = $('roleDesc');
  const select = (row: HTMLElement, key: string, value: string) => {
    for (const c of Array.from(row.children) as HTMLElement[]) c.classList.toggle('sel', c.dataset[key] === value);
  };
  const changed: (() => void)[] = [];
  const fire = () => {
    cur.nation = selNation; cur.role = selRole; cur.size = selSize;
    onSettings({ ...cur });
    for (const f of changed) f();
    refresh();
  };
  const pickNation = (n: NationId) => { selNation = n; select(pn, 'nation', n); fire(); };
  const pickRole = (r: RoleId) => { selRole = r; select(pr, 'role', r); desc.textContent = ROLE_INFO[r].d; fire(); };

  for (const n of NATION_IDS) {
    const b = document.createElement('button');
    b.className = 'pickbtn nation-card';
    b.dataset.nation = n;
    b.style.setProperty('--nc', nationCss(n));
    const em = document.createElement('span');
    em.className = 'emblem';
    em.textContent = NATIONS[n].emblem;
    const name = document.createElement('span');
    name.className = 'nname';
    name.textContent = NATIONS[n].name + '国';
    b.append(em, name);
    b.onclick = () => pickNation(n);
    pn.appendChild(b);
  }
  for (const r of ROLES) {
    const b = document.createElement('button');
    b.className = 'pickbtn role-card';
    b.dataset.role = r;
    const seal = document.createElement('span');
    seal.className = 'seal';
    seal.textContent = ROLE_SEAL[r];
    const name = document.createElement('span');
    name.className = 'rname';
    name.textContent = ROLE_INFO[r].n;
    b.append(seal, name);
    b.onclick = () => pickRole(r);
    pr.appendChild(b);
  }
  // Characters per nation: more people = a livelier city (and a heavier load on phones).
  const ps = $('pickSize');
  const SIZE_NOTE: Record<RosterSize, string> = { 6: '少なめ', 10: '標準', 15: '大人数' };
  for (const n of ROSTER_SIZES) {
    const b = document.createElement('button');
    b.className = 'pickbtn size-card';
    b.dataset.size = String(n);
    b.textContent = `${n}人（${SIZE_NOTE[n]}）`;
    b.onclick = () => { if (sizeLocked) return; selSize = n; select(ps, 'size', String(n)); fire(); };
    ps.appendChild(b);
  }
  select(ps, 'size', String(selSize));
  // CPU level.
  const pc = $('pickCpu'), cpuDesc = $('cpuDesc');
  for (const lv of CPU_LEVELS) {
    const b = document.createElement('button');
    b.className = 'pickbtn size-card cpu-card';
    b.dataset.cpu = lv;
    b.textContent = CPU_LEVEL_NAME[lv] + (lv === 'normal' ? '（おすすめ）' : '');
    b.onclick = () => { cur.cpu = lv; select(pc, 'cpu', lv); cpuDesc.textContent = CPU_DESC[lv]; fire(); };
    pc.appendChild(b);
  }
  select(pc, 'cpu', cur.cpu);
  cpuDesc.textContent = CPU_DESC[cur.cpu];
  // CPU戦 / 対人戦: the room UI only for 対人戦.
  const pm = $('pickMode'), net = $('netBox');
  const MODE_NOTE: Record<GameMode, string> = { cpu: 'CPU戦（あなた以外はCPU）', online: '対人戦（友達と部屋で）' };
  for (const m of ['cpu', 'online'] as GameMode[]) {
    const b = document.createElement('button');
    b.className = 'pickbtn size-card mode-card';
    b.dataset.mode = m;
    b.textContent = MODE_NOTE[m];
    b.onclick = () => { if (redirect) return; cur.mode = m; select(pm, 'mode', m); net.hidden = m !== 'online'; fire(); };
    pm.appendChild(b);
  }
  select(pm, 'mode', cur.mode);
  net.hidden = cur.mode !== 'online';
  if (selNation) select(pn, 'nation', selNation);
  if (selRole) { select(pr, 'role', selRole); desc.textContent = ROLE_INFO[selRole].d; }
  // The war map of Tokyo behind the title and the settings (redrawn when the window changes size).
  const map = $('setupMap') as HTMLCanvasElement;
  const redraw = () => { if ($('setup').style.display !== 'none') drawTitleMap(map); };
  requestAnimationFrame(redraw);
  document.fonts?.ready.then(redraw).catch(() => {});
  let resizeT = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = window.setTimeout(redraw, 150); });
  $('btnRandom').onclick = () => {
    pickNation(NATION_IDS[Math.floor(Math.random() * 3)]);
    pickRole(ROLES[Math.floor(Math.random() * 6)]);
  };
  let started = false, sizeLocked = false;
  let redirect: (() => void) | null = null, redirectLabel = '', redirectDisabled = false;
  const startBtn = $('btnStart') as HTMLButtonElement, missingEl = $('setupMissing'), sum = $('setupSummary');
  /** The summary line and whether the big button can be pressed. */
  function refresh(): void {
    sum.replaceChildren(...summary(cur).map((t, i) => {
      const sp = document.createElement('span');
      sp.textContent = t;
      if ((i === 0 && !cur.nation) || (i === 1 && !cur.role)) sp.className = 'unset';
      return sp;
    }));
    if (redirect) {
      startBtn.textContent = redirectLabel;
      startBtn.disabled = redirectDisabled;
      missingEl.textContent = '';
      return;
    }
    startBtn.textContent = 'ゲームスタート！';
    const miss = missing(cur);
    startBtn.disabled = cur.mode === 'online' || !canStart(cur);
    missingEl.textContent = cur.mode === 'online' ? '対人戦：下の「部屋を作る」か「部屋に参加する」から始めます' : miss.length ? `未選択：${miss.join('・')}` : '';
  }
  startBtn.onclick = () => {
    if (redirect) { redirect(); return; }
    if (!canStart(cur) || started) return;
    started = true;
    onStart({ ...cur });
  };
  refresh();
  return {
    picks: () => ({ nation: selNation, role: selRole, size: selSize }),
    fillPicks: () => {
      if (!selNation) pickNation(NATION_IDS[Math.floor(Math.random() * 3)]);
      if (!selRole) pickRole(ROLES[Math.floor(Math.random() * 6)]);
      return { nation: selNation!, role: selRole!, size: selSize };
    },
    onChange: (f) => { changed.push(f); },
    redirectStart: (handler, label = 'ゲームスタート！', disabled = false) => {
      redirect = handler;
      redirectLabel = label;
      redirectDisabled = disabled;
      refresh();
    },
    lockSize: (locked) => { sizeLocked = locked; ps.classList.toggle('locked', locked); },
  };
}
