import * as THREE from 'three';
import { NATIONS } from '../config/nations';
import type { NationId } from '../config/nations';
import { JAIL_TIME, KING_JAIL_EXTRA } from '../config/constants';
import type { GameState } from '../sim/state';
import { sectorPoint } from '../sim/war';
import type { EntityView } from './entityView';

/**
 * Match moments in the TRI//TRACE look (v9.0), all in the faction's colour plus white:
 *
 * - TRACE: a directional scan sweeps from the chaser to the target's back, then a hex
 *   LOCK ring snaps shut round the target.
 * - Capture: a strategic point taken sends two rings pulsing out across the ground.
 * - ANCHOR LOCKED: a slow-turning hex marker and light column over the held ANCHOR for as
 *   long as it is held (the screen-edge pulse and countdown live in the HUD).
 * - NETWORK LOST: a short, strong collapse of light at the fallen faction's LOCK POINTs.
 *
 * Transient pieces share a handful of geometries; each has its own material (faded and
 * disposed when done). Nothing here touches the simulation.
 */

const WHITE = new THREE.Color(0xffffff);
const HEX_RING = new THREE.RingGeometry(0.82, 1, 6, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 6);
const RING = new THREE.RingGeometry(0.9, 1, 48, 1).rotateX(-Math.PI / 2);
/** A 70° wedge of a ring pointing along +Z (the scan). */
const WEDGE = new THREE.RingGeometry(0.15, 1, 16, 1, Math.PI / 2 - 0.61, 1.22).rotateX(-Math.PI / 2);
const COLUMN = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);

interface Fx {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  t: number;
  life: number;
  update: (fx: Fx, k: number) => void;
}

const additive = (color: THREE.ColorRepresentation, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});

export class Vfx {
  private live: Fx[] = [];
  /** One marker per faction for its held ANCHOR (ring + column), shown while held. */
  private markers = new Map<NationId, { ring: THREE.Mesh; col: THREE.Mesh; inner: THREE.Mesh }>();

  constructor(private scene: THREE.Scene, private view: EntityView) {}

  private add(geo: THREE.BufferGeometry, mat: THREE.MeshBasicMaterial, life: number, update: Fx['update']): Fx {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    const fx = { mesh, t: 0, life, update };
    update(fx, 0);
    this.live.push(fx);
    return fx;
  }

  /** A TRACE landed: scan from the chaser toward the target, then a LOCK ring on the target. */
  trace(state: GameState, attackerId: number, targetId: number): void {
    if (!this.view.shown(attackerId) && !this.view.shown(targetId)) return;
    const a = state.entities[attackerId], b = state.entities[targetId];
    const color = new THREE.Color(NATIONS[a.nation].color);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z), dist = Math.max(30, Math.hypot(b.x - a.x, b.z - a.z) + 20);
    const ax = a.x, ay = a.y + 1.5, az = a.z;
    this.add(WEDGE, additive(color, 0.8), 0.35, (fx, k) => {
      fx.mesh.position.set(ax, ay, az);
      fx.mesh.rotation.y = yaw;
      fx.mesh.scale.setScalar(dist * (0.3 + 0.7 * Math.min(1, k * 1.6)));
      fx.mesh.material.opacity = 0.75 * (1 - k);
    });
    const bx = b.x, by = b.y + 1.6, bz = b.z;
    // The LOCK: a hex ring closing in fast, white-hot then the faction colour.
    this.add(HEX_RING, additive(WHITE), 0.6, (fx, k) => {
      fx.mesh.position.set(bx, by, bz);
      const close = Math.min(1, k / 0.35);
      fx.mesh.scale.setScalar(70 - 46 * close * close);
      fx.mesh.rotation.y = close * 1.0;
      fx.mesh.material.color.copy(WHITE).lerp(color, close);
      fx.mesh.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    });
    this.add(COLUMN, additive(color, 0.6), 0.5, (fx, k) => {
      fx.mesh.position.set(bx, b.y, bz);
      fx.mesh.scale.set(14 * (1 - k * 0.6), 70 + 40 * k, 14 * (1 - k * 0.6));
      fx.mesh.material.opacity = 0.55 * (1 - k);
    });
  }

  /** A strategic point changed hands: rings pulse out across the ground in the new holder's colour. */
  capturePulse(sector: number, nation: NationId): void {
    const p = sectorPoint(sector), color = NATIONS[nation].color;
    for (const [delay, max] of [[0, 380], [0.25, 260]] as const) {
      this.add(RING, additive(color, 0.9), 1.3 + delay, (fx, k) => {
        const t = Math.max(0, fx.t - delay) / 1.3;
        fx.mesh.position.set(p.x, p.y + 2, p.z);
        fx.mesh.scale.setScalar(20 + max * (1 - (1 - t) ** 3));
        fx.mesh.material.opacity = t <= 0 ? 0 : 0.9 * (1 - t);
        void k;
      });
    }
  }

  /** NETWORK LOST: light collapses into each of the fallen faction's held people, then is gone. */
  networkLost(state: GameState, nation: NationId): void {
    const color = NATIONS[nation].color;
    const held = state.entities.filter((e) => e.nation === nation && e.jailed);
    const at = held.length ? held : state.entities.filter((e) => e.nation === nation).slice(0, 1);
    for (const e of at) {
      const x = e.x, y = e.y, z = e.z;
      this.add(COLUMN, additive(color, 1), 0.9, (fx, k) => {
        fx.mesh.position.set(x, y, z);
        const s = k < 0.25 ? 60 * (1 - k / 0.25) + 8 : 8 * (1 - (k - 0.25) / 0.75);
        fx.mesh.scale.set(Math.max(0.1, s), 900, Math.max(0.1, s));
        fx.mesh.material.opacity = k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75;
      });
      this.add(RING, additive(WHITE, 1), 0.7, (fx, k) => {
        fx.mesh.position.set(x, y + 2, z);
        fx.mesh.scale.setScalar(260 * (1 - k) + 10);
        fx.mesh.material.opacity = 1 - k;
      });
    }
  }

  /** Per frame: ages the transient effects and keeps the held-ANCHOR markers on their people. */
  sync(state: GameState, dt: number): void {
    for (const fx of this.live) {
      fx.t += dt;
      fx.update(fx, Math.min(1, fx.t / fx.life));
    }
    const done = this.live.filter((fx) => fx.t >= fx.life);
    for (const fx of done) {
      this.scene.remove(fx.mesh);
      fx.mesh.material.dispose();
    }
    if (done.length) this.live = this.live.filter((fx) => fx.t < fx.life);
    const t = state.time / 1000;
    for (const n of ['sun', 'moon', 'star'] as NationId[]) {
      // Shown while the whole map knows where it is held (as the sim reveals it), and always to its own side.
      const k = state.entities.find((e) => e.nation === n && e.role === 'king' && e.alive && e.jailed
        && (n === state.player.nation || (e.capturedBy !== null && state.jailReveal[e.capturedBy] > state.time)));
      let m = this.markers.get(n);
      if (!k) { if (m) m.ring.visible = m.col.visible = m.inner.visible = false; continue; }
      if (!m) {
        const c = NATIONS[n].color;
        m = { ring: new THREE.Mesh(HEX_RING, additive(c, 0.9)), col: new THREE.Mesh(COLUMN, additive(c, 0.22)), inner: new THREE.Mesh(HEX_RING, additive(WHITE, 0.7)) };
        for (const o of [m.ring, m.col, m.inner]) { o.frustumCulled = false; o.renderOrder = 3; this.scene.add(o); }
        this.markers.set(n, m);
      }
      m.ring.visible = m.col.visible = m.inner.visible = true;
      // Faster as the LINK SEVER nears.
      const left = Math.max(0, 1 - (state.time - k.jailedAt) / (JAIL_TIME + KING_JAIL_EXTRA));
      const pulse = 0.5 + 0.5 * Math.sin(t * (3 + 9 * (1 - left)));
      m.ring.position.set(k.x, k.y + 2, k.z);
      m.ring.rotation.y = t * 0.8;
      m.ring.scale.setScalar(44 + 6 * pulse);
      m.inner.position.set(k.x, k.y + 2.2, k.z);
      m.inner.rotation.y = -t * 1.3;
      m.inner.scale.setScalar(26);
      m.col.position.set(k.x, k.y, k.z);
      m.col.scale.set(30, 1200, 30);
      (m.col.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.14 * pulse;
    }
  }
}
