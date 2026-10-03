import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLB_CLIPS, GLB_FILES, GLB_GAME_HEIGHT, parseGlb } from '../src/render/glbCharacter';
import { MESHY_FEET_Y, MeshyCharacter } from '../src/render/meshyCharacter';
import { NATIONS } from '../src/config/nations';
import url60 from '../public/characters/TRI_TRACE_SOL_60k_rig_experimental.glb?inline';
import url40 from '../public/characters/TRI_TRACE_SOL_40k_rig_experimental.glb?inline';

/**
 * Auto-rigged Meshy SOL (?glb=meshy / meshy40), player only. Node has no image decoder,
 * so the textures are stripped from the file before parsing (geometry, skin and clips intact).
 */
function bytesWithoutImages(dataUrl: string): ArrayBuffer {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const dv = new DataView(u.buffer);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(u.subarray(20, 20 + jsonLen)));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.normalTexture;
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jb = new TextEncoder().encode(text);
  const rest = u.subarray(20 + jsonLen);
  const out = new Uint8Array(12 + 8 + jb.length + rest.length);
  const o = new DataView(out.buffer);
  out.set(u.subarray(0, 12));
  o.setUint32(8, out.length, true);
  o.setUint32(12, jb.length, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(jb, 20);
  out.set(rest, 20 + jb.length);
  return out.buffer;
}
const load = async (u = url60) => new MeshyCharacter(await parseGlb(bytesWithoutImages(u)));

/** World-space bounds of the skinned body at clip time t (or the bind pose). */
function bounds(m: MeshyCharacter, clip: string | null, t = 0): THREE.Box3 {
  for (const a of m.actions.values()) a.stop();
  if (clip) {
    const act = m.actions.get(clip as never)!;
    act.reset().play();
    act.time = t;
    act.setEffectiveWeight(1);
  }
  m.mixer.update(0);
  m.root.updateMatrixWorld(true);
  m.body.skeleton.update();
  const box = new THREE.Box3(), v = new THREE.Vector3(), n = m.body.geometry.attributes.position.count;
  for (let i = 0; i < n; i += 3) { m.body.getVertexPosition(i, v); box.expandByPoint(v.applyMatrix4(m.body.matrixWorld)); }
  return box;
}

describe('Meshy auto-rigged SOL (player-only test model)', () => {
  it('lives outside the page bundle (fetched only when ?glb=meshy / meshy40 is on)', () => {
    expect(GLB_FILES.meshy).toBe('characters/TRI_TRACE_SOL_60k_rig_experimental.glb');
    expect(GLB_FILES.meshy40).toBe('characters/TRI_TRACE_SOL_40k_rig_experimental.glb');
  });

  it('is one skinned mesh with 19 joints and the six clips', async () => {
    for (const [u, tris] of [[url60, 60000], [url40, 40000]] as const) {
      const m = await load(u);
      expect(m.stats.triangles).toBe(tris);
      expect(m.body.skeleton.bones.length).toBe(19);
      expect([...m.actions.keys()].sort()).toEqual([...GLB_CLIPS].sort());
    }
  });

  it('has no root motion: the hips only bob, the simulation does the moving', async () => {
    const m = await load();
    for (const a of m.actions.values()) {
      for (const t of a.getClip().tracks) {
        if (!t.name.endsWith('.position')) continue;
        for (let i = 0; i < t.values.length; i += 3) { expect(t.values[i]).toBe(0); expect(t.values[i + 2]).toBe(0); }
      }
    }
  });

  it('stands on the ground at game height (feet from y ≈ −0.95 lifted by the parent group only)', async () => {
    const m = await load();
    expect(m.fit.position.y).toBeCloseTo(-MESHY_FEET_Y * m.fit.scale.y, 5);
    const rest = bounds(m, null);
    expect(Math.abs(rest.min.y)).toBeLessThan(1.5);
    expect(rest.max.y).toBeGreaterThan(GLB_GAME_HEIGHT * 0.95);
    expect(rest.max.y).toBeLessThan(GLB_GAME_HEIGHT * 1.05);
  });

  it('every clip keeps the feet on the ground and the body in one piece (no flying vertices)', async () => {
    const m = await load();
    const rest = bounds(m, null), restSize = rest.getSize(new THREE.Vector3());
    for (const clip of GLB_CLIPS) {
      const dur = m.actions.get(clip)!.getClip().duration;
      let lowest = Infinity;
      for (let k = 0; k < 8; k++) {
        const b = bounds(m, clip, (k / 8) * dur), size = b.getSize(new THREE.Vector3());
        expect(Number.isFinite(b.min.x + b.max.y), `${clip} k=${k}`).toBe(true);
        expect(b.min.y, `${clip} k=${k}`).toBeGreaterThan(-3);
        expect(size.x, `${clip} k=${k}`).toBeLessThan(restSize.x * 1.6);
        expect(size.z, `${clip} k=${k}`).toBeLessThan(Math.max(restSize.z * 2.2, 40));
        expect(b.max.y, `${clip} k=${k}`).toBeLessThan(GLB_GAME_HEIGHT * 1.08);
        lowest = Math.min(lowest, b.min.y);
      }
      expect(lowest, clip).toBeLessThan(3);
    }
  });

  it('faces +Z like the game (face forward, backpack behind), so no turn is needed', async () => {
    const m = await load();
    const p = m.body.geometry.attributes.position; // bind pose, model units
    const meanZ = (lo: number, hi: number) => {
      let z = 0, n = 0;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > lo && p.getY(i) < hi && Math.abs(p.getX(i)) < 0.15) { z += p.getZ(i); n++; }
      return z / n;
    };
    expect(meanZ(0.6, 0.92)).toBeGreaterThan(0.03); // head: the face is at +Z
    expect(meanZ(0.05, 0.45)).toBeLessThan(-0.03); // chest band: the backpack is at −Z
  });

  it('is only used while the player is shown as SOL (its texture cannot be repainted)', async () => {
    const m = await load();
    expect(m.showsNation(NATIONS.sun.color)).toBe(true);
    expect(m.showsNation(NATIONS.moon.color)).toBe(false);
    expect(m.showsNation(NATIONS.star.color)).toBe(false);
  });

  it('plays the clips from the movement state with cross-fades', async () => {
    const m = await load();
    const drive = (speed: number, turnRate = 0, trace = false) => { m.update(1 / 60, { speed, turnRate, held: false, trace }); return m.current; };
    expect(drive(0)).toBe('Idle');
    expect(drive(100)).toBe('Walk');
    expect(drive(220)).toBe('Run');
    expect(drive(360)).toBe('Sprint');
    expect(drive(360, 0, true)).toBe('Trace');
    for (let i = 0; i < 90; i++) drive(0);
    expect(drive(0, 3)).toBe('Turn');
  });
});
