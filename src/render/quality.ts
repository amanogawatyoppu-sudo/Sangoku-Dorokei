import type * as THREE from 'three';

/**
 * 画質の自動調整: watches how long frames take and, if the game keeps running slowly,
 * steps the drawing down (a lower resolution, cheaper or no shadows). It only ever
 * steps down during a match (no flicker back and forth) and remembers the level for next time.
 */

export interface QualityTier {
  name: string;
  /** Highest render pixel ratio (the screen's own ratio is used up to this). */
  pixelRatio: number;
  shadowMapSize: number;
  /** Redraw the shadow map every Nth frame (0 = no shadows). */
  shadowEvery: number;
  /** Character mesh detail (2 high … 0 low): fewer segments on the round parts. */
  detail: number;
  /** Shown in the settings: preset code and what it changes. */
  code: 'HIGH' | 'MEDIUM' | 'LOW';
  note: string;
}

export const TIERS: readonly QualityTier[] = [
  { name: '高', code: 'HIGH', note: '高解像度・くっきりした影・細かいキャラクター', pixelRatio: 2, shadowMapSize: 2048, shadowEvery: 2, detail: 2 },
  { name: '中', code: 'MEDIUM', note: '解像度と影を少し軽く（スマホ向けの標準）', pixelRatio: 1.25, shadowMapSize: 1024, shadowEvery: 3, detail: 1 },
  { name: '低', code: 'LOW', note: '影なし・低解像度・軽いキャラクター（古い端末向け）', pixelRatio: 1, shadowMapSize: 1024, shadowEvery: 0, detail: 0 },
];

const KEY = 'sangoku.quality.v1';
/** Frames slower than this on average (≈45 fps) over the window count as "slow". */
const SLOW_MS = 22;
const WINDOW_MS = 3000;

const AUTO_KEY = 'tt.quality.auto.v1';

/** The first-time preset: MEDIUM on phones and tablets, HIGH elsewhere. */
export function defaultTier(coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches): number {
  return coarse ? 1 : 0;
}

export function loadTier(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const v = Number(raw);
    return raw !== null && Number.isInteger(v) && v >= 0 && v < TIERS.length ? v : defaultTier();
  } catch { return defaultTier(); }
}

export function saveTier(t: number): void {
  try { localStorage.setItem(KEY, String(t)); } catch { /* storage off */ }
}

/** Whether the game may step the quality down by itself when it runs slowly (on unless turned off). */
export function loadAuto(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; }
}

export function saveAuto(on: boolean): void {
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* storage off */ }
}

/** Decides when to step down from frame times alone (kept apart from three.js so it can be tested). */
export class FrameJudge {
  private sum = 0;
  private n = 0;
  private span = 0;
  /** Time to ignore after a start or a change (loading, shader compiles), in ms: time, not frames, so a very slow device is not kept waiting. */
  private settle = 2500;

  /** Feeds one frame; true when the last few seconds were slow enough to step down. */
  add(frameMs: number): boolean {
    // A long pause (tab in the background, a meeting opening) is not a slow frame.
    if (frameMs > 2000) return false;
    if (this.settle > 0) { this.settle -= frameMs; return false; }
    this.sum += frameMs;
    this.n++;
    this.span += frameMs;
    if (this.span < WINDOW_MS) return false;
    const slow = this.sum / this.n > SLOW_MS;
    this.sum = 0; this.n = 0; this.span = 0;
    if (slow) this.settle = 2500;
    return slow;
  }
}

export class QualityGovernor {
  tier: number;
  /** Steps down by itself only when the player has not turned that off. */
  auto = loadAuto();
  private judge = new FrameJudge();
  private frame = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private sun: THREE.DirectionalLight,
    private resize: (pixelRatioCap: number) => void,
    private onChange: (tier: QualityTier) => void = () => {},
  ) {
    this.tier = loadTier();
    renderer.shadowMap.autoUpdate = false;
    this.apply(false);
  }

  get current(): QualityTier { return TIERS[this.tier]; }

  /** Call once per rendered frame, before rendering. */
  beforeRender(frameMs: number): void {
    const t = this.current;
    this.frame++;
    if (t.shadowEvery > 0 && this.frame % t.shadowEvery === 0) this.renderer.shadowMap.needsUpdate = true;
    if (this.auto && this.tier < TIERS.length - 1 && this.judge.add(frameMs)) {
      this.tier++;
      saveTier(this.tier);
      this.apply(true);
    }
  }

  private apply(announce: boolean): void {
    const t = this.current;
    const shadows = t.shadowEvery > 0;
    if (this.sun.castShadow !== shadows) this.sun.castShadow = shadows;
    if (this.sun.shadow.mapSize.x !== t.shadowMapSize) {
      this.sun.shadow.mapSize.setScalar(t.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.resize(t.pixelRatio);
    if (announce) this.onChange(t);
  }
}
