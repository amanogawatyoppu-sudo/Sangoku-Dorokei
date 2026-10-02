// Developer preview (not part of the game build): a line-up of characters under dusk light.
import * as THREE from 'three';
import { buildHuman } from '../src/render/humanModel';
import { buildHumanV2 } from '../src/render/humanModelV2';
import { NATIONS } from '../src/config/nations';

THREE.ColorManagement.enabled = false;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2536);
const L = Math.PI;
scene.add(new THREE.HemisphereLight(0xa6b2de, 0x4a3e44, 0.72 * L));
const sun = new THREE.DirectionalLight(0xffb27a, 1.0 * L);
sun.position.set(-60, 40, 60);
sun.castShadow = true;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x55525a }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const nations = ['sun', 'moon', 'star'] as const;
const params = new URLSearchParams(location.search);
const pose = params.get('pose') ?? 'idle';
const roles = ['king', 'soldier', 'sniper', 'communicator', 'keyholder', 'ranger', 'soldier', 'king'] as const;
const expr = params.get('expr');
const turn = params.has('turn');
const people = Array.from({ length: turn ? 3 : 8 }, (_, i) => {
  const n = nations[i % 3];
  const make = params.has('v2') ? buildHumanV2 : buildHuman;
  const h = make(params.has('same') ? Number(params.get('same')) : i * 7 + 3, NATIONS[params.get('nation') as 'sun' ?? n] ? NATIONS[params.get('nation') as 'sun'].color : NATIONS[n].color, new THREE.MeshBasicMaterial({ color: 0xffffff }), { role: (params.get('role') as 'ranger') ?? roles[i] });
  if (expr && expr !== 'neutral') h.setExpression(expr as 'focused', 1);
  if (params.has('trace')) h.setTrace(1);
  h.mesh.position.set(turn ? (i - 1) * 24 : (i - 3.5) * 16, 0, 0);
  h.mesh.rotation.y = turn ? [0.2, Math.PI / 2, Math.PI][i] : params.has('back') ? Math.PI : params.has('side') ? Math.PI / 2 : 0.25;
  scene.add(h.mesh);
  return h;
});
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 1, 2000);
if (params.has('face')) { camera.position.set(turn ? -24 : -24, 43, 30); camera.lookAt(-24, 41.5, 0); } else if (turn) { camera.position.set(0, 30, 112); camera.lookAt(0, 25, 0); } else if (false) { camera.position.set(-24, 43, 34); camera.lookAt(-24, 42.5, 0); } else { camera.position.set(0, 34, 150); camera.lookAt(0, 26, 0); }
let t = 0;
function frame() {
  t += 1 / 60;
  for (const [i, h] of people.entries()) {
    const ph = t * 7 + i;
    const set = (b: keyof typeof h.bones, x: number, y: number, z: number) => h.bones[b].rotation.set(x, y, z);
    const custom = params.get('bones');
    if (custom) {
      // ?bones=[{"armL":[x,y,z],...}, ...] — one pose per person (cycled).
      const list = JSON.parse(custom) as Record<string, [number, number, number]>[];
      for (const [b, r] of Object.entries(list[i % list.length])) set(b as keyof typeof h.bones, ...r);
    } else if (pose === 'behind') {
      set('armL', 0.4, 0.6, 0.15); set('armR', 0.4, -0.6, -0.15); set('foreL', -1.3, 0, 0); set('foreR', -1.3, 0, 0);
    } else if (pose === 'fold') {
      set('armL', -0.15, 0.3, -0.75); set('armR', -0.15, -0.3, 0.75); set('foreL', -1.75, 0, 0); set('foreR', -1.75, 0, 0);
    } else if (pose === 'winded') {
      set('spine', 0.55, 0, 0); set('chest', 0.15, 0, 0); set('head', -0.45, 0, 0);
      set('thighL', -0.35, 0, 0.05); set('thighR', -0.35, 0, -0.05); set('shinL', 0.55, 0, 0); set('shinR', 0.55, 0, 0);
      set('armL', -0.75, 0, -0.1); set('armR', -0.75, 0, 0.1); set('foreL', -0.2, 0, 0); set('foreR', -0.2, 0, 0);
    } else if (pose === 'walk') {
      h.bones.thighL.rotation.x = Math.sin(ph) * 0.55; h.bones.thighR.rotation.x = -Math.sin(ph) * 0.55;
      h.bones.shinL.rotation.x = Math.max(0, -Math.sin(ph + 1)) * 0.9; h.bones.shinR.rotation.x = Math.max(0, Math.sin(ph + 1)) * 0.9;
      h.bones.armL.rotation.x = -Math.sin(ph) * 0.5; h.bones.armR.rotation.x = Math.sin(ph) * 0.5;
      h.bones.foreL.rotation.x = -0.5; h.bones.foreR.rotation.x = -0.5;
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
