import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BONES, buildHuman } from '../src/render/humanModel';
import type { Human } from '../src/render/humanModel';
import { buildHumanV2, stripTone } from '../src/render/humanModelV2';
import { gearReveal } from '../src/render/gearReveal';
import { NATIONS, NATION_IDS } from '../src/config/nations';
import { WORLD } from '../src/config/map';
import type { RoleId } from '../src/config/roles';
import { ART_CAMERA_DISTANCE, ART_CAMERA_PITCH, artMode, setArtMode } from '../src/render/artStyle';
import { DIST_MAX, DIST_MIN } from '../src/render/cameraController';
import { DISTRICT_LOOKS, lookFor } from '../src/render/districts';

/** v9.2 art prototype: the SOL RUNNER sample body (v2) and the Shibuya showcase block. */

const ROLES: RoleId[] = ['king', 'soldier', 'sniper', 'communicator', 'keyholder', 'ranger'];
const mat = () => new THREE.MeshBasicMaterial();
const drawn = (g: THREE.BufferGeometry, k: string) => {
  const idx = Array.from(g.index!.array as ArrayLike<number>);
  const n = Math.max(...idx) + 1, a = g.attributes[k];
  return Array.from(a.array as ArrayLike<number>).slice(0, n * a.itemSize);
};
const arr = (g: THREE.BufferGeometry, k: string) => (k === 'index' ? Array.from(g.index!.array as ArrayLike<number>) : drawn(g, k));
const same = (a: THREE.BufferGeometry, b: THREE.BufferGeometry, why: string) => {
  for (const k of ['position', 'color', 'index']) expect(arr(a, k), `${why} ${k}`).toEqual(arr(b, k));
};

/** Lowest and highest skinned point in a pose (as the renderer draws it). */
function extent(h: Human, pose: Partial<Record<(typeof BONES)[number], [number, number, number]>> = {}, hipsY = 0) {
  for (const n of BONES) { const q = pose[n]; h.bones[n].rotation.set(q?.[0] ?? 0, q?.[1] ?? 0, q?.[2] ?? 0); }
  h.bones.hips.position.y = h.rest.hips.y + hipsY;
  h.mesh.updateMatrixWorld(true);
  h.mesh.skeleton.update();
  const v = new THREE.Vector3(), pos = h.mesh.geometry.attributes.position;
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < pos.count; k++) { h.mesh.getVertexPosition(k, v); min = Math.min(min, v.y); max = Math.max(max, v.y); }
  return { min, max };
}

/** The legs of the shared locomotion cycle (entityView) at a ground speed, at phase ph. */
function runLegs(spd: number, ph: number) {
  const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const move = sm(6, 45, spd), run = sm(140, 280, spd), sprint = sm(290, 390, spd);
  const s = Math.sin(ph), c = Math.cos(ph);
  const A = (lerp(0.42, 0.8, run) + 0.14 * sprint) * move, K = (lerp(0.55, 1.55, run) + 0.4 * sprint) * move;
  const swingL = Math.max(0, c), swingR = Math.max(0, -c);
  const thL = -A * s, thR = A * s;
  const knL = K * swingL ** 1.3 + 0.06 + run * 0.22 * (1 - swingL), knR = K * swingR ** 1.3 + 0.06 + run * 0.22 * (1 - swingR);
  return {
    pose: { thighL: [thL, 0, 0.02], thighR: [thR, 0, -0.02], shinL: [knL, 0, 0], shinR: [knR, 0, 0], footL: [-(thL + knL) * 0.75, 0, 0], footR: [-(thR + knR) * 0.75, 0, 0] } as Record<string, [number, number, number]>,
    hipsY: move * (lerp(0.45, 1.3, run) * Math.cos(2 * ph) - run * 1.2),
  };
}

/** Chin to crown of the skin-coloured head pieces, skinned. */
function headHeight(h: Human): number {
  const v = new THREE.Vector3(), pos = h.mesh.geometry.attributes.position, col = h.mesh.geometry.attributes.color;
  const skin = new THREE.Color(h.look.skin);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < pos.count; k++) {
    if (Math.abs(col.getX(k) - skin.r) > 1e-4 || Math.abs(col.getY(k) - skin.g) > 1e-4 || Math.abs(col.getZ(k) - skin.b) > 1e-4) continue;
    h.mesh.getVertexPosition(k, v);
    if (v.y < 36) continue; // hands
    lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
  }
  return hi - lo;
}

// Hues as the app sees them (it renders with colour management off: hex values are used as they are).
const hue = (c: number) => new THREE.Color().setRGB(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, THREE.LinearSRGBColorSpace).getHSL({ h: 0, s: 0, l: 0 }, THREE.LinearSRGBColorSpace);
const hueGap = (a: number, b: number) => { const d = Math.abs(hue(a).h - hue(b).h) * 360; return Math.min(d, 360 - d); };

describe('v2 street-agent body (SOL RUNNER sample)', () => {
  it('builds for any id: stands on the ground, about 1.8 m (≈ 47 units), 5.5–6 heads tall', () => {
    for (const id of [1, 3, 8, 15, 22]) {
      const h = buildHumanV2(id, NATIONS.sun.color, mat(), { role: 'ranger' });
      const { min, max } = extent(h);
      expect(min, `id=${id}`).toBeGreaterThan(-0.6);
      expect(min, `id=${id}`).toBeLessThan(0.6);
      expect(max - min, `id=${id}`).toBeGreaterThan(44);
      expect(max - min, `id=${id}`).toBeLessThan(52);
      // Head: chin to crown (the skull, as figure proportions count it; hair volume not included).
      const headH = headHeight(h);
      const heads = (max - min) / headH;
      expect(heads, `id=${id}`).toBeGreaterThan(5.2);
      expect(heads, `id=${id}`).toBeLessThan(6.4);
      expect(h.mesh.skeleton.bones.length).toBe(BONES.length);
      expect(h.mesh.geometry.morphAttributes.position?.length).toBe(4);
    }
  });

  it('everyone wears the same uniform: the gear-off body (hair and face included) never depends on the role', () => {
    for (const id of [2, 3, 10, 17, 28]) {
      const ref = buildHumanV2(id, 0x57a8ff, mat(), { role: 'soldier' }).geometries.base;
      for (const role of ROLES) same(buildHumanV2(id, 0x57a8ff, mat(), { role }).geometries.base, ref, `${role} id=${id}`);
    }
  });

  it('the ANCHOR has no look of its own: shared uniform, and its own-side kit is a VANGUARD\'s or a RUNNER\'s', () => {
    for (const id of [4, 11, 19]) {
      const king = buildHumanV2(id, 0xff9048, mat(), { role: 'king' });
      for (const r of ['soldier', 'ranger'] as RoleId[]) same(king.geometries.base, buildHumanV2(id, 0xff9048, mat(), { role: r }).geometries.base, `king vs ${r} id=${id}`);
      // No ANCHOR-only hair, back unit or gear: the full kit is exactly a VANGUARD's (odd id) or RUNNER's (even id).
      same(king.geometries.full, buildHumanV2(id, 0xff9048, mat(), { role: id % 2 ? 'soldier' : 'ranger' }).geometries.full, `king kit id=${id}`);
      // And the ANCHOR's gear is never shown to an enemy, whatever it does.
      for (const used of [false, true]) for (const sprinting of [false, true]) expect(gearReveal('king', { used, hpDropped: true, sprinting, aiming: true })).toBe(0);
    }
  });

  it('roles other than ANCHOR have a gear layer (own side / temporary reveal), sharing the uniform\'s buffers', () => {
    for (const role of ROLES.filter((r) => r !== 'king')) {
      const h = buildHumanV2(6, 0xf5e05a, mat(), { role });
      expect(h.geometries.full.index!.count, role).toBeGreaterThan(h.geometries.base.index!.count);
      for (const k of Object.keys(h.geometries.full.attributes)) expect(h.geometries.base.attributes[k]).toBe(h.geometries.full.attributes[k]);
      h.setGear(false);
      expect(h.mesh.geometry).toBe(h.geometries.base);
      h.setGear(true);
      expect(h.mesh.geometry).toBe(h.geometries.full);
    }
  });

  it('a disguise or faction switch repaints the whole body: nothing of the old faction colour is left', () => {
    const h = buildHumanV2(7, NATIONS.sun.color, mat(), { role: 'king' });
    const before = Array.from(h.mesh.geometry.attributes.color.array as ArrayLike<number>);
    h.setNationColor(NATIONS.moon.color);
    const disguised = Array.from(h.mesh.geometry.attributes.color.array as ArrayLike<number>);
    // Same as a LUNA ANCHOR built from scratch.
    const moon = Array.from(buildHumanV2(7, NATIONS.moon.color, mat(), { role: 'king' }).mesh.geometry.attributes.color.array as ArrayLike<number>);
    expect(disguised.map((v) => +v.toFixed(5))).toEqual(moon.map((v) => +v.toFixed(5)));
    expect(disguised).not.toEqual(before);
  });

  it('faction colours stay apart on the body: light strips keep their faction hue (a SOL strip never reads as STAR)', () => {
    for (const n of NATION_IDS) {
      const c = NATIONS[n].color, strip = stripTone(c);
      expect(hueGap(strip, c), n).toBeLessThan(2);
      // Lit strip ≈ colour × (light + glow); still well inside its own hue, far from the others'.
      for (const o of NATION_IDS) if (o !== n) expect(hueGap(strip, NATIONS[o].color), `${n} vs ${o}`).toBeGreaterThan(25);
    }
  });

  it('the shared run / sprint cycle fits the v2 legs: feet reach the ground and never sink', () => {
    for (const spd of [80, 220, 330, 400]) {
      let low = Infinity;
      for (let k = 0; k < 16; k++) {
        const { pose, hipsY } = runLegs(spd, (k / 16) * Math.PI * 2);
        const { min } = extent(buildHumanV2(3, 0xff9048, mat(), { role: 'ranger' }), pose, hipsY);
        expect(min, `spd=${spd} k=${k}`).toBeGreaterThan(-2.5);
        low = Math.min(low, min);
      }
      expect(low, `spd=${spd}`).toBeLessThan(2.5);
    }
  });

  it('v1 bodies are unchanged by the prototype (default look)', () => {
    const h = buildHuman(3, 0xff9048, mat(), { role: 'ranger' });
    expect(extent(h).min).toBeCloseTo(0, 1);
  });
});

describe('art prototype switches', () => {
  it('is off by default; v2 and v2all are opt-in', () => {
    expect(artMode()).toBe('off');
    setArtMode('player');
    expect(artMode()).toBe('player');
    setArtMode('off');
  });

  it('camera: closer and a little flatter, within the player\'s zoom range', () => {
    expect(ART_CAMERA_DISTANCE).toBeGreaterThanOrEqual(DIST_MIN);
    expect(ART_CAMERA_DISTANCE).toBeLessThan(160);
    expect(DIST_MAX).toBeGreaterThan(ART_CAMERA_DISTANCE);
    expect(ART_CAMERA_PITCH).toBeGreaterThan(0.25);
    expect(ART_CAMERA_PITCH).toBeLessThan(0.42);
  });

  it('Shibuya\'s lights avoid the faction hues with the prototype on (and are the v9.1 ones without)', () => {
    expect(lookFor(1)).toBe(DISTRICT_LOOKS[1]);
    setArtMode('player');
    try {
      for (const c of lookFor(1).palette) {
        const { s } = hue(c);
        for (const n of NATION_IDS) if (s > 0.3) expect(hueGap(c, NATIONS[n].color), `${c.toString(16)} vs ${n}`).toBeGreaterThan(24);
      }
    } finally { setArtMode('off'); }
  });
});

describe('Shibuya showcase block (NEON MAZE)', () => {
  /** Just enough of a 2D canvas for the atlas painter (node has none). */
  function fakeDocument() {
    const ctx: Record<string, unknown> = new Proxy({}, {
      get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : k === 'createLinearGradient' ? () => ({ addColorStop: () => {} }) : () => {}),
      set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; return true; },
    });
    return { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  }

  it('is scenery only: few draw calls, a light triangle budget, no change to the world (collision, navigation, stairs)', async () => {
    const g = globalThis as unknown as { document?: unknown };
    const had = g.document;
    g.document = fakeDocument();
    try {
      const before = JSON.stringify(WORLD);
      const { buildShibuyaBlock, showcaseFaces, SHOWCASE } = await import('../src/render/shibuyaBlock');
      const scene = new THREE.Scene();
      const stats = buildShibuyaBlock(scene);
      expect(JSON.stringify(WORLD)).toBe(before);
      const meshes = scene.children.filter((o) => (o as THREE.Mesh).isMesh);
      expect(meshes.length).toBe(scene.children.length);
      expect(meshes.length).toBeLessThanOrEqual(5);
      expect(stats.triangles).toBeLessThan(25000);
      expect(stats.faces).toBeGreaterThanOrEqual(5);
      expect(stats.bays).toBeGreaterThanOrEqual(20);
      expect(stats.arches).toBeGreaterThan(4);
      // Everything sits around the crossing (and the arches under the nearby tracks).
      for (const f of showcaseFaces()) expect(Math.hypot((f.x0 + f.x1) / 2 - SHOWCASE.x, (f.z0 + f.z1) / 2 - SHOWCASE.z)).toBeLessThan(1100);
    } finally { g.document = had; }
  });

  it('its sign and screen colours never use a faction hue', async () => {
    const { SHOWCASE_LIGHTS } = await import('../src/render/shibuyaBlock');
    for (const c of SHOWCASE_LIGHTS) {
      const { s } = hue(c);
      if (s < 0.3) continue; // whites
      for (const n of NATION_IDS) expect(hueGap(c, NATIONS[n].color), `${c.toString(16)} vs ${n}`).toBeGreaterThan(24);
    }
  });
});
