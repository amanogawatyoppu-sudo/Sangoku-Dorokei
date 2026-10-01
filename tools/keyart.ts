// Developer tool (not part of the game build): renders the three faction operators in
// running poses on a transparent background, for the loading-screen key art.
import * as THREE from 'three';
import { buildHuman } from '../src/render/humanModel';
import { NATIONS } from '../src/config/nations';
import { emblemTexture } from '../src/render/textures';

THREE.ColorManagement.enabled = false;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const L = Math.PI;
// Night city light: cool fill, a warm key from the front-left, a red rim from behind.
scene.add(new THREE.HemisphereLight(0x8a9ad0, 0x2a2430, 0.8 * L));
const key = new THREE.DirectionalLight(0xffc896, 1.15 * L); key.position.set(-50, 60, 90); scene.add(key);
const rim = new THREE.DirectionalLight(0xff4a3a, 1.2 * L); rim.position.set(60, 30, -80); scene.add(rim);
const rim2 = new THREE.DirectionalLight(0x6fb0ff, 0.7 * L); rim2.position.set(-80, 20, -40); scene.add(rim2);

type Set = (b: string, x: number, y: number, z: number) => void;
/** A sprinting pose: torso leaning in, one knee driving forward, arms pumping. `m` mirrors the stride. */
function run(set: Set, m: 1 | -1, lean = 0.32) {
  const [F, B] = m === 1 ? ['L', 'R'] : ['R', 'L'];
  set('spine', lean, 0, 0); set('chest', 0.08, 0, 0); set('head', -0.25, 0, 0);
  set(`thigh${F}`, -1.05, 0, 0); set(`shin${F}`, 0.9, 0, 0); set(`foot${F}`, -0.2, 0, 0);
  set(`thigh${B}`, 0.75, 0, 0); set(`shin${B}`, 1.2, 0, 0); set(`foot${B}`, 0.5, 0, 0);
  set(`arm${F}`, 0.9, 0, F === 'L' ? 0.15 : -0.15); set(`fore${F}`, -1.2, 0, 0);
  set(`arm${B}`, -0.65, 0, B === 'L' ? 0.25 : -0.25); set(`fore${B}`, -1.5, 0, 0);
}

const cast = [
  { n: 'sun' as const, id: 3, x: 0, z: 30, rot: 0.8, m: 1 as const, s: 1.0 },
  { n: 'moon' as const, id: 10, x: 34, z: -12, rot: 0.75, m: -1 as const, s: 1.0 },
  { n: 'star' as const, id: 17, x: -30, z: -26, rot: 1.1, m: -1 as const, s: 1.0 },
];
for (const c of cast) {
  const em = new THREE.MeshStandardMaterial({ map: emblemTexture(NATIONS[c.n].emblem, NATIONS[c.n].color), roughness: 0.8 });
  const h = buildHuman(c.id, NATIONS[c.n].color, em);
  h.mesh.position.set(c.x, 0, c.z);
  h.mesh.rotation.y = c.rot;
  h.mesh.scale.setScalar(c.s);
  run((b, x, y, z) => h.bones[b as keyof typeof h.bones].rotation.set(x, y, z), c.m);
  h.bones.hips.position.y -= 1.5;
  scene.add(h.mesh);
}
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 3000);
camera.position.set(-40, 22, 210);
camera.lookAt(2, 27, 0);
renderer.render(scene, camera);
(window as unknown as { done: boolean }).done = true;
