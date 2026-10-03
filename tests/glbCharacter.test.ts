import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLB_CLIPS, GLB_GAME_HEIGHT, GlbCharacter, accentTone, glbCharacterEnabled, glbCharacterMode, parseGlb } from '../src/render/glbCharacter';
import { NATIONS, NATION_IDS } from '../src/config/nations';

/** GLB character integration test (player only, behind EXPERIMENTAL_GLB_CHARACTER). */

import solUrl from '../public/characters/TRI_TRACE_SOL_animated_v02.glb?inline';

/** The model file's bytes. */
const bytes = () => {
  const bin = atob(solUrl.slice(solUrl.indexOf(',') + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};
const load = async () => new GlbCharacter(await parseGlb(bytes()), NATIONS.sun.color);

/** World-space bounds of the skinned body after posing at clip time t. */
function bounds(g: GlbCharacter, clip: string, t: number): THREE.Box3 {
  for (const a of g.actions.values()) a.stop();
  const act = g.actions.get(clip as never)!;
  act.reset().play();
  act.time = t;
  act.setEffectiveWeight(1);
  g.mixer.update(0);
  g.root.updateMatrixWorld(true);
  g.body.skeleton.update();
  const box = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < g.body.geometry.attributes.position.count; i++) { g.body.getVertexPosition(i, v); box.expandByPoint(v.applyMatrix4(g.body.matrixWorld)); }
  return box;
}

describe('GLB player character (integration test)', () => {
  it('is off unless asked for (?glb=1), and ?glb=0 always wins', () => {
    expect(glbCharacterEnabled('')).toBe(false);
    expect(glbCharacterEnabled('?debug')).toBe(false);
    expect(glbCharacterEnabled('?glb=1')).toBe(true);
    expect(glbCharacterEnabled('?glb=0')).toBe(false);
    expect(glbCharacterMode('?glb=1')).toBe('proto');
    expect(glbCharacterMode('?glb=meshy')).toBe('meshy');
    expect(glbCharacterMode('?glb=meshy40')).toBe('meshy40');
    expect(glbCharacterMode('?debug')).toBe('off');
  });

  it('has the six clips, and draws 71 source meshes as one skinned mesh (one rigid bone per moving part)', async () => {
    const g = await load();
    expect([...g.actions.keys()].sort()).toEqual([...GLB_CLIPS].sort());
    expect(g.stats.sourceMeshes).toBe(71);
    expect(g.stats.meshes).toBe(1);
    expect(g.stats.parts).toBeGreaterThanOrEqual(12);
    const skinned: THREE.Object3D[] = [];
    g.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) skinned.push(o); });
    expect(skinned.map((o) => o.name).sort()).toEqual(['glb-body', 'glb-xray']);
    expect(g.stats.triangles).toBe(11600);
  });

  it('stands at game height with its feet on the ground, in every clip (no floating, no sinking)', async () => {
    const g = await load();
    for (const clip of GLB_CLIPS) {
      const dur = g.actions.get(clip)!.getClip().duration;
      let lowest = Infinity;
      for (let k = 0; k < 12; k++) {
        const b = bounds(g, clip, (k / 12) * dur);
        expect(b.min.y, `${clip} k=${k}`).toBeGreaterThan(-2.5);
        lowest = Math.min(lowest, b.min.y);
        expect(b.max.y, `${clip} k=${k}`).toBeLessThan(GLB_GAME_HEIGHT * 1.08);
      }
      // A foot reaches the ground at some point of every clip.
      expect(lowest, clip).toBeLessThan(2.5);
    }
    const idle = bounds(g, 'Idle', 0);
    expect(idle.max.y - idle.min.y).toBeGreaterThan(GLB_GAME_HEIGHT * 0.95);
  });

  it('faces +Z like the game\'s characters (the eyes are in front of the head)', async () => {
    const g = await load();
    const b = bounds(g, 'Idle', 0);
    const body = g.body, pos = body.geometry.attributes.position, col = body.geometry.attributes.color, skin = body.geometry.attributes.skinIndex;
    const headBone = body.skeleton.bones.findIndex((o) => o.name === 'head');
    expect(headBone).toBeGreaterThanOrEqual(0);
    const v = new THREE.Vector3();
    let zEye = 0, nEye = 0, zHead = 0, nHead = 0;
    for (let i = 0; i < pos.count; i++) {
      if (skin.getX(i) !== headBone) continue;
      body.getVertexPosition(i, v).applyMatrix4(body.matrixWorld);
      zHead += v.z; nHead++;
      if (col.getX(i) > 0.95 && col.getY(i) > 0.92 && col.getZ(i) > 0.85) { zEye += v.z; nEye++; }
    }
    expect(nEye).toBeGreaterThan(0);
    expect(zEye / nEye).toBeGreaterThan(zHead / nHead + 0.5);
    expect(b.max.z).toBeGreaterThan(0);
  });

  it('repaints the faction accent for LUNA / STAR / a disguise, leaving no SOL orange behind', async () => {
    const g = await load();
    const sol = new THREE.Color(NATIONS.sun.color);
    const count = (c: THREE.Color) => {
      let k = 0;
      const a = g.body.geometry.attributes.color;
      for (let i = 0; i < a.count; i++) if (Math.abs(a.getX(i) - c.r) < 0.01 && Math.abs(a.getY(i) - c.g) < 0.01 && Math.abs(a.getZ(i) - c.b) < 0.01) k++;
      return k;
    };
    const orange = new THREE.Color(248 / 255, 105 / 255, 39 / 255);
    const before = count(orange);
    expect(before).toBeGreaterThan(100);
    for (const n of NATION_IDS) {
      g.setNationColor(NATIONS[n].color);
      expect(count(new THREE.Color(accentTone(NATIONS[n].color))), n).toBeGreaterThanOrEqual(before);
      if (n !== 'sun') expect(count(orange), n).toBe(0);
    }
    expect(sol).toBeTruthy();
  });

  it('picks clips from the existing movement state, with short cross-fades', async () => {
    const g = await load();
    const drive = (speed: number, turnRate = 0, extra = {}) => { g.update(1 / 60, { speed, turnRate, held: false, trace: false, ...extra }); return g.current; };
    expect(drive(0)).toBe('Idle');
    expect(drive(0, 3)).toBe('Turn');
    expect(drive(100)).toBe('Walk');
    expect(drive(220)).toBe('Run');
    expect(drive(360)).toBe('Sprint');
    // Cross-fade: right after a switch both clips still carry weight.
    const run = g.actions.get('Run')!, sprint = g.actions.get('Sprint')!;
    expect(sprint.getEffectiveWeight() + run.getEffectiveWeight()).toBeGreaterThan(0.5);
    expect(drive(360, 0, { trace: true })).toBe('Trace');
    for (let i = 0; i < 90; i++) drive(0);
    expect(g.current).toBe('Idle');
    expect(drive(0, 0, { held: true })).toBe('Idle');
  });
});
