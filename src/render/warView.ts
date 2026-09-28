import * as THREE from 'three';
import { NATIONS } from '../config/nations';
import type { GameState } from '../sim/state';
import { NATION_IDS } from '../config/nations';
import { BOUNDS, BUILDINGS, GROUND_FLOOR, LIGHTS, insideLoop } from '../config/map';
import { POINT_R, SECTORS, sectorAt, sectorPoint } from '../sim/war';
import { radialGlowTexture } from './textures';
import { kingLit } from '../sim/systems/tower';
import type { NationId } from '../config/nations';

/** A vertical fade: bright at the bottom, gone at the top (pillars and curtains of light). */
function fadeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 128, 0, 0);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,255,255,.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

const NEUTRAL = 0x9a9488;

/** 幟 (nobori) banner: white cloth with a darker hem and a band for the crest (tinted per instance). */
function noboriTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 32, 128);
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(0, 0, 32, 6);
  g.fillRect(0, 122, 32, 6);
  g.fillRect(28, 0, 4, 128);
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.beginPath(); g.arc(14, 30, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(0,0,0,.25)';
  for (let y = 50; y < 116; y += 12) g.fillRect(10, y, 8, 6);
  return new THREE.CanvasTexture(c);
}

interface PointView {
  beam: THREE.MeshBasicMaterial;
  core: THREE.MeshBasicMaterial;
  pool: THREE.MeshBasicMaterial;
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
  private front: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private frontKey = '';
  /** Banners on street lights and shopfronts in the colour of the sector's holder: territory is visible from the street. */
  private banners: THREE.InstancedMesh | null = null;
  private bannerSector: number[] = [];
  /** Gold pillars over the enemy kings while the tower lights them (for the viewer's nation). */
  private kingBeams: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    const fade = fadeTexture(), glow = radialGlowTexture();
    // Pillars of light over each strategic point, seen across the city (the war at a glance).
    const beamGeo = new THREE.CylinderGeometry(30, 46, 1800, 20, 1, true).translate(0, 900, 0);
    const coreGeo = new THREE.CylinderGeometry(5, 9, 1100, 10, 1, true).translate(0, 550, 0);
    const poolGeo = new THREE.PlaneGeometry(POINT_R * 2.8, POINT_R * 2.8).rotateX(-Math.PI / 2);
    const additive = (tex: THREE.Texture, opacity: number) => new THREE.MeshBasicMaterial({
      map: tex, color: NEUTRAL, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    // Front lines: curtains of light standing along the borders between two nations' sectors.
    this.front = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      map: fade, color: 0xff5a3a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.front.frustumCulled = false;
    scene.add(this.front);
    const kbGeo = new THREE.CylinderGeometry(16, 26, 1400, 16, 1, true).translate(0, 700, 0);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(kbGeo, new THREE.MeshBasicMaterial({
        map: fade, color: 0xffd24a, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      }));
      m.renderOrder = 5;
      m.visible = false;
      scene.add(m);
      this.kingBeams.push(m);
    }
    {
      // Hung off every street light (pavement side, facing along the street) and flat on the
      // front wall of every building by the door: one instanced mesh, recoloured when sectors change.
      const geo = new THREE.PlaneGeometry(22, 72).translate(11, 0, 0);
      const mat = new THREE.MeshStandardMaterial({ map: noboriTexture(), side: THREE.DoubleSide, roughness: 0.9, emissive: 0x2a2a2a });
      const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      const spots: THREE.Matrix4[] = [];
      for (const l of LIGHTS) {
        if (!insideLoop(l.x, l.z, 0)) continue;
        spots.push(new THREE.Matrix4().compose(new THREE.Vector3(l.x - Math.cos(l.ang) * 5, 150, l.z - Math.sin(l.ang) * 5), new THREE.Quaternion().setFromAxisAngle(up, -l.ang + Math.PI), one));
      }
      const OUT: Record<string, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
      for (const b of BUILDINGS) {
        if (b.outside || b.h < GROUND_FLOOR + 100) continue;
        const [nx, nz] = OUT[b.front];
        const half = b.front === 'n' || b.front === 's' ? b.w / 2 : b.d / 2;
        // Halfway between the middle and a corner, just above the shop fronts (the projecting
        // signs stand near the corners, so the two never meet).
        const tx = nz, tz = -nx;
        const cx = b.x + nx * (b.front === 'e' || b.front === 'w' ? b.w / 2 + 1.5 : 0) + tx * (half * 0.5 - 11);
        const cz = b.z + nz * (b.front === 'n' || b.front === 's' ? b.d / 2 + 1.5 : 0) + tz * (half * 0.5 - 11);
        spots.push(new THREE.Matrix4().compose(new THREE.Vector3(cx, GROUND_FLOOR + 50, cz), new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(nx, nz)), one));
      }
      this.banners = new THREE.InstancedMesh(geo, mat, spots.length);
      const p = new THREE.Vector3();
      spots.forEach((m, i) => {
        this.banners!.setMatrixAt(i, m);
        this.banners!.setColorAt(i, new THREE.Color(NEUTRAL));
        p.setFromMatrixPosition(m);
        this.bannerSector.push(sectorAt(p.x, p.z));
      });
      this.banners.castShadow = false;
      scene.add(this.banners);
    }
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
      const beam = additive(fade, 0.16), core = additive(fade, 0.5), pool = additive(glow, 0.55);
      const beamMesh = new THREE.Mesh(beamGeo, beam), coreMesh = new THREE.Mesh(coreGeo, core), poolMesh = new THREE.Mesh(poolGeo, pool);
      beamMesh.renderOrder = coreMesh.renderOrder = poolMesh.renderOrder = 2;
      poolMesh.position.y = 1;
      g.add(beamMesh, coreMesh, poolMesh);
      scene.add(g);
      this.points.push({ beam, core, pool, banner, canvas, tex, ring, gauge, flag, owner: '', shownProgress: 0 });
    });
  }

  /** Rebuilds the front-line curtains when a sector changes hands. */
  private syncFront(state: GameState): void {
    const key = state.war.sectors.map((x) => x.owner ?? '-').join();
    if (key === this.frontKey) return;
    this.frontKey = key;
    const STEP = 60, H = 90, pos: number[] = [], uv: number[] = [];
    const quad = (x0: number, z0: number, x1: number, z1: number) => {
      pos.push(x0, 0, z0, x1, 0, z1, x1, H, z1, x0, 0, z0, x1, H, z1, x0, H, z0);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    };
    const owner = (x: number, z: number) => state.war.sectors[sectorAt(x, z)].owner;
    for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += STEP) {
      for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += STEP) {
        if (!insideLoop(x, z, 0)) continue;
        const o = owner(x, z);
        if (!o) continue;
        const ox = owner(x + STEP, z), oz = owner(x, z + STEP);
        if (ox && ox !== o && sectorAt(x, z) !== sectorAt(x + STEP, z)) quad(x + STEP / 2, z - STEP / 2, x + STEP / 2, z + STEP / 2);
        if (oz && oz !== o && sectorAt(x, z) !== sectorAt(x, z + STEP)) quad(x - STEP / 2, z + STEP / 2, x + STEP / 2, z + STEP / 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.front.geometry.dispose();
    this.front.geometry = geo;
    if (this.banners) {
      const c = new THREE.Color();
      this.bannerSector.forEach((id, i) => {
        const o = state.war.sectors[id].owner;
        this.banners!.setColorAt(i, c.setHex(o ? NATIONS[o].color : NEUTRAL));
      });
      this.banners.instanceColor!.needsUpdate = true;
    }
  }

  sync(state: GameState, viewer: NationId = state.player.nation): void {
    const t = state.time / 1000;
    const lit = state.entities.filter((k) => kingLit(state, k, viewer));
    this.kingBeams.forEach((m, i) => {
      const k = lit[i];
      m.visible = !!k;
      if (!k) return;
      m.position.set(k.x, k.y, k.z);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 6);
    });
    this.syncFront(state);
    this.front.material.opacity = 0.45 + 0.15 * Math.sin(t * 2);
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
        for (const m of [v.beam, v.core, v.pool]) m.color.setHex(c);
      }
      // Contested: the pillar flickers between the colours of the nations fighting there.
      const fighting = NATION_IDS.filter((n) => s.count[n] > 0);
      if (s.contested && fighting.length > 1) {
        const n = fighting[Math.floor(t * 2.5) % fighting.length];
        for (const m of [v.beam, v.core]) m.color.setHex(NATIONS[n].color);
      } else if (s.contested !== undefined && v.beam.color.getHex() !== (s.owner ? NATIONS[s.owner].color : NEUTRAL)) {
        for (const m of [v.beam, v.core]) m.color.setHex(s.owner ? NATIONS[s.owner].color : NEUTRAL);
      }
      const pulse = s.contested ? 0.7 + 0.3 * Math.sin(t * 9) : 0.85 + 0.15 * Math.sin(t * 1.5 + i);
      v.beam.opacity = (s.owner ? 0.3 : 0.14) * pulse;
      v.core.opacity = (s.owner ? 0.7 : 0.35) * pulse;
      v.pool.opacity = (s.owner ? 0.85 : 0.4) * pulse;
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
