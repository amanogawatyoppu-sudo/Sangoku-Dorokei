import * as THREE from 'three';
import { nationCss } from '../config/nations';
import { nameOf } from '../config/names';
import { roleName } from '../config/roles';
import type { GameState } from '../sim/state';
import { lerp } from './entityView';
import type { EntityView } from './entityView';

/** Beyond this distance a tag shrinks to the name only; beyond FAR it is hidden. */
const NEAR = 900, FAR = 2200;

/**
 * Tags above characters (only while the character is shown):
 * - everyone of your own nation: name and role (your king in gold),
 * - friends in an online match who are on another side: their nickname only.
 * Enemies' roles are never shown.
 */
export class NameTags {
  private tags = new Map<number, { el: HTMLDivElement; role: HTMLSpanElement | null }>();
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();

  constructor(private root: HTMLElement, state: GameState, names: Map<number, string>) {
    root.replaceChildren();
    const me = state.player;
    for (const e of state.entities) {
      if (e.id === me.id) continue;
      const ally = e.nation === me.nation;
      const nick = names.get(e.id);
      if (!ally && !nick) continue;
      const d = document.createElement('div');
      d.className = 'nametag' + (ally ? ' ally' : '') + (ally && e.role === 'king' ? ' king' : '') + (nick ? ' human' : '');
      d.style.setProperty('--nc', nationCss(e.nation));
      const n = document.createElement('span');
      n.className = 'nt-name';
      n.textContent = nick ?? nameOf(e.id);
      d.appendChild(n);
      let role: HTMLSpanElement | null = null;
      if (ally) {
        role = document.createElement('span');
        role.className = 'nt-role';
        role.textContent = (e.role === 'king' ? '♛ ' : '') + roleName(e.role);
        d.appendChild(role);
      }
      d.hidden = true;
      root.appendChild(d);
      this.tags.set(e.id, { el: d, role });
    }
  }

  sync(state: GameState, view: EntityView, camera: THREE.Camera, alpha: number): void {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    const hide = !!state.meeting || state.over;
    for (const [id, t] of this.tags) {
      const e = state.entities[id], d = t.el;
      if (hide || !view.shown(id) || !e.alive) { d.hidden = true; continue; }
      this.w.set(lerp(e.prevX, e.x, alpha), lerp(e.prevY, e.y, alpha) + 58, lerp(e.prevZ, e.z, alpha));
      const far = camera.position.distanceTo(this.w);
      this.v.copy(this.w).project(camera);
      if (this.v.z > 1 || far > FAR) { d.hidden = true; continue; }
      d.hidden = false;
      d.classList.toggle('far', far > NEAR);
      d.classList.toggle('jailed', e.jailed);
      const s = Math.max(0.75, Math.min(1, 1.15 - far / 3000));
      d.style.transform = `translate(${(((this.v.x + 1) / 2) * w).toFixed(1)}px,${(((1 - this.v.y) / 2) * h).toFixed(1)}px) translate(-50%,-100%) scale(${s.toFixed(2)})`;
    }
  }
}
