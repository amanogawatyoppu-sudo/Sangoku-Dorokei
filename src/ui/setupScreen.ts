import type { NationId } from '../config/nations';
import { NATION_IDS, NATIONS, nationCss } from '../config/nations';
import type { RoleId } from '../config/roles';
import type { RosterSize } from '../config/roles';
import { ROLE_INFO, ROLES, ROSTER_SIZES } from '../config/roles';
import { $ } from './dom';
import { drawTitleMap } from './titleMap';

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

/** Nation / role picker shown before the match. Calls `onStart` once. */
export function initSetupScreen(onStart: (nation: NationId, role: RoleId, size: RosterSize) => void): SetupControl {
  let selNation: NationId | null = null, selRole: RoleId | null = null, selSize: RosterSize = 10;
  const pn = $('pickNation'), pr = $('pickRole'), desc = $('roleDesc');
  const select = (row: HTMLElement, key: string, value: string) => {
    for (const c of Array.from(row.children) as HTMLElement[]) c.classList.toggle('sel', c.dataset[key] === value);
  };
  const changed: (() => void)[] = [];
  const fire = () => { for (const f of changed) f(); };
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
  // The war map of Tokyo behind the title (redrawn when the window changes size).
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
  let redirect: (() => void) | null = null;
  const startBtn = $('btnStart') as HTMLButtonElement;
  startBtn.onclick = () => {
    if (redirect) { redirect(); return; }
    if (!selNation || !selRole) {
      desc.textContent = '所属国と役職を選んでください（「ランダム」でおまかせもできます）。';
      return;
    }
    if (started) return;
    started = true;
    $('setup').style.display = 'none';
    onStart(selNation, selRole, selSize);
  };
  return {
    picks: () => ({ nation: selNation, role: selRole, size: selSize }),
    fillPicks: () => {
      if (!selNation) pickNation(NATION_IDS[Math.floor(Math.random() * 3)]);
      if (!selRole) pickRole(ROLES[Math.floor(Math.random() * 6)]);
      return { nation: selNation!, role: selRole!, size: selSize };
    },
    onChange: (f) => { changed.push(f); },
    redirectStart: (handler, label = 'ゲーム開始', disabled = false) => {
      redirect = handler;
      startBtn.textContent = label;
      startBtn.disabled = disabled;
    },
    lockSize: (locked) => { sizeLocked = locked; ps.classList.toggle('locked', locked); },
  };
}
