import * as THREE from 'three';
import { M } from '../config/map';
import { nameOf } from '../config/names';
import type { GameState } from '../sim/state';
import { PING_ICON, PING_LABEL } from '../sim/ping';
import { PING_COLOR } from '../render/pingView';

const EDGE = 30;

/**
 * On-screen markers for your nation's pings: icon, what it says, who sent it and how
 * far; off-screen ones stick to the edge with an arrow.
 */
export class PingMarkers {
  private els = new Map<number, HTMLDivElement>();
  private v = new THREE.Vector3();

  constructor(private root: HTMLElement) {}

  sync(state: GameState, camera: THREE.Camera, names: Map<number, string>, hidden: boolean): void {
    const p = state.player;
    const mine = hidden ? [] : state.pings.filter((q) => q.nation === p.nation);
    for (const [id, el] of this.els) if (!mine.some((q) => q.id === id)) { el.remove(); this.els.delete(id); }
    const W = this.root.clientWidth, H = this.root.clientHeight;
    for (const q of mine) {
      let el = this.els.get(q.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'pingm';
        el.style.setProperty('--pc', '#' + PING_COLOR[q.kind].toString(16).padStart(6, '0'));
        const who = q.by === p.id ? 'あなた' : names.get(q.by) ?? nameOf(q.by);
        el.innerHTML = `<span class="pm-icon"></span><span class="pm-text"><b></b><small></small></span>`;
        el.querySelector('.pm-icon')!.textContent = PING_ICON[q.kind];
        el.querySelector('b')!.textContent = PING_LABEL[q.kind];
        el.dataset.who = who;
        this.root.append(el);
        this.els.set(q.id, el);
      }
      el.querySelector('small')!.textContent = `${el.dataset.who}・${Math.round(Math.hypot(q.x - p.x, q.z - p.z) / M)}m`;
      this.v.set(q.x, q.y + 120, q.z).project(camera);
      const behind = this.v.z > 1;
      let x = (this.v.x * 0.5 + 0.5) * W, y = (-this.v.y * 0.5 + 0.5) * H;
      if (behind) { x = W - x; y = H - y; }
      const off = behind || x < EDGE || x > W - EDGE || y < EDGE || y > H - EDGE;
      let ang = 0;
      if (off) {
        const cx = W / 2, cy = H / 2;
        let dx = x - cx, dy = y - cy;
        if (behind && Math.abs(dy) < 1) dy = H;
        const k = Math.min((W / 2 - EDGE) / Math.max(1e-3, Math.abs(dx)), (H / 2 - EDGE) / Math.max(1e-3, Math.abs(dy)));
        x = cx + dx * k; y = cy + dy * k;
        ang = Math.atan2(dy, dx);
      }
      el.classList.toggle('off', off);
      el.style.setProperty('--ang', ang + 'rad');
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  }
}
