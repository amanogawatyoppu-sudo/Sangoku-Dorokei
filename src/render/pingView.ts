import * as THREE from 'three';
import type { NationId } from '../config/nations';
import type { GameState } from '../sim/state';
import type { PingKind } from '../sim/ping';
import { PING_TIME } from '../sim/ping';
import { radialGlowTexture } from './textures';

export const PING_COLOR: Record<PingKind, number> = { king: 0xffd24a, help: 0xff5a4a, gather: 0x6ee08c, danger: 0xff9a2a };

const POOL = 8;

/**
 * Pings in the world for the viewer's nation: a pulsing ring on the ground, a short
 * column of light and a glow, in the ping's colour. A small pool of meshes, reused.
 */
export class PingView {
  private items: { group: THREE.Group; ring: THREE.Mesh; beam: THREE.Mesh; glow: THREE.Sprite }[] = [];

  constructor(scene: THREE.Scene) {
    const ringGeo = new THREE.RingGeometry(34, 42, 40).rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(4, 10, 320, 12, 1, true).translate(0, 160, 0);
    const glowTex = radialGlowTexture();
    for (let i = 0; i < POOL; i++) {
      const add = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const ring = new THREE.Mesh(ringGeo, add());
      const beam = new THREE.Mesh(beamGeo, add());
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      glow.scale.set(90, 90, 1);
      glow.position.y = 300;
      ring.position.y = 2;
      ring.renderOrder = beam.renderOrder = glow.renderOrder = 4;
      const group = new THREE.Group();
      group.add(ring, beam, glow);
      group.visible = false;
      scene.add(group);
      this.items.push({ group, ring, beam, glow });
    }
  }

  sync(state: GameState, viewer: NationId): void {
    const mine = state.pings.filter((p) => p.nation === viewer);
    this.items.forEach((it, i) => {
      const p = mine[i];
      it.group.visible = !!p;
      if (!p) return;
      const age = (state.time - p.t) / 1000, left = Math.max(0, PING_TIME / 1000 - age);
      const fade = Math.min(1, left / 2) * Math.min(1, age * 4 + 0.2);
      const c = PING_COLOR[p.kind];
      it.group.position.set(p.x, p.y, p.z);
      const pulse = 1 + 0.35 * ((age * 1.4) % 1);
      it.ring.scale.set(pulse, 1, pulse);
      for (const m of [it.ring.material, it.beam.material, it.glow.material] as (THREE.MeshBasicMaterial | THREE.SpriteMaterial)[]) m.color.setHex(c);
      (it.ring.material as THREE.MeshBasicMaterial).opacity = fade * (1.2 - (pulse - 1) * 2);
      (it.beam.material as THREE.MeshBasicMaterial).opacity = fade * 0.55;
      it.glow.material.opacity = fade * 0.9;
    });
  }
}
