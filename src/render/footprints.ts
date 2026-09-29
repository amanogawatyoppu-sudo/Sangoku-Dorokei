import * as THREE from 'three';
import type { GameState } from '../sim/state';
import { visibleTo } from '../sim/systems/vision';
import { HEAR_DASH_RANGE, HEAR_RANGE } from '../ai/perception';

const MAX = 160;
const LIFE = 7;          // seconds a print stays
const STRIDE = 34;       // distance between prints
const NEAR = 700;        // prints are only laid near you (they are what you would notice)

/** A shoe print, drawn once. */
function printTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20,18,16,1)';
  g.beginPath(); g.ellipse(16, 20, 11, 17, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(16, 50, 9, 11, 0, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  return t;
}

/**
 * Footprints and footsteps: enemies running near you leave prints on the ground that
 * fade after a few seconds (even round a corner you can see where they went), and
 * footsteps you can hear but not see show as an arc at the edge of the screen,
 * pointing where they come from. Presentation only.
 */
export class Footprints {
  private mesh: THREE.InstancedMesh;
  private prints: { x: number; y: number; z: number; yaw: number; t: number; side: number }[] = [];
  private last = new Map<number, { x: number; z: number; side: number }>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private arcs: HTMLDivElement[] = [];

  constructor(scene: THREE.Scene, hud: HTMLElement) {
    const geo = new THREE.PlaneGeometry(9, 18).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: printTexture(), transparent: true, opacity: 0.55, depthWrite: false, color: 0xffffff,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'steparc';
      d.hidden = true;
      hud.append(d);
      this.arcs.push(d);
    }
  }

  sync(state: GameState, cameraYaw: number): void {
    const p = state.player, now = state.time / 1000;
    // Lay prints for running enemies near you.
    for (const e of state.entities) {
      if (e.nation === p.nation || !e.alive || e.jailed || !e.dashing) { this.last.delete(e.id); continue; }
      if (Math.hypot(e.x - p.x, e.z - p.z) > NEAR) continue;
      const l = this.last.get(e.id);
      if (!l) { this.last.set(e.id, { x: e.x, z: e.z, side: 1 }); continue; }
      const d = Math.hypot(e.x - l.x, e.z - l.z);
      if (d < STRIDE) continue;
      const yaw = Math.atan2(e.x - l.x, e.z - l.z);
      l.side = -l.side;
      this.prints.push({ x: e.x + Math.cos(yaw) * 4 * l.side, y: e.y + 0.9, z: e.z - Math.sin(yaw) * 4 * l.side, yaw, t: now, side: l.side });
      l.x = e.x; l.z = e.z;
    }
    this.prints = this.prints.filter((f) => now - f.t < LIFE).slice(-MAX);
    this.prints.forEach((f, i) => {
      const k = 1 - (now - f.t) / LIFE;
      this.q.setFromAxisAngle(this.up, f.yaw);
      this.m.compose(new THREE.Vector3(f.x, f.y, f.z), this.q, new THREE.Vector3(k, 1, k));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.count = this.prints.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Footsteps heard but not seen: an arc at the screen edge toward them.
    const heard = p.alive ? state.entities
      .filter((e) => e.nation !== p.nation && e.alive && !e.jailed && Math.abs(e.y - p.y) < 40 && !visibleTo(state, e, p))
      .map((e) => ({ e, d: Math.hypot(e.x - p.x, e.z - p.z) }))
      .filter(({ e, d }) => d < (e.dashing ? HEAR_DASH_RANGE : HEAR_RANGE * 0.9))
      .sort((a, b) => a.d - b.d).slice(0, 3) : [];
    this.arcs.forEach((a, i) => {
      const h = heard[i];
      a.hidden = !h;
      if (!h) return;
      // Screen angle: 0 = straight ahead (top of the screen), clockwise.
      const ang = Math.atan2(h.e.x - p.x, h.e.z - p.z) - cameraYaw;
      const loud = h.e.dashing ? 1 : 0.55;
      a.style.setProperty('--a', `${-ang}rad`);
      a.style.opacity = String(loud * (1 - h.d / HEAR_DASH_RANGE * 0.5));
    });
  }
}
