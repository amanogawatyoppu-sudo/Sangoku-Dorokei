import * as THREE from 'three';
import { NATIONS } from '../config/nations';
import type { GameState } from '../sim/state';
import { POINT_R, SECTORS, sectorPoint } from '../sim/war';

const NEUTRAL = 0x9a9488;

interface PointView {
  banner: THREE.MeshStandardMaterial;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  ring: THREE.MeshBasicMaterial;
  gauge: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  flag: THREE.Mesh;
  owner: string;
  shownProgress: number;
}

/**
 * Strategic points in the city: a flag on a pole in the holder's colour (grey when
 * neutral), a faint ring on the ground marking the area to stand in, and an arc
 * that fills in the colour of whoever is taking it. Contested points pulse.
 */
export class WarView {
  private points: PointView[] = [];

  constructor(scene: THREE.Scene) {
    const poleGeo = new THREE.CylinderGeometry(2.2, 2.8, 200, 8).translate(0, 100, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3b3b3e, metalness: 0.6, roughness: 0.4 });
    const bannerGeo = new THREE.PlaneGeometry(100, 60).translate(50, 0, 0);
    const plinthGeo = new THREE.CylinderGeometry(14, 16, 8, 12).translate(0, 4, 0);
    const ringGeo = new THREE.RingGeometry(POINT_R - 10, POINT_R, 64).rotateX(-Math.PI / 2);
    SECTORS.forEach((_d, i) => {
      const p = sectorPoint(i);
      const g = new THREE.Group();
      g.position.set(p.x, p.y + 0.8, p.z);
      g.add(new THREE.Mesh(poleGeo, poleMat), new THREE.Mesh(plinthGeo, poleMat));
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 154;
      const tex = new THREE.CanvasTexture(canvas);
      const banner = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, side: THREE.DoubleSide, roughness: 0.8 });
      const flag = new THREE.Mesh(bannerGeo, banner);
      flag.position.set(2, 165, 0);
      g.add(flag);
      const ring = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.35, depthWrite: false });
      g.add(new THREE.Mesh(ringGeo, ring));
      const gauge = new THREE.Mesh(new THREE.RingGeometry(POINT_R - 26, POINT_R - 12, 64, 1, 0, 0.001).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.75, depthWrite: false }));
      gauge.position.y = 0.4;
      g.add(gauge);
      scene.add(g);
      this.points.push({ banner, canvas, tex, ring, gauge, flag, owner: '', shownProgress: 0 });
    });
  }

  sync(state: GameState): void {
    const t = state.time / 1000;
    this.points.forEach((v, i) => {
      const s = state.war.sectors[i];
      const key = s.owner ?? '-';
      if (key !== v.owner) {
        v.owner = key;
        const c = s.owner ? NATIONS[s.owner].color : NEUTRAL;
        // The banner: holder's colour and emblem, and the sector's name (中立 while nobody holds it).
        const g = v.canvas.getContext('2d')!;
        g.fillStyle = '#' + c.toString(16).padStart(6, '0');
        g.fillRect(0, 0, 256, 154);
        g.strokeStyle = 'rgba(0,0,0,.35)';
        g.lineWidth = 8;
        g.strokeRect(4, 4, 248, 146);
        g.fillStyle = s.owner ? '#1a1206' : '#2a2a2a';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '700 64px sans-serif';
        g.fillText(s.owner ? NATIONS[s.owner].emblem : '中立', 128, 58);
        g.font = '700 30px sans-serif';
        g.fillText(SECTORS[i].name + '戦区', 128, 122);
        v.tex.needsUpdate = true;
        v.ring.color.setHex(c);
      }
      v.ring.opacity = s.contested ? 0.35 + 0.3 * Math.sin(t * 7) : 0.3;
      v.flag.rotation.y = Math.sin(t * 1.7 + i) * (s.contested ? 0.5 : 0.2);
      const prog = s.capturer ? s.progress : 0;
      if (Math.abs(prog - v.shownProgress) > 0.02 || (prog === 0) !== (v.shownProgress === 0)) {
        v.shownProgress = prog;
        v.gauge.geometry.dispose();
        v.gauge.geometry = new THREE.RingGeometry(POINT_R - 26, POINT_R - 12, 64, 1, Math.PI / 2, Math.max(0.001, prog * Math.PI * 2)).rotateX(-Math.PI / 2);
        if (s.capturer) v.gauge.material.color.setHex(NATIONS[s.capturer].color);
      }
      v.gauge.visible = prog > 0;
    });
  }
}
