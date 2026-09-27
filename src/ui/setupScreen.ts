import type { NationId } from '../config/nations';
import { NATION_IDS, NATIONS } from '../config/nations';
import type { RoleId } from '../config/roles';
import { ROLE_INFO, ROLES } from '../config/roles';
import { $ } from './dom';

/** Nation / role picker shown before the match. Calls `onStart` once. */
export function initSetupScreen(onStart: (nation: NationId, role: RoleId) => void): void {
  let selNation: NationId | null = null, selRole: RoleId | null = null;
  const pn = $('pickNation'), pr = $('pickRole'), desc = $('roleDesc');
  for (const n of NATION_IDS) {
    const b = document.createElement('button');
    b.className = 'pickbtn';
    b.textContent = NATIONS[n].name;
    b.style.borderColor = '#' + NATIONS[n].color.toString(16);
    b.onclick = () => {
      selNation = n;
      [...pn.children].forEach((c) => c.classList.remove('sel'));
      b.classList.add('sel');
    };
    pn.appendChild(b);
  }
  for (const r of ROLES) {
    const b = document.createElement('button');
    b.className = 'pickbtn';
    b.textContent = ROLE_INFO[r].n;
    b.onclick = () => {
      selRole = r;
      [...pr.children].forEach((c) => c.classList.remove('sel'));
      b.classList.add('sel');
      desc.textContent = ROLE_INFO[r].d;
    };
    pr.appendChild(b);
  }
  $('btnRandom').onclick = () => {
    const nation = NATION_IDS[Math.floor(Math.random() * 3)], role = ROLES[Math.floor(Math.random() * 6)];
    selNation = nation;
    selRole = role;
    [...pn.children].forEach((c) => c.classList.toggle('sel', c.textContent === NATIONS[nation].name));
    [...pr.children].forEach((c) => c.classList.toggle('sel', c.textContent === ROLE_INFO[role].n));
    desc.textContent = ROLE_INFO[role].d;
  };
  let started = false;
  $('btnStart').onclick = () => {
    if (!selNation || !selRole) { alert('国と役職を選んでください'); return; }
    if (started) return;
    started = true;
    $('setup').style.display = 'none';
    onStart(selNation, selRole);
  };
}
