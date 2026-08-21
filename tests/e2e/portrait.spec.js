import { test, expect } from '@playwright/test';
import { boot } from './helpers.mjs';
import { touchRig, st } from './touchhelpers.mjs';

// The rotate veil. Portrait on a touch device = full-canvas "very rotate."
// overlay with the world held still underneath; landscape brings both back.

test('portrait raises the veil and freezes the world; rotating back resumes', async ({ page }) => {
  const errors = await boot(page);
  expect((await st(page)).portraitBlocked).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.__blast.state().portraitBlocked === true,
                             null, { timeout: 5000 });
  await page.screenshot({ path: 'tests/artifacts/portrait-veil.png' });

  // Frozen means FROZEN: the run clock must not move under the veil.
  const t0 = (await st(page)).timeS;
  await page.waitForTimeout(1200);
  expect((await st(page)).timeS).toBe(t0);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.__blast.state().portraitBlocked === false,
                             null, { timeout: 5000 });
  // ...and the clock runs again.
  await page.waitForFunction(s => window.__blast.state().timeS > s, t0, { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('taps under the veil drain: nothing fires on rotate-back', async ({ page }) => {
  const errors = await boot(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.__blast.state().portraitBlocked === true,
                             null, { timeout: 5000 });
  // Poke everything pokeable while veiled: fire zone, pause plate, and a
  // hold — the veiled input cycle must drain all of it every frame.
  const t = await touchRig(page);
  await t.hold(400, 200, 1);                  // fire zone
  await t.tap(597, 13);                       // pause plate
  await t.hold(520, 250, 2);                  // fire zone again, drag-length
  await page.waitForTimeout(300);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.__blast.state().portraitBlocked === false,
                             null, { timeout: 5000 });
  // Give the first live frames time to betray a stale latch, then assert
  // rotate-back started clean: no phantom shot, no phantom pause.
  await page.waitForTimeout(400);
  const s = await st(page);
  expect(s.shots).toBe(0);
  expect(s.paused).toBe(false);
  expect(s.scene).toBe('play');
  expect(errors).toEqual([]);
});
