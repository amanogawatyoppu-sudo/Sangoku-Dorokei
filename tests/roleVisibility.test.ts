import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildHuman } from '../src/render/humanModel';
import { gearReveal } from '../src/render/gearReveal';
import type { SeenAction } from '../src/render/gearReveal';
import { ROSTERS } from '../src/config/roles';
import type { RoleId, RosterSize } from '../src/config/roles';

const ROLES: RoleId[] = ['king', 'soldier', 'sniper', 'communicator', 'keyholder', 'ranger'];
const mat = () => new THREE.MeshBasicMaterial();
/** What a geometry actually draws: its index and the vertex data that index reaches. */
const drawn = (g: THREE.BufferGeometry, k: string) => {
  const idx = Array.from(g.index!.array as ArrayLike<number>);
  const n = Math.max(...idx) + 1, a = g.attributes[k];
  return Array.from(a.array as ArrayLike<number>).slice(0, n * a.itemSize);
};
const arr = (g: THREE.BufferGeometry, k: string) => (k === 'index' ? Array.from(g.index!.array as ArrayLike<number>) : drawn(g, k));

/** Every combination of what an observer might see someone do. */
const ACTIONS: SeenAction[] = [];
for (const used of [false, true]) for (const hpDropped of [false, true]) for (const sprinting of [false, true]) for (const aiming of [false, true]) ACTIONS.push({ used, hpDropped, sprinting, aiming });

/** Roles whose gear an observer can ever see on an enemy. */
const REVEALABLE = new Set(ROLES.filter((r) => ACTIONS.some((a) => gearReveal(r, a) > 0)));

describe('enemy roles are not given away by looks (v9.1)', () => {
  it('everyone wears the same uniform: the gear-off body does not depend on the role', () => {
    for (const id of [2, 3, 10, 17, 28]) {
      const ref = buildHuman(id, 0x57a8ff, mat(), { role: 'soldier' }).geometries.base;
      for (const role of ROLES) {
        const g = buildHuman(id, 0x57a8ff, mat(), { role }).geometries.base;
        expect(arr(g, 'position'), `${role} id=${id}`).toEqual(arr(ref, 'position'));
        expect(arr(g, 'color'), `${role} id=${id}`).toEqual(arr(ref, 'color'));
        expect(arr(g, 'index'), `${role} id=${id}`).toEqual(arr(ref, 'index'));
      }
    }
  });

  it('each role but ANCHOR has its own gear layer (shown to its own side)', () => {
    const counts = ROLES.map((role) => { const h = buildHuman(5, 0xff9048, mat(), { role }); return h.geometries.full.index!.count - h.geometries.base.index!.count; });
    for (const [i, role] of ROLES.entries()) if (role !== 'king') expect(counts[i], role).toBeGreaterThan(0);
  });

  it('the uniform-only geometry shares the full one\'s buffers (no extra vertex memory)', () => {
    const h = buildHuman(9, 0x57a8ff, mat(), { role: 'soldier' });
    expect(h.geometries.base).not.toBe(h.geometries.full);
    for (const k of Object.keys(h.geometries.full.attributes)) expect(h.geometries.base.attributes[k]).toBe(h.geometries.full.attributes[k]);
    expect(h.geometries.base.morphAttributes.position).toBe(h.geometries.full.morphAttributes.position);
  });

  it('gear can be switched off and back on without breaking the face or the skeleton', () => {
    const h = buildHuman(7, 0xf5e05a, mat(), { role: 'communicator' });
    h.setGear(false);
    expect(h.mesh.geometry).toBe(h.geometries.base);
    expect(h.mesh.geometry.morphAttributes.position?.length).toBe(4);
    h.setNationColor(0x57a8ff); // a disguise repaints both layers
    h.setGear(true);
    expect(h.mesh.geometry).toBe(h.geometries.full);
    const c = new THREE.Color(0x57a8ff);
    const col = h.mesh.geometry.attributes.color;
    let found = false;
    for (let i = 0; i < col.count && !found; i++) found = Math.abs(col.getX(i) - c.r) < 1e-6 && Math.abs(col.getY(i) - c.g) < 1e-6 && Math.abs(col.getZ(i) - c.b) < 1e-6;
    expect(found).toBe(true);
  });

  it('ANCHOR and BREAKER never show gear to enemies, whatever they do', () => {
    for (const a of ACTIONS) {
      expect(gearReveal('king', a)).toBe(0);
      expect(gearReveal('keyholder', a)).toBe(0);
    }
    // Reveals follow role-only actions that are visible anyway.
    expect(gearReveal('ranger', { used: false, hpDropped: false, sprinting: true, aiming: false })).toBeGreaterThan(0);
    expect(gearReveal('sniper', { used: false, hpDropped: false, sprinting: false, aiming: true })).toBeGreaterThan(0);
    expect(gearReveal('soldier', { used: false, hpDropped: true, sprinting: false, aiming: false })).toBeGreaterThan(0);
    expect(gearReveal('communicator', { used: true, hpDropped: false, sprinting: false, aiming: false })).toBeGreaterThan(0);
    // A role never shows gear for another role's action.
    expect(gearReveal('soldier', { used: false, hpDropped: false, sprinting: true, aiming: true })).toBe(0);
    expect(gearReveal('ranger', { used: true, hpDropped: true, sprinting: false, aiming: true })).toBe(0);
  });

  /**
   * Elimination by looks: how many enemies could still be the ANCHOR. At first sight, all of
   * them; even after watching every gear-revealing action (and remembering it), the ANCHOR is
   * still hidden among the BREAKERs — who also unlock, exactly as the ANCHOR does.
   */
  it.each([6, 10, 15] as RosterSize[])('roster %i: the ANCHOR cannot be singled out by elimination', (size) => {
    const roster = ROSTERS[size];
    const firstSight = roster.length;
    const afterAllReveals = roster.filter((r) => !REVEALABLE.has(r)).length;
    expect(firstSight).toBe(size);
    expect(afterAllReveals).toBe(1 + roster.filter((r) => r === 'keyholder').length);
    expect(afterAllReveals).toBeGreaterThanOrEqual(2);
  });
});
