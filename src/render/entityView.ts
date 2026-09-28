import * as THREE from 'three';
import { NATION_IDS, NATIONS } from '../config/nations';
import type { NationId } from '../config/nations';
import type { Entity } from '../sim/entity';
import type { GameState } from '../sim/state';
import { effNation, visibleTo } from '../sim/systems/vision';
import { STEP_SEC } from '../core/clock';
import type { BoneName, Human } from './humanModel';
import { BONES, buildHuman } from './humanModel';
import { emblemTexture } from './textures';
import { sniperTarget } from '../sim/systems/abilities';

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
}

/** Rifle placement on the chest bone: low ready (muzzle down, across the body) and shouldered. */
const GUN_READY = { p: new THREE.Vector3(-1.8, -1.5, 8.5), r: new THREE.Euler(0.5, 0.25, 0) };
const GUN_AIM = { p: new THREE.Vector3(-2.6, 5.0, 10.5), r: new THREE.Euler(0, 0, 0) };
const ARMS_READY: Pose = { armR: [-0.5, 0, 0.12], foreR: [-1.1, 0, 0], armL: [-0.7, 0, -0.45], foreL: [-1.3, 0, 0] };
const ARMS_AIM: Pose = { armR: [-1.3, 0, 0.35], foreR: [-0.85, 0, 0], armL: [-1.55, 0, -0.55], foreL: [-0.3, 0, 0] };

/** Target rotations (x, y, z) per bone for this frame; missing = rest. */
type Pose = Partial<Record<BoneName, [number, number, number]>>;

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

export class EntityView {
  private anims = new Map<number, Anim>();
  private emblemMats: Record<NationId, THREE.MeshStandardMaterial>;
  private playerEmblemMats: Record<NationId, THREE.MeshStandardMaterial>;
  private clock = 0;

  constructor(scene: THREE.Scene, state: GameState) {
    const mk = (n: NationId) => new THREE.MeshStandardMaterial({
      map: emblemTexture(NATIONS[n].emblem, NATIONS[n].color), roughness: 0.8,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.emblemMats = Object.fromEntries(NATION_IDS.map((n) => [n, mk(n)])) as Record<NationId, THREE.MeshStandardMaterial>;
    this.playerEmblemMats = Object.fromEntries(NATION_IDS.map((n) => [n, mk(n)])) as Record<NationId, THREE.MeshStandardMaterial>;
    for (const e of state.entities) {
      const mats = e.isPlayer ? this.playerEmblemMats : this.emblemMats;
      const human = buildHuman(e.id, NATIONS[e.nation].color, mats[e.nation], { gun: e.role === 'sniper' });
      if (e.isPlayer) addXray(human.mesh, NATIONS[e.nation].color);
      human.mesh.scale.setScalar(human.look.height);
      scene.add(human.mesh);
      this.anims.set(e.id, {
        human, phase: (e.id * 1.7) % (Math.PI * 2), yaw: Math.atan2(e.dirX, e.dirZ), turnRate: 0, speed: 0,
        headYaw: 0, reach: 0, lastCapCd: e.cd.capture, nation: e.nation, aim: 0, recoil: 0, lastSpecialCd: e.cd.special,
        accel: 0, still: 0, land: 0, airborne: false, turnStep: 0,
      });
    }
  }

  /** Fade the player's model when the camera is squeezed right behind it (indoors, against walls). */
  playerOpacity = 1;

  /** Spectating as a ghost: everyone is shown. */
  seeAll = false;

  sync(state: GameState, alpha: number, dtSec = 1 / 60): void {
    const p = state.player;
    this.clock += dtSec;
    for (const e of state.entities) {
      const a = this.anims.get(e.id)!;
      const mesh = a.human.mesh;
      if (!e.alive) { mesh.visible = false; continue; }
      const vis = e === p || this.seeAll || visibleTo(state, e, p);
      mesh.visible = vis;
      if (!vis) continue;
      mesh.position.set(lerp(e.prevX, e.x, alpha), lerp(e.prevY, e.y, alpha), lerp(e.prevZ, e.z, alpha));
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
      this.animate(a, e, state, dtSec);
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
    // Stride: ~1.3 m walking, ~2.3 m running, ~2.9 m sprinting (one step = half a cycle).
    const stride = Math.min(78, 34 + spd * 0.09);
    a.phase += (back ? -1 : 1) * (spd * dt / stride) * Math.PI;
    const ph = a.phase, s = Math.sin(ph), c = Math.cos(ph);

    // Grab: the capture cooldown was just reset.
    if (e.cd.capture > a.lastCapCd + 0.3) a.reach = 0.38;
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
    if (e.jailed) {
      // 体育座り: hugging the knees on the ground.
      hipsY = -17;
      pose.spine = [0.35, 0, 0];
      pose.head = [0.15, Math.sin(t * 0.4) * 0.3, 0];
      pose.thighL = [-2.0, 0, 0.14]; pose.thighR = [-2.0, 0, -0.14];
      pose.shinL = [2.5, 0, 0]; pose.shinR = [2.5, 0, 0];
      pose.armL = [-0.95, 0, -0.1]; pose.armR = [-0.95, 0, 0.1];
      pose.foreL = [-0.9, 0, 0]; pose.foreR = [-0.9, 0, 0];
    } else if (e.channeling) {
      // Crouched, working at a lock or terminal with both hands.
      hipsY = -8;
      pose.spine = [0.45, 0, 0];
      pose.head = [0.1, 0, 0];
      pose.thighL = [-1.0, 0, 0.1]; pose.thighR = [-0.6, 0, -0.1];
      pose.shinL = [1.7, 0, 0]; pose.shinR = [1.3, 0, 0];
      pose.footL = [-0.6, 0, 0]; pose.footR = [-0.6, 0, 0];
      const w = Math.sin(t * 9) * 0.12;
      pose.armL = [-1.1 + w, 0, -0.15]; pose.armR = [-1.1 - w, 0, 0.15];
      pose.foreL = [-0.5, 0, 0]; pose.foreR = [-0.5, 0, 0];
    } else if (stunned) {
      // Dazed: hunched, knees buckling, swaying.
      hipsY = -4;
      rootZ = Math.sin(t * 5) * 0.08;
      pose.spine = [0.5, 0, Math.sin(t * 3) * 0.1];
      pose.head = [0.4, Math.sin(t * 2.3) * 0.3, 0];
      pose.thighL = [-0.45, 0, 0.1]; pose.thighR = [-0.35, 0, -0.1];
      pose.shinL = [0.8, 0, 0]; pose.shinR = [0.7, 0, 0];
      pose.armL = [-0.35, 0, 0.15]; pose.armR = [-0.3, 0, -0.15];
      pose.foreL = [-0.3, 0, 0]; pose.foreR = [-0.3, 0, 0];
    } else {
      // Locomotion blended with a relaxed stance.
      const A = lerp(0.42, 0.78, run) * move; // hip swing
      const K = lerp(0.55, 1.55, run) * move; // knee lift in the swing phase
      const Aa = lerp(0.32, 0.72, run) * move; // arm swing
      const E = lerp(0.22, 1.35, run) * move + 0.12; // elbow bend
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
      pose.armL = [Aa * s, 0, 0.07 + run * 0.06];
      pose.armR = [-Aa * s, 0, -0.07 - run * 0.06];
      pose.foreL = [-E - 0.15 * Math.max(0, -s) * move, 0, 0];
      pose.foreR = [-E - 0.15 * Math.max(0, s) * move, 0, 0];
      // Bob twice per cycle, lower when running; hips twist against the shoulders.
      hipsY = move * (lerp(0.45, 1.3, run) * Math.cos(2 * ph) - run * 1.2);
      // Pelvis shifts over the planted foot while walking.
      hipsX = move * (1 - run) * 0.9 * s;
      const idle = 1 - move;
      // Starts and stops: lean into the acceleration, rock back when braking hard.
      const surge = Math.max(-0.12, Math.min(0.14, a.accel * 0.0009));
      const lean = (back ? -0.08 : lerp(0.05, 0.24, run)) * move + surge;
      pose.hips = [0, 0.13 * s * move, 0.045 * s * move * (1 - run) + idle * 0.025 * Math.sin(t * 0.7)];
      pose.spine = [lean, 0, 0];
      pose.chest = [0.02 + idle * 0.018 * Math.sin(t * 1.9), -0.17 * s * move, 0];
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
      rootZ = Math.max(-0.22, Math.min(0.22, -a.turnRate * spd * 0.0007));
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
      hipsY -= 6 * k;
      for (const [th, sh] of [['thighL', 'shinL'], ['thighR', 'shinR']] as const) {
        pose[th] = [(pose[th]?.[0] ?? 0) - 0.5 * k, pose[th]?.[1] ?? 0, pose[th]?.[2] ?? 0];
        pose[sh] = [(pose[sh]?.[0] ?? 0) + 0.9 * k, 0, 0];
      }
      pose.spine = [(pose.spine?.[0] ?? 0) + 0.2 * k, 0, 0];
    }
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
    if (a.still < 3 || e.role === 'sniper') return;
    const k = Math.min(1, (a.still - 3) / 0.6);
    const style = e.role === 'king' ? 0 : e.id % 3;
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
    gun.visible = !e.jailed; // confiscated in jail
    if (e.jailed || e.channeling) return;
    if (e.cd.special > a.lastSpecialCd + 1) a.recoil = 0.7; // a real shot (not the short retry delay)
    a.lastSpecialCd = e.cd.special;
    a.recoil = Math.max(0, a.recoil - dt);
    const stunned = e.stunUntil > state.time;
    const aiming = !stunned && (a.recoil > 0 || (e.isPlayer ? !!sniperTarget(state, e) : e.ai.aimId !== null));
    a.aim = lerp(a.aim, aiming ? 1 : 0, 1 - Math.exp(-dt * 10));
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
