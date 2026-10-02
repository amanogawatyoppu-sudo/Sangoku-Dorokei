import * as THREE from 'three';
import { NATION_IDS, NATIONS } from '../config/nations';
import type { NationId } from '../config/nations';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { effNation, visibleTo } from '../sim/systems/vision';
import { STEP_SEC } from '../core/clock';
import type { BoneName, Human } from './humanModel';
import { BONES, EXPRESSIONS, buildHuman } from './humanModel';
import { buildHumanV2 } from './humanModelV2';
import { artMode } from './artStyle';
import { emblemTexture } from './textures';
import type { BodyPose, Pose } from './poses';
import { jailPose, lockPose, stunPose } from './poses';
import { sniperTarget } from '../sim/systems/abilities';
import { canAct, captureCandidate } from '../sim/systems/capture';
import { gearReveal } from './gearReveal';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Per-character animation state (presentation only). */
interface Anim {
  human: Human;
  /** ピヨピヨ: stars circling over the head while stunned (made on first use). */
  stars: THREE.Group | null;
  phase: number;
  yaw: number;
  turnRate: number;
  speed: number;
  headYaw: number;
  reach: number;
  lastCapCd: number;
  nation: NationId;
  /** Snipers: 0 = rifle at low ready … 1 = shouldered; recoil timer after a shot. */
  aim: number;
  recoil: number;
  lastSpecialCd: number;
  /** Smoothed forward acceleration (units/s²): lean into starts, rock back when braking. */
  accel: number;
  /** Seconds since the character stopped moving (idle variations kick in after a while). */
  still: number;
  /** Landing dip after a drop (s left), and whether we were in the air last frame. */
  land: number;
  airborne: boolean;
  /** Step phase for turning on the spot. */
  turnStep: number;
  /** Face: the expression weights shown (eased toward this frame's targets). */
  face: [number, number, number, number];
  /** TRACE device glow 0…1 (eased). */
  trace: number;
  /** Seconds left of the "got one" look after a successful TRACE. */
  proud: number;
  /** Time not yet animated (far characters animate every few frames). */
  lag: number;
  /** Seconds left of showing the role gear to enemies (after a role-only ability), and the HP last seen. */
  reveal: number;
  lastHp: number;
}

/** SPOTTER's marker on the chest bone: held low in the right hand, and raised to the eye to fire. */
const GUN_READY = { p: new THREE.Vector3(-5.6, -0.6, 7.6), r: new THREE.Euler(0.55, 0.12, 0) };
const GUN_AIM = { p: new THREE.Vector3(-3.6, 7.4, 10.4), r: new THREE.Euler(0, 0.04, 0) };
/** Characters this far from the player animate every third frame. */
const FAR = 1500;
/** Characters within this distance cast real shadows. */
const SHADOW_NEAR = 750;
/** Contact shadow: a soft dark disc under every shown character (one instanced draw). */
function contactShadows(count: number): THREE.InstancedMesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.32)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, count);
  m.frustumCulled = false;
  m.renderOrder = 1;
  m.count = 0;
  return m;
}
const ARMS_READY: Pose = { armR: [-0.5, 0, 0.12], foreR: [-1.1, 0, 0], armL: [-0.7, 0, -0.45], foreL: [-1.3, 0, 0] };
const ARMS_AIM: Pose = { armR: [-1.3, 0, 0.35], foreR: [-0.85, 0, 0], armL: [-1.55, 0, -0.55], foreL: [-0.3, 0, 0] };


/**
 * Owns one person per entity and mirrors simulation state onto them each frame:
 * a stride-matched walk / jog / run cycle, arm swing with bent elbows, hips and
 * shoulders counter-rotating, leaning into turns and into speed, the head
 * turning toward whatever the character is watching, glances around when
 * idle, and poses for being stunned, sitting in jail, unlocking, grabbing and
 * falling.
 */
/**
 * Seen through walls: a second draw of the player's own skinned mesh (same geometry
 * and skeleton) that only paints where something is in front of it, in the nation's
 * colour, so you never lose yourself behind a building or a tree.
 */
function addXray(mesh: THREE.SkinnedMesh, color: number): void {
  // Drawn in the opaque pass after the world but before the player itself (renderOrder 1 < 2), so the
  // depth test only sees buildings and trees — the player's own back faces never tint it.
  const c = new THREE.Color(color).multiplyScalar(0.55);
  const mat = new THREE.MeshBasicMaterial({ color: c, blending: THREE.AdditiveBlending, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false });
  const x = new THREE.SkinnedMesh(mesh.geometry, mat);
  x.bind(mesh.skeleton, mesh.bindMatrix);
  x.frustumCulled = false;
  mesh.traverse((o) => { o.renderOrder = 2; });
  x.renderOrder = 1;
  mesh.add(x);
}

/** A chunky four-pointed star (two crossed blocks), shared by every dizzy head. */
const STAR_GEO = mergeStar();
const STAR_MAT = new THREE.MeshBasicMaterial({ color: 0xffd65a, fog: false });
function mergeStar(): THREE.BufferGeometry {
  const a = new THREE.BoxGeometry(4.6, 1.4, 1.4), b = new THREE.BoxGeometry(1.4, 4.6, 1.4), c = new THREE.BoxGeometry(2.4, 2.4, 1.6);
  const g = new THREE.BufferGeometry();
  const parts = [a, b, c].map((x) => x.toNonIndexed());
  const pos = parts.flatMap((x) => Array.from(x.attributes.position.array as Float32Array));
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export class EntityView {
  private anims = new Map<number, Anim>();
  private emblemMats: Record<NationId, THREE.MeshStandardMaterial>;
  private playerEmblemMats: Record<NationId, THREE.MeshStandardMaterial>;
  private clock = 0;
  private frame = 0;
  private shadows: THREE.InstancedMesh;
  private tmp = new THREE.Matrix4();

  constructor(scene: THREE.Scene, state: GameState, detail = 2) {
    const mk = (n: NationId) => new THREE.MeshStandardMaterial({
      map: emblemTexture(NATIONS[n].emblem, NATIONS[n].color), roughness: 0.8,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.emblemMats = Object.fromEntries(NATION_IDS.map((n) => [n, mk(n)])) as Record<NationId, THREE.MeshStandardMaterial>;
    this.playerEmblemMats = Object.fromEntries(NATION_IDS.map((n) => [n, mk(n)])) as Record<NationId, THREE.MeshStandardMaterial>;
    for (const e of state.entities) {
      const mats = e.isPlayer ? this.playerEmblemMats : this.emblemMats;
      const art = artMode();
      const v2 = art === 'all' || (art === 'player' && e.isPlayer);
      const human = (v2 ? buildHumanV2 : buildHuman)(e.id, NATIONS[e.nation].color, mats[e.nation], { role: e.role, detail: v2 && e.isPlayer ? Math.max(detail, 1) : detail });
      if (e.isPlayer) addXray(human.mesh, NATIONS[e.nation].color);
      human.mesh.scale.setScalar(human.look.height);
      scene.add(human.mesh);
      this.anims.set(e.id, {
        human, phase: (e.id * 1.7) % (Math.PI * 2), yaw: Math.atan2(e.dirX, e.dirZ), turnRate: 0, speed: 0,
        headYaw: 0, reach: 0, lastCapCd: e.cd.capture, nation: e.nation, aim: 0, recoil: 0, lastSpecialCd: e.cd.special,
        accel: 0, still: 0, land: 0, airborne: false, turnStep: 0, stars: null,
        face: [0, 0, 0, 0], trace: 0, proud: 0, lag: 0, reveal: 0, lastHp: e.hp,
      });
    }
    this.shadows = contactShadows(state.entities.length);
    scene.add(this.shadows);
  }

  /** Fade the player's model when the camera is squeezed right behind it (indoors, against walls). */
  playerOpacity = 1;

  /** Spectating as a ghost: everyone is shown. */
  seeAll = false;

  sync(state: GameState, alpha: number, dtSec = 1 / 60): void {
    const p = state.player;
    this.clock += dtSec;
    this.frame++;
    let shadows = 0;
    for (const e of state.entities) {
      const a = this.anims.get(e.id)!;
      const mesh = a.human.mesh;
      if (!e.alive) { mesh.visible = false; continue; }
      const vis = e === p || this.seeAll || visibleTo(state, e, p);
      mesh.visible = vis;
      if (!vis) continue;
      mesh.position.set(lerp(e.prevX, e.x, alpha), lerp(e.prevY, e.y, alpha), lerp(e.prevZ, e.z, alpha));
      if (!e.jailed || e === p) {
        // The contact shadow tightens a little at full stride and while airborne.
        const r = 15 * a.human.look.height * (a.airborne ? 0.75 : 1 - 0.08 * Math.min(1, a.speed / 300));
        this.tmp.makeScale(r, 1, r * 1.1).setPosition(mesh.position.x, mesh.position.y + 0.3, mesh.position.z);
        this.shadows.setMatrixAt(shadows++, this.tmp);
      }
      const yaw = Math.atan2(e.dirX, e.dirZ);
      a.turnRate = lerp(a.turnRate, wrap(yaw - a.yaw) / Math.max(dtSec, 1e-3), 1 - Math.exp(-dtSec * 8));
      a.yaw = yaw;
      mesh.rotation.y = yaw;
      const shown = effNation(state, e, p.nation);
      a.human.setNationColor(NATIONS[shown].color);
      if (a.nation !== shown) {
        a.nation = shown;
        a.human.emblem.material = (e.isPlayer ? this.playerEmblemMats : this.emblemMats)[shown];
      }
      this.setOpacity(a, e.jailed ? 0.5 : e === p ? this.playerOpacity : 1, e === p);
      this.gear(a, e, state, dtSec);
      // Animation LOD: far away, a character moves its bones every third frame.
      a.lag += dtSec;
      const d = e === p ? 0 : Math.hypot(e.x - p.x, e.z - p.z);
      const far = d > FAR;
      // Real shadows only near the player (everyone keeps the cheap contact shadow).
      mesh.castShadow = d < SHADOW_NEAR;
      if (far && (this.frame + e.id) % 3 !== 0) continue;
      const step = Math.min(0.1, a.lag);
      a.lag = 0;
      this.animate(a, e, state, step);
      if (!far) this.express(a, e, state, step);
    }
    this.shadows.count = shadows;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  /** Role gear (v9.1): always on for the viewer's own side; enemies only per `gearReveal`. */
  private gear(a: Anim, e: Entity, state: GameState, dt: number): void {
    a.reveal = Math.max(0, a.reveal - dt);
    a.reveal = Math.max(a.reveal, gearReveal(e.role, {
      used: e.cd.special > a.lastSpecialCd + 1, hpDropped: e.hp < a.lastHp,
      sprinting: e.sprintUntil > state.time, aiming: a.aim > 0.05 || a.recoil > 0,
    }));
    a.lastHp = e.hp;
    if (e.role === 'sniper') a.lastSpecialCd = Math.min(a.lastSpecialCd, e.cd.special); // holdRifle reads the reset itself
    else a.lastSpecialCd = e.cd.special;
    // The side it is shown as (a disguise must look like the real thing, gear and all).
    const own = effNation(state, e, state.player.nation) === state.player.nation;
    a.human.setGear(own || a.reveal > 0);
  }

  /**
   * The face and the TRACE device: focused while chasing, alert when an enemy is close,
   * surprised when stunned, confident for a moment after a TRACE; the wrist device lights
   * up when a TRACE is possible right now.
   */
  private express(a: Anim, e: Entity, state: GameState, dt: number): void {
    a.proud = Math.max(0, a.proud - dt);
    const want: [number, number, number, number] = [0, 0, 0, 0]; // focused, alert, surprised, confident
    const stunned = e.stunUntil > state.time;
    if (stunned) want[2] = 1;
    else if (e.jailed) { want[1] = 0.55; want[0] = 0.3; }
    else if (a.proud > 0) want[3] = 1;
    else {
      const chasing = e.isPlayer ? a.speed > 200 : e.ai.targetId !== null && e.ai.visible.includes(e.ai.targetId);
      const threat = !e.isPlayer && e.ai.visible.some((id) => {
        const o = state.entities[id];
        return o.nation !== e.nation && Math.hypot(o.x - e.x, o.z - e.z) < 220;
      });
      if (chasing) want[0] = 1;
      else if (threat) want[1] = 1;
    }
    const k = 1 - Math.exp(-dt * 8);
    for (let i = 0; i < 4; i++) {
      const v = lerp(a.face[i], want[i], k);
      if (Math.abs(v - a.face[i]) > 1e-3 || (want[i] === 0 && a.face[i] !== 0)) a.human.setExpression(EXPRESSIONS[i], v < 0.01 ? 0 : v);
      a.face[i] = v < 0.01 ? 0 : v;
    }
    // Device: lights up while someone is in TRACE reach from behind (checked every few frames).
    if ((this.frame + e.id) % 4 === 0) {
      const ready = canAct(state, e) && e.cd.capture <= 0 && !!captureCandidate(state, e);
      a.trace = lerp(a.trace, ready ? 1 : 0, 0.6);
      a.human.setTrace(a.trace + (ready ? 0.15 * Math.sin(this.clock * 12) : 0));
    }
  }

  private setOpacity(a: Anim, opacity: number, isPlayer: boolean): void {
    const ghost = opacity < 0.99;
    const mats: THREE.Material[] = [a.human.material];
    if (isPlayer) mats.push(a.human.emblem.material as THREE.Material);
    for (const m of mats) {
      if (m.transparent !== ghost) { m.transparent = ghost; m.needsUpdate = true; }
      m.opacity = opacity;
    }
  }

  private animate(a: Anim, e: Entity, state: GameState, dt: number): void {
    const t = this.clock + e.id * 0.37;
    // Ground speed: the simulation's (smooth) speed, but never faster than it really moved (walls).
    const measured = Math.hypot(e.x - e.prevX, e.z - e.prevZ) / STEP_SEC;
    const target = Math.min(Math.abs(e.speed), measured * 1.15 + 8);
    const before = a.speed;
    a.speed = lerp(a.speed, target, 1 - Math.exp(-dt * 12));
    a.accel = lerp(a.accel, (a.speed - before) / Math.max(dt, 1e-3), 1 - Math.exp(-dt * 6));
    const spd = a.speed, back = e.speed < -1;
    const move = smooth(6, 45, spd); // 0 standing … 1 moving
    const run = smooth(140, 280, spd); // 0 walk … 1 run
    const sprint = smooth(290, 390, spd); // 0 run … 1 flat-out sprint
    // Stride: ~1.3 m walking, ~2.3 m running, ~2.9 m sprinting (one step = half a cycle).
    const stride = Math.min(78, 34 + spd * 0.09);
    a.phase += (back ? -1 : 1) * (spd * dt / stride) * Math.PI;
    const ph = a.phase, s = Math.sin(ph), c = Math.cos(ph);

    // Grab: the capture cooldown was just reset.
    if (e.cd.capture > a.lastCapCd + 0.3) { a.reach = 0.38; a.proud = 2.2; }
    a.lastCapCd = e.cd.capture;
    a.reach = Math.max(0, a.reach - dt);

    const pose: Pose = {};
    let hipsY = 0, hipsX = 0, rootZ = 0;
    const stunned = e.stunUntil > state.time;
    const falling = e.y < e.prevY - 3;
    // Landing: a short knee dip when a drop ends.
    if (a.airborne && !falling) a.land = 0.28;
    a.airborne = falling;
    a.land = Math.max(0, a.land - dt);
    a.still = spd < 6 ? a.still + dt : 0;
    const held: BodyPose | null = e.jailed ? jailPose(t) : e.channeling ? lockPose(t) : stunned ? stunPose(t) : null;
    if (held) {
      Object.assign(pose, held.pose);
      hipsY = held.hipsY;
      rootZ = held.rootZ;
    } else {
      // Locomotion blended with a relaxed stance.
      const A = (lerp(0.42, 0.8, run) + 0.14 * sprint) * move; // hip swing
      const K = (lerp(0.55, 1.55, run) + 0.4 * sprint) * move; // knee lift in the swing phase
      const Aa = (lerp(0.32, 0.78, run) + 0.3 * sprint) * move; // arm swing (pumping when sprinting)
      const E = (lerp(0.22, 1.35, run) + 0.25 * sprint) * move + 0.12; // elbow bend
      const swingL = Math.max(0, c), swingR = Math.max(0, -c);
      const thL = -A * s, thR = A * s;
      const knL = K * swingL ** 1.3 + 0.06 + run * 0.22 * (1 - swingL);
      const knR = K * swingR ** 1.3 + 0.06 + run * 0.22 * (1 - swingR);
      pose.thighL = [thL, 0, 0.02];
      pose.thighR = [thR, 0, -0.02];
      pose.shinL = [knL, 0, 0];
      pose.shinR = [knR, 0, 0];
      pose.footL = [-(thL + knL) * 0.75, 0, 0];
      pose.footR = [-(thR + knR) * 0.75, 0, 0];
      // Running arms drive slightly across the body.
      pose.armL = [Aa * s, -run * 0.12 * s, 0.07 + run * 0.06];
      pose.armR = [-Aa * s, -run * 0.12 * s, -0.07 - run * 0.06];
      pose.foreL = [-E - 0.15 * Math.max(0, -s) * move, 0, 0];
      pose.foreR = [-E - 0.15 * Math.max(0, s) * move, 0, 0];
      // Bob twice per cycle, lower when running; hips twist against the shoulders.
      hipsY = move * (lerp(0.45, 1.3, run) * Math.cos(2 * ph) - run * 1.2);
      // Pelvis shifts over the planted foot while walking.
      hipsX = move * (1 - run) * 0.9 * s;
      const idle = 1 - move;
      // Starts and stops: lean into the acceleration, rock back when braking hard.
      const surge = Math.max(-0.12, Math.min(0.14, a.accel * 0.0009));
      const lean = (back ? -0.08 : lerp(0.05, 0.24, run) + 0.1 * sprint) * move + surge;
      const twist = lerp(0.13, 0.2, run) * move;
      pose.hips = [0, twist * s, 0.045 * s * move * (1 - run) + idle * 0.025 * Math.sin(t * 0.7)];
      pose.spine = [lean, 0, 0];
      pose.chest = [0.02 + idle * 0.018 * Math.sin(t * 1.9), -twist * 1.35 * s, 0];
      if (idle > 0.01) this.idleStance(a, e, pose, t, idle);
      // Turning on the spot: small stepping feet instead of sliding round.
      const spin = Math.abs(a.turnRate);
      if (move < 0.5 && spin > 1.2) {
        a.turnStep += dt * Math.min(12, spin * 3);
        const lift = Math.max(0, Math.sin(a.turnStep)) * (1 - move) * 0.45, lift2 = Math.max(0, -Math.sin(a.turnStep)) * (1 - move) * 0.45;
        pose.thighL[0] -= lift; pose.shinL[0] += lift * 1.6;
        pose.thighR[0] -= lift2; pose.shinR[0] += lift2 * 1.6;
      }
      // Lean into turns (the left is +x: turning left leans the top toward +x).
      rootZ = Math.max(-0.26, Math.min(0.26, -a.turnRate * spd * 0.0008));
      if (falling) {
        pose.armL = [-2.3, 0, 0.5]; pose.armR = [-2.3, 0, -0.5];
        pose.foreL = [-0.4, 0, 0]; pose.foreR = [-0.4, 0, 0];
      }
      // Head: watch the target / what caught the eye; glance around when pausing.
      let look = 0;
      const watch = e.isPlayer ? null : e.ai.targetId !== null && e.ai.visible.includes(e.ai.targetId) ? state.entities[e.ai.targetId] : e.ai.visible.length ? state.entities[e.ai.visible[0]] : null;
      if (watch) look = wrap(Math.atan2(watch.x - e.x, watch.z - e.z) - a.yaw);
      else if (!e.isPlayer && e.ai.idleUntil > state.time) look = Math.sin(t * 1.4) * 0.9;
      else if (e.isPlayer) look = -a.turnRate * 0.12;
      else look = Math.sin(t * 0.37) * 0.25 * idle;
      look = Math.max(-1.15, Math.min(1.15, look));
      a.headYaw = lerp(a.headYaw, look, 1 - Math.exp(-dt * 6));
      pose.neck = [0, a.headYaw * 0.35, 0];
      pose.head = [-lean * 0.7, a.headYaw * 0.65, 0];
      pose.chest[1] += a.headYaw * 0.15;
      if (a.reach > 0) {
        // Grab: right arm shoots forward, the body leans in.
        const k = Math.sin((1 - a.reach / 0.38) * Math.PI);
        pose.armR = [lerp(pose.armR[0], -1.55, k), 0, -0.1];
        pose.foreR = [lerp(pose.foreR[0], -0.15, k), 0, 0];
        pose.spine = [lean + 0.2 * k, 0, 0];
      }
    }
    if (a.land > 0 && !e.jailed) {
      const k = Math.sin((a.land / 0.28) * Math.PI);
      hipsY -= 4.8 * k;
      for (const [th, sh] of [['thighL', 'shinL'], ['thighR', 'shinR']] as const) {
        pose[th] = [(pose[th]?.[0] ?? 0) - 0.5 * k, pose[th]?.[1] ?? 0, pose[th]?.[2] ?? 0];
        pose[sh] = [(pose[sh]?.[0] ?? 0) + 0.9 * k, 0, 0];
      }
      pose.spine = [(pose.spine?.[0] ?? 0) + 0.2 * k, 0, 0];
    }
    this.dizzy(a, stunned && !e.jailed, t);
    if (a.human.gun) this.holdRifle(a, e, state, pose, dt);
    this.apply(a, pose, hipsY, hipsX, rootZ, dt);
  }

  /**
   * Standing still: breathing, weight on one leg, and after a few seconds a personal
   * idle (hands behind the back, arms folded, or a stretch of the neck). Out of breath after
   * sprinting: hands on the knees, heavy breaths.
   */
  private idleStance(a: Anim, e: Entity, pose: Pose, t: number, idle: number): void {
    const breathe = Math.sin(t * (e.stamina < 30 ? 5.5 : 1.8));
    const add = (b: BoneName, x: number, y: number, z: number) => {
      const r = pose[b] ?? [0, 0, 0];
      pose[b] = [r[0] + x * idle, r[1] + y * idle, r[2] + z * idle];
    };
    add('chest', 0.025 * breathe, 0, 0);
    add('neck', -0.02 * breathe, 0, 0);
    if (e.stamina < 30 && !e.isPlayer || (e.isPlayer && e.stamina < 20)) {
      // Winded: bent over, hands on knees.
      add('spine', 0.55, 0, 0); add('chest', 0.15, 0, 0); add('head', -0.45, 0, 0);
      add('thighL', -0.35, 0, 0.05); add('thighR', -0.35, 0, -0.05);
      add('shinL', 0.55, 0, 0); add('shinR', 0.55, 0, 0);
      add('armL', -0.75, 0, -0.1); add('armR', -0.75, 0, 0.1);
      add('foreL', -0.2, 0, 0); add('foreR', -0.2, 0, 0);
      return;
    }
    // Weight on one leg: that hip rises, the other knee relaxes.
    const side = e.id % 2 ? 1 : -1;
    const shift = 0.5 + 0.5 * Math.sin(t * 0.23 + e.id);
    add('hips', 0, 0, 0.05 * side * shift);
    add('chest', 0, 0, -0.035 * side * shift);
    add(side > 0 ? 'shinR' : 'shinL', 0.18 * shift, 0, 0);
    add(side > 0 ? 'thighR' : 'thighL', -0.08 * shift, 0, 0);
    add('foreL', -0.15, 0, 0); add('foreR', -0.15, 0, 0);
    if (a.still < 3 || a.human.gun?.visible) return;
    const k = Math.min(1, (a.still - 3) / 0.6);
    const style = e.id % 3; // never by role: ANCHOR must not stand out
    const blend = (b: BoneName, x: number, y: number, z: number) => {
      const r = pose[b] ?? [0, 0, 0];
      pose[b] = [lerp(r[0], x, k * idle), lerp(r[1], y, k * idle), lerp(r[2], z, k * idle)];
    };
    if (style === 0) {
      // Hands clasped behind the back.
      blend('armL', 0.4, 0.6, 0.15); blend('armR', 0.4, -0.6, -0.15);
      blend('foreL', -1.3, 0, 0); blend('foreR', -1.3, 0, 0);
    } else if (style === 1) {
      // Arms folded.
      blend('armL', -0.15, 0.3, -0.75); blend('armR', -0.15, -0.3, 0.75);
      blend('foreL', -1.75, 0, 0); blend('foreR', -1.75, 0, 0);
    } else {
      // Rolls the neck and shoulders now and then.
      const r = Math.max(0, Math.sin(t * 0.5)) ** 3;
      add('head', 0, 0, 0.25 * r * Math.sin(t * 2));
      add('armL', 0, 0, -0.08 * r); add('armR', 0, 0, 0.08 * r);
    }
  }

  /** Snipers carry the rifle at low ready and shoulder it while drawing a bead or firing. */
  private holdRifle(a: Anim, e: Entity, state: GameState, pose: Pose, dt: number): void {
    const gun = a.human.gun!;
    gun.visible = !e.jailed && a.human.gearShown(); // confiscated in jail; enemies' only while it is in use
    if (e.jailed || e.channeling) return;
    if (e.cd.special > a.lastSpecialCd + 1) a.recoil = 0.7; // a real shot (not the short retry delay)
    a.lastSpecialCd = e.cd.special;
    a.recoil = Math.max(0, a.recoil - dt);
    const stunned = e.stunUntil > state.time;
    const aiming = !stunned && (a.recoil > 0 || (e.isPlayer ? !!sniperTarget(state, e) : e.ai.aimId !== null));
    a.aim = lerp(a.aim, aiming ? 1 : 0, 1 - Math.exp(-dt * 10));
    // An enemy SPOTTER that is not using the marker carries nothing and moves like everyone else.
    if (!gun.visible) return;
    const k = a.aim;
    for (const b of ['armR', 'foreR', 'armL', 'foreL'] as const) {
      const r = ARMS_READY[b]!, q = ARMS_AIM[b]!;
      pose[b] = [lerp(r[0], q[0], k), lerp(r[1], q[1], k), lerp(r[2], q[2], k)];
    }
    if (k > 0.5) {
      pose.head = [(pose.head?.[0] ?? 0) - 0.08 * k, (pose.head?.[1] ?? 0) * (1 - k) - 0.1 * k, 0];
      pose.spine = [(pose.spine?.[0] ?? 0) + 0.05 * k, 0, 0];
    }
    // Kick: the muzzle jumps up and back for a moment after the shot.
    const kick = a.recoil > 0.55 ? (a.recoil - 0.55) / 0.15 : 0;
    gun.position.lerpVectors(GUN_READY.p, GUN_AIM.p, k).z -= kick * 1.5;
    gun.rotation.set(lerp(GUN_READY.r.x, GUN_AIM.r.x, k) - kick * 0.25, lerp(GUN_READY.r.y, GUN_AIM.r.y, k), 0);
  }

  /** World position of a sniper's muzzle (last rendered pose), or null. */
  muzzle(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const m = this.anims.get(id)?.human.muzzle;
    if (!m) return null;
    return m.getWorldPosition(out);
  }

  /** Whether a character's model is currently shown. */
  shown(id: number): boolean {
    return !!this.anims.get(id)?.human.mesh.visible;
  }

  /** Three little gold stars circling over a stunned head. */
  private dizzy(a: Anim, on: boolean, t: number): void {
    if (!on) { if (a.stars) a.stars.visible = false; return; }
    if (!a.stars) {
      a.stars = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(STAR_GEO, STAR_MAT);
        m.userData.a = (i / 3) * Math.PI * 2;
        a.stars.add(m);
      }
      a.stars.position.set(0, 11.5, 0);
      a.human.bones.head.add(a.stars);
    }
    a.stars.visible = true;
    for (const m of a.stars.children) {
      const ang = m.userData.a + t * 4;
      m.position.set(Math.cos(ang) * 8.5, Math.sin(t * 6 + m.userData.a) * 1.0, Math.sin(ang) * 8.5);
      m.rotation.y = t * 5;
    }
  }

  /** Eases every bone toward its pose (quick, so the gait keeps its snap). */
  private apply(a: Anim, pose: Pose, hipsY: number, hipsX: number, rootZ: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 20);
    const { bones, rest } = a.human;
    for (const name of BONES) {
      const r = pose[name] ?? [0, 0, 0];
      const b = bones[name];
      b.rotation.x = lerp(b.rotation.x, r[0], k);
      b.rotation.y = lerp(b.rotation.y, r[1], k);
      b.rotation.z = lerp(b.rotation.z, r[2], k);
    }
    bones.root.rotation.z = lerp(bones.root.rotation.z, rootZ, k);
    bones.hips.position.y = lerp(bones.hips.position.y, rest.hips.y + hipsY, k);
    bones.hips.position.x = lerp(bones.hips.position.x, rest.hips.x + hipsX, k);
  }
}
