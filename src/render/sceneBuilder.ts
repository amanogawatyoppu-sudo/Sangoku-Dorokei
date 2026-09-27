import * as THREE from 'three';
import { NATION_IDS, NATIONS } from '../config/nations';
import { GROUND, OBST, SNIPE, TOWER } from '../config/map';

export interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  towerMesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
}

/**
 * v6 was built on three r128, which had no color management and "legacy"
 * light units. Opting out of both keeps the original look on current three.
 */
const LEGACY_LIGHT_SCALE = Math.PI;

export function buildScene(canvas: HTMLCanvasElement): SceneRefs {
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1018);
  scene.fog = new THREE.Fog(0x0a1018, 500, 1700);
  const camera = new THREE.PerspectiveCamera(65, 1, 1, 4000);
  scene.add(new THREE.AmbientLight(0x8899aa, 0.7 * LEGACY_LIGHT_SCALE));
  const sunLight = new THREE.DirectionalLight(0xffffff, 0.9 * LEGACY_LIGHT_SCALE);
  sunLight.position.set(400, 800, 200);
  scene.add(sunLight);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND.w, GROUND.d), new THREE.MeshStandardMaterial({ color: 0x1c2a22 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  scene.add(new THREE.GridHelper(2400, 48, 0x2a3648, 0x1d2636));

  for (const o of OBST) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), new THREE.MeshStandardMaterial({ color: 0x3a4a63 }));
    m.position.set(o.x, o.h / 2, o.z);
    scene.add(m);
  }
  for (const z of SNIPE) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(z.r, z.r, 6, 20), new THREE.MeshStandardMaterial({ color: 0x50607a }));
    m.position.set(z.x, 3, z.z);
    scene.add(m);
  }
  const towerMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(TOWER.r * 0.4, TOWER.r * 0.55, 140, 16),
    new THREE.MeshStandardMaterial({ color: 0x777777 }),
  );
  towerMesh.position.set(TOWER.x, 70, TOWER.z);
  scene.add(towerMesh);

  for (const n of NATION_IDS) {
    const b = NATIONS[n].base;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(60, 74, 24),
      new THREE.MeshBasicMaterial({ color: NATIONS[n].color, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.x, 0.5, b.z);
    scene.add(ring);
    const term = new THREE.Mesh(new THREE.BoxGeometry(14, 20, 14), new THREE.MeshStandardMaterial({ color: 0x334455 }));
    term.position.set(b.x + 40, 10, b.z + 40);
    scene.add(term);
    const j = NATIONS[n].jail;
    const jm = new THREE.Mesh(
      new THREE.BoxGeometry(j.w, 30, j.d),
      new THREE.MeshStandardMaterial({ color: NATIONS[n].color, transparent: true, opacity: 0.18 }),
    );
    jm.position.set(j.x, 15, j.z);
    scene.add(jm);
  }
  return { renderer, scene, camera, towerMesh };
}

export function resizeRenderer(refs: SceneRefs, canvas: HTMLCanvasElement): void {
  const r = canvas.getBoundingClientRect();
  refs.renderer.setSize(r.width, r.height, false);
  refs.camera.aspect = r.width / r.height;
  refs.camera.updateProjectionMatrix();
}
