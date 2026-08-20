import { test, expect } from '@playwright/test';
import { boot } from './helpers.mjs';

// The sub-640 branch of engine/fit.js, on real glass: a 500x400 dpr-1 window
// has fewer device pixels than the game has game pixels, so the scale must go
// fractional — the old clamp to 1 hung the canvas off the screen.

test('a window under 640x360 downscales fractionally and never overflows', async ({ page }) => {
  const errors = await boot(page);
  const s = await page.evaluate(() => window.__blast.state());
  expect(s.scale).toBeLessThan(1);
  expect(s.scale).toBeGreaterThan(0);
  const box = await page.evaluate(() => {
    const b = document.getElementById('screen').getBoundingClientRect();
    return { right: b.right, bottom: b.bottom, left: b.left, top: b.top,
             winW: innerWidth, winH: innerHeight,
             scrollW: document.documentElement.scrollWidth,
             scrollH: document.documentElement.scrollHeight };
  });
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(box.winW + 0.5);
  expect(box.bottom).toBeLessThanOrEqual(box.winH + 0.5);
  expect(box.scrollW).toBeLessThanOrEqual(box.winW);
  expect(box.scrollH).toBeLessThanOrEqual(box.winH);
  // ...and it is still the same playable game, just smaller.
  expect(s.pstate).toBe('idle');
  await page.screenshot({ path: 'tests/artifacts/smallview.png' });
  expect(errors).toEqual([]);
});
