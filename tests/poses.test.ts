import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BONES, buildHuman } from '../src/render/humanModel';
import type { BodyPose } from '../src/render/poses';
import { jailPose, lockPose, stunPose } from '../src/render/poses';

/** Lowest and highest point of a character in a pose (skinned vertices, like the renderer). */
function extent(bp: BodyPose | null, id = 3): { min: number; max: number } {
  const h = buildHuman(id, 0xff9048, new THREE.MeshBasicMaterial());
  if (bp) {
    for (const n of BONES) { const q = bp.pose[n]; if (q) h.bones[n].rotation.set(q[0], q[1], q[2]); }
    h.bones.hips.position.y = h.rest.hips.y + bp.hipsY;
    h.bones.root.rotation.z = bp.rootZ;
  }
  h.mesh.updateMatrixWorld(true);
  h.mesh.skeleton.update();
  const v = new THREE.Vector3(), pos = h.mesh.geometry.attributes.position;
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < pos.count; k++) { h.mesh.getVertexPosition(k, v); min = Math.min(min, v.y); max = Math.max(max, v.y); }
  return { min, max };
}

describe('held poses on the blocky body', () => {
  it('standing puts the boots on the ground', () => {
    expect(extent(null).min).toBeCloseTo(0, 1);
  });

  it('sitting in jail, kneeling at a lock and being stunned all rest on the ground (no sinking, no floating)', () => {
    for (const [name, make] of [['jail', jailPose], ['lock', lockPose], ['stun', stunPose]] as const) {
      for (const t of [0, 0.5, 1, 1.7]) {
        for (const id of [3, 10, 17]) {
          const { min } = extent(make(t), id);
          expect(Math.abs(min), `${name} t=${t} id=${id}`).toBeLessThan(0.5);
        }
      }
    }
  });

  it('sitting in jail is clearly lower than standing (reads as sitting)', () => {
    expect(extent(jailPose(0)).max).toBeLessThan(extent(null).max * 0.82);
  });
});
