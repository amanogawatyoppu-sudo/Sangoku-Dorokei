import type { NationId } from '../config/nations';
import { NATION_IDS, NATIONS, nationCss } from '../config/nations';
import type { RoleId } from '../config/roles';
import { ROLE_INFO, ROLES } from '../config/roles';
import { $ } from './dom';

/** One-character seal shown on each role card. */
const ROLE_SEAL: Record<RoleId, string> = { king: '王', soldier: '兵', sniper: '狙', communicator: '通', keyholder: '鍵', impostor: '詐' };

/** Nation / role picker shown before the match. Calls `onStart` once. */
export function initSetupScreen(onStart: (nation: NationId, role: RoleId) => void): void {
  let selNation: NationId | null = null, selRole: RoleId | null = null;
  const pn = $('pickNation'), pr = $('pickRole'), desc = $('roleDesc');
  const select = (row: HTMLElement, key: string, value: string) => {
    for (const c of Array.from(row.children) as HTMLElement[]) c.classList.toggle('sel', c.dataset[key] === value);
  };
  const pickNation = (n: NationId) => { selNation = n; select(pn, 'nation', n); };
  const pickRole = (r: RoleId) => { selRole = r; select(pr, 'role', r); desc.textContent = ROLE_INFO[r].d; };

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
  $('btnRandom').onclick = () => {
    pickNation(NATION_IDS[Math.floor(Math.random() * 3)]);
    pickRole(ROLES[Math.floor(Math.random() * 6)]);
  };
  let started = false;
  $('btnStart').onclick = () => {
    if (!selNation || !selRole) {
      desc.textContent = '所属国と役職を選んでください（「ランダム」でおまかせもできます）。';
      return;
    }
    if (started) return;
    started = true;
    $('setup').style.display = 'none';
    onStart(selNation, selRole);
  };
}
