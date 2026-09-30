import art from '../assets/loading.webp?inline';
import { $ } from './dom';

/** Short hints shown under the bar (one per load). */
const TIPS = [
  '背後から近づけば捕まえやすい。正面からは捕まえられない',
  '王は正面からでも捕まえられる「スーパーハンド」を持つ',
  '牢屋の仲間は、処刑される前なら救出できる',
  '管制塔を持つ国は、終盤に敵国の王を光の柱で照らせる',
  '拠点の輪に立ち続けると戦区を制圧できる',
  'ダッシュ中は足音が大きい。近くの敵に気付かれやすい',
  '1〜4キー（スマホは「合図」）で味方に知らせよう',
  '夜は街灯の下にいる人だけが遠くから見える',
];

const MIN_MS = 1600;

/** Sets the art now, and decodes it, so the screen never shows up blank. */
export function initLoading(): void {
  $('loading').style.setProperty('--art', `url(${art})`);
  const img = new Image();
  img.src = art;
  void img.decode?.().catch(() => {});
}
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * ロード画面 (作戦地域へ移動中…): covers the switch from the settings to a match.
 * The bar creeps while the match is built, then fills once the first frames
 * (and their shader compiles) are drawn, and the screen fades out.
 */
export async function withLoading(opts: { label?: string; info?: string }, start: () => void): Promise<void> {
  const box = $('loading'), fill = $('ldFill');
  $('ldText').textContent = opts.label ?? '作戦地域へ移動中';
  $('ldInfo').textContent = opts.info ?? '';
  $('ldTip').textContent = 'TIPS：' + TIPS[Math.floor(Math.random() * TIPS.length)];
  box.classList.remove('out');
  box.hidden = false;
  const t0 = performance.now();
  let target = 0.72, shown = 0, done = false;
  const tick = () => {
    shown += (target - shown) * (done ? 0.25 : 0.05);
    fill.style.width = `${Math.round(shown * 1000) / 10}%`;
    if (box.hidden) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Let the screen paint before the heavy work.
  await nextFrame();
  await nextFrame();
  start();
  target = 0.9;
  for (let i = 0; i < 4; i++) await nextFrame();
  const left = MIN_MS - (performance.now() - t0);
  if (left > 0) await sleep(left);
  done = true;
  target = 1;
  await sleep(350);
  box.classList.add('out');
  await sleep(450);
  box.hidden = true;
}
