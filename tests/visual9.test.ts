import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BONES, EXPRESSIONS, buildHuman, gearFor, lookFor } from '../src/render/humanModel';
import type { RoleId } from '../src/config/roles';
import { skyPalette } from '../src/render/sceneBuilder';
import { TIERS, defaultTier } from '../src/render/quality';
import { DISTRICT_LOOKS, buildDistricts, districtCode } from '../src/render/districts';
import { DISTRICT_CODES } from '../src/config/terminology';
import { SECTORS } from '../src/sim/war';
import { DIST_MIN, LOOK_HEIGHT } from '../src/render/cameraController';

const ROLES: RoleId[] = ['king', 'soldier', 'sniper', 'communicator', 'keyholder', 'ranger'];
const mat = () => new THREE.MeshBasicMaterial();
const tris = (h: ReturnType<typeof buildHuman>) => h.mesh.geometry.index!.count / 3;

/** Standing height of a character (skinned, rest pose). */
function height(h: ReturnType<typeof buildHuman>): number {
  h.mesh.updateMatrixWorld(true);
  h.mesh.skeleton.update();
  const v = new THREE.Vector3(), pos = h.mesh.geometry.attributes.position;
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < pos.count; k++) { h.mesh.getVertexPosition(k, v); min = Math.min(min, v.y); max = Math.max(max, v.y); }
  return max - min;
}

describe('v9 operator characters', () => {
  it('spawn for every role with one skinned mesh, the full skeleton and a face that can change', () => {
    for (const role of ROLES) {
      const h = buildHuman(5, 0xff9048, mat(), { role });
      expect(h.mesh.isSkinnedMesh).toBe(true);
      expect(h.mesh.skeleton.bones.length).toBe(BONES.length);
      expect(h.mesh.geometry.morphAttributes.position?.length).toBe(EXPRESSIONS.length);
      expect(h.mesh.morphTargetInfluences!.length).toBe(EXPRESSIONS.length);
    }
  });

  it('are stylized, not chibi: about 5.5–6.5 heads tall (≈47 units)', () => {
    for (const id of [1, 8, 22]) {
      const H = height(buildHuman(id, 0x57a8ff, mat(), { role: 'soldier' })) / lookFor(id).height;
      expect(H).toBeGreaterThan(44);
      expect(H).toBeLessThan(50);
    }
  });

  it('roles read from their gear; only SPOTTERs carry a hand device (no guns on everyone)', () => {
    expect(ROLES.map((r) => buildHuman(3, 0xffffff, mat(), { role: r }).gun !== null)).toEqual([false, false, true, false, false, false]);
    const sp = buildHuman(3, 0xffffff, mat(), { role: 'sniper' });
    expect(sp.muzzle).not.toBeNull();
    const kits = new Set(ROLES.filter((r) => r !== 'king').map((r) => gearFor(r, 3)));
    expect(kits.size).toBe(5);
  });

  it('ANCHOR cannot be told apart by looks: it wears exactly a VANGUARD or RUNNER kit', () => {
    for (const id of [2, 3, 10, 11, 17]) {
      const gear = gearFor('king', id);
      expect(['vanguard', 'runner']).toContain(gear);
      const anchor = buildHuman(id, 0xf5e05a, mat(), { role: 'king' });
      const twin = buildHuman(id, 0xf5e05a, mat(), { role: gear === 'vanguard' ? 'soldier' : 'ranger' });
      expect(Array.from(anchor.mesh.geometry.attributes.position.array)).toEqual(Array.from(twin.mesh.geometry.attributes.position.array));
      expect(Array.from(anchor.mesh.geometry.attributes.color.array)).toEqual(Array.from(twin.mesh.geometry.attributes.color.array));
    }
  });

  it('wear the faction colour, repainted for a disguise, and the TRACE device glow is a uniform', () => {
    const h = buildHuman(4, 0xff9048, mat(), { role: 'ranger' });
    const col = h.mesh.geometry.attributes.color;
    const snap = () => Array.from(col.array as Float32Array).join();
    const before = snap();
    h.setNationColor(0x57a8ff);
    expect(snap()).not.toBe(before);
    h.setNationColor(0xff9048);
    expect(snap()).toBe(before);
    const glow = h.mesh.geometry.attributes.glow.array as Float32Array;
    expect(Array.from(glow).some((g) => g === 2)).toBe(true); // the wrist device
    expect(Array.from(glow).some((g) => g === 1)).toBe(true); // faction light strips
    h.setTrace(1);
    h.setExpression('surprised', 1);
    expect(h.mesh.morphTargetInfluences![EXPRESSIONS.indexOf('surprised')]).toBe(1);
  });

  it('get lighter at lower quality (mesh LOD by preset)', () => {
    const t = [2, 1, 0].map((detail) => tris(buildHuman(9, 0xffffff, mat(), { role: 'soldier', detail })));
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[2]);
    expect(t[0]).toBeLessThan(3500); // a low/mid-poly budget per person
  });

  it('look different from one another (skin, hair, face shape, build)', () => {
    const looks = Array.from({ length: 30 }, (_, i) => lookFor(i));
    expect(new Set(looks.map((l) => l.hairStyle)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(looks.map((l) => l.skin)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(looks.map((l) => l.hair)).size).toBeGreaterThanOrEqual(5);
  });
});

describe('v9 world look', () => {
  it('goes from a neutral day through a warm sunset to a deep navy night', () => {
    const day = skyPalette(0.02, 0);
    const dayTop = day.top.clone(), dayHorizon = day.horizon.clone(), dayElev = day.elev;
    const sunset = skyPalette(0.5, 0.05);
    expect(sunset.horizon.r - sunset.horizon.b).toBeGreaterThan(dayHorizon.r - dayHorizon.b);
    expect(sunset.elev).toBeLessThan(dayElev);
    const night = skyPalette(1, 1);
    expect(night.top.r + night.top.g + night.top.b).toBeLessThan(dayTop.r + dayTop.g + dayTop.b);
    expect(night.top.b).toBeGreaterThan(night.top.r);
  });

  it('every sector has its own district look and codename', () => {
    expect(DISTRICT_LOOKS.length).toBe(SECTORS.length);
    expect(DISTRICT_CODES.length).toBe(SECTORS.length);
    expect(new Set(DISTRICT_CODES).size).toBe(SECTORS.length);
    expect(districtCode(1)).toBe('NEON MAZE');
    expect(new Set(DISTRICT_LOOKS.map((d) => d.palette.join())).size).toBe(SECTORS.length);
  });

  it('district dressing is instanced (a few draw calls for the whole city) and not solid', () => {
    const scene = new THREE.Scene();
    const st = buildDistricts(scene);
    expect(st.signs).toBeGreaterThan(1000);
    expect(scene.children.length).toBeLessThanOrEqual(11); // one lit mesh per district + masts + border studs
    for (const o of scene.children) expect((o as THREE.InstancedMesh).isInstancedMesh).toBe(true);
  });

  it('quality presets are HIGH / MEDIUM / LOW, lighter each step, MEDIUM first on phones', () => {
    expect(TIERS.map((t) => t.code)).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i].detail).toBeLessThan(TIERS[i - 1].detail);
    expect(defaultTier(true)).toBe(1);
    expect(defaultTier(false)).toBe(0);
  });

  it('the camera sits a little closer so the character reads bigger', () => {
    expect(DIST_MIN).toBeLessThan(110);
    expect(LOOK_HEIGHT).toBeLessThan(55);
  });
});
