import * as THREE from 'three';
import { nationCss } from '../config/nations';
import type { GameState } from '../sim/state';
import { lerp } from './entityView';
import type { EntityView } from './entityView';

/** Nicknames above friends' characters in an online match (only while the character is shown). */
export class NameTags {
  private tags = new Map<number, HTMLDivElement>();
  private v = new THREE.Vector3();

  constructor(private root: HTMLElement, state: GameState, names: Map<number, string>) {
    root.replaceChildren();
    for (const [id, name] of names) {
      if (id === state.player.id) continue;
      const d = document.createElement('div');
      d.className = 'nametag';
      d.textContent = name;
      d.style.setProperty('--nc', nationCss(state.entities[id].nation));
      d.hidden = true;
      root.appendChild(d);
      this.tags.set(id, d);
    }
  }

  sync(state: GameState, view: EntityView, camera: THREE.Camera, alpha: number): void {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    for (const [id, d] of this.tags) {
      const e = state.entities[id];
      if (!view.shown(id) || !e.alive) { d.hidden = true; continue; }
      this.v.set(lerp(e.prevX, e.x, alpha), lerp(e.prevY, e.y, alpha) + 58, lerp(e.prevZ, e.z, alpha)).project(camera);
      const far = camera.position.distanceTo(new THREE.Vector3(e.x, e.y, e.z));
      if (this.v.z > 1 || far > 2600) { d.hidden = true; continue; }
      d.hidden = false;
      d.style.left = ((this.v.x + 1) / 2) * w + 'px';
      d.style.top = ((1 - this.v.y) / 2) * h + 'px';
    }
  }
}
