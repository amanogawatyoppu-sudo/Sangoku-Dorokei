import * as THREE from 'three';
import { NATIONS, nationCss } from '../config/nations';
import { M } from '../config/map';
import type { GameState } from '../sim/state';
import { SECTORS, sectorPoint } from '../sim/war';

/** Show the full label (name, distance) for the nearest few, and every contested point or one being captured. */
const FULL_NEAREST = 3;
const EDGE = 28;

interface Marker { el: HTMLDivElement; icon: HTMLSpanElement; name: HTMLSpanElement; dist: HTMLSpanElement; tag: HTMLSpanElement; owner: string }

/**
 * Objective markers over the strategic points: the holder's crest in a ring that fills
 * as someone captures it, the sector's name and distance, and 交戦中 when contested.
 * Off-screen points stick to the screen edge with an arrow. Nine DOM nodes, moved with
 * transforms every frame.
 */
export class ObjectiveMarkers {
  private markers: Marker[] = [];
  private v = new THREE.Vector3();
  private pts = SECTORS.map((_s, i) => { const p = sectorPoint(i); return new THREE.Vector3(p.x, p.y, p.z); });

  constructor(private root: HTMLElement) {
    for (let i = 0; i < SECTORS.length; i++) {
      const el = document.createElement('div');
      el.className = 'objm';
      const icon = document.createElement('span'), label = document.createElement('span'), name = document.createElement('span'), dist = document.createElement('span'), tag = document.createElement('span');
      icon.className = 'objm-icon'; label.className = 'objm-label'; name.className = 'objm-name'; dist.className = 'objm-dist'; tag.className = 'objm-tag';
      name.textContent = SECTORS[i].name;
      tag.textContent = '交戦中';
      label.append(name, dist);
      el.append(icon, label, tag);
      root.append(el);
      this.markers.push({ el, icon, name, dist, tag, owner: '?' });
    }
  }

  sync(state: GameState, camera: THREE.Camera, hidden: boolean): void {
    const W = this.root.clientWidth, H = this.root.clientHeight;
    const p = state.player;
    const d = this.pts.map((q) => Math.hypot(q.x - p.x, q.z - p.z));
    const near = new Set([...d.keys()].sort((a, b) => d[a] - d[b]).slice(0, FULL_NEAREST));
    this.markers.forEach((m, i) => {
      if (hidden) { m.el.style.display = 'none'; return; }
      const s = state.war.sectors[i];
      const key = (s.owner ?? '-') + (s.capturer ?? '-');
      if (key !== m.owner) {
        m.owner = key;
        m.el.style.setProperty('--oc', s.owner ? nationCss(s.owner) : '#8d877b');
        m.el.style.setProperty('--cc', s.capturer ? nationCss(s.capturer) : '#fff');
        m.icon.textContent = s.owner ? NATIONS[s.owner].emblem : '―';
        m.el.classList.toggle('mine', s.owner === p.nation);
      }
      m.el.style.setProperty('--pg', String(s.capturer ? s.progress : 0));
      const important = s.contested || near.has(i) || (!!s.capturer && s.progress > 0);
      m.el.classList.toggle('full', important);
      m.el.classList.toggle('contested', s.contested);
      m.dist.textContent = Math.round(d[i] / M) + 'm';
      // Project; points behind the camera are flipped so the edge arrow still points the right way.
      // High above distant points (seen over the roofs), down at head height when you are at one.
      this.v.copy(this.pts[i]);
      this.v.y += 60 + 170 * Math.min(1, d[i] / 900);
      this.v.project(camera);
      const behind = this.v.z > 1;
      let x = (this.v.x * 0.5 + 0.5) * W, y = (-this.v.y * 0.5 + 0.5) * H;
      if (behind) { x = W - x; y = H - y; }
      const off = behind || x < EDGE || x > W - EDGE || y < EDGE + 20 || y > H - EDGE;
      let ang = 0;
      if (off) {
        const cx = W / 2, cy = H / 2;
        let dx = x - cx, dy = y - cy;
        if (behind && Math.abs(dy) < 1) dy = H; // straight behind: point down
        const k = Math.min((W / 2 - EDGE) / Math.max(1e-3, Math.abs(dx)), (H / 2 - EDGE - 20) / Math.max(1e-3, Math.abs(dy)));
        dx *= k; dy *= k;
        x = cx + dx; y = cy + dy;
        ang = Math.atan2(dy, dx);
      }
      m.el.classList.toggle('off', off);
      m.el.style.setProperty('--ang', ang + 'rad');
      // Far markers get smaller (but stay readable).
      const scale = off ? 0.85 : Math.max(0.7, Math.min(1.05, 1.25 - d[i] / 6000));
      m.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${scale.toFixed(2)})`;
      // Only what matters sticks to the screen edge (near, frontline, contested).
      m.el.style.display = off && !important ? 'none' : '';
    });
  }
}
