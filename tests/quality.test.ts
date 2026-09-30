import { describe, expect, it } from 'vitest';
import { FrameJudge, TIERS } from '../src/render/quality';

const feed = (j: FrameJudge, ms: number, frames: number) => { let hit = 0; for (let i = 0; i < frames; i++) if (j.add(ms)) hit++; return hit; };

describe('画質の自動調整', () => {
  it('steady 60 fps never steps down', () => {
    expect(feed(new FrameJudge(), 16.7, 60 * 30)).toBe(0);
  });

  it('a steady slow game (≈30 fps) steps down after a few seconds, then waits before judging again', () => {
    const j = new FrameJudge();
    expect(feed(j, 33, 76 + 60)).toBe(0); // 2.5 s grace + under the 3 s window
    expect(feed(j, 33, 40)).toBe(1);
    expect(feed(j, 33, 60)).toBe(0); // settling after the change
  });

  it('one hitch or a paused tab is not "slow"', () => {
    const j = new FrameJudge();
    feed(j, 16.7, 160);
    j.add(5000); // tab in the background
    for (let i = 0; i < 200; i++) j.add(i === 100 ? 120 : 16.7);
    expect(feed(j, 16.7, 60 * 5)).toBe(0);
  });

  it('a very slow device (2 fps) steps down within seconds, not minutes', () => {
    const j = new FrameJudge();
    let t = 0, hit = -1;
    for (let i = 0; i < 40 && hit < 0; i++) { t += 500; if (j.add(500)) hit = t; }
    expect(hit).toBeGreaterThan(0);
    expect(hit).toBeLessThanOrEqual(6000);
  });

  it('tiers go from sharp to light', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].pixelRatio).toBeLessThanOrEqual(TIERS[i - 1].pixelRatio);
      expect(TIERS[i].shadowMapSize).toBeLessThanOrEqual(TIERS[i - 1].shadowMapSize);
    }
    expect(TIERS[TIERS.length - 1].shadowEvery).toBe(0);
  });
});
