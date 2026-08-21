import { test, expect } from '@playwright/test';
import { boot, runTape } from './helpers.mjs';

// Juice pass: rendered-sound wiring + render-dressing observability.
//
// The SOUND half asserts through sfx.current() (the ?test build is silent but
// still bookkeeps every play, which is exactly what these specs need) plus one
// REAL-build test for the network story: nothing fetched before the first
// gesture, everything stamped after it.
//
// The VISUAL half (dust/debris pool) asserts through state().parts — a live
// count of the fixed render pool. Determinism note: the particles are
// render-only (mulberry32 off spawn coords, never sim state), so these specs
// only prove the pool LIVES; the sim invariants are covered by the untouched
// verb/gauntlet suites staying green.

test('rendered sfx: nothing before a gesture, 14 stamped fetches after it', async ({ page }) => {
  const sfxReqs = [];
  page.on('request', r => { if (r.url().includes('/assets/sfx/')) sfxReqs.push(r.url()); });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');          // REAL build — no ?test
  await page.waitForTimeout(1500);
  expect(sfxReqs).toEqual([]);                        // silence costs zero bytes
  await page.keyboard.press('KeyX');                  // first gesture → unlock
  await expect.poll(() => sfxReqs.length, { timeout: 10000 }).toBe(14);
  for (const u of sfxReqs) expect(u).toMatch(/\/assets\/sfx\/[a-z]+_[abc]\.m4a\?v=/);
  expect(errors).toEqual([]);
});

test('?test stays silent AND fetch-free, but still counts every ask', async ({ page }) => {
  const sfxReqs = [];
  page.on('request', r => { if (r.url().includes('/assets/sfx/')) sfxReqs.push(r.url()); });
  const errors = await boot(page);
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(800);
  const cur = await page.evaluate(() => window.__blast.sfx.current());
  expect(cur.inert).toBe(true);
  expect(cur.loaded).toBe(0);
  expect(sfxReqs).toEqual([]);
  expect(errors).toEqual([]);
});

test('takeoff roars once at the extraction trigger', async ({ page }) => {
  const errors = await boot(page);
  // Same cheat route to the pad the share/win specs use.
  await page.evaluate(() => window.__blast.cheat.warp(21500));
  await runTape(page, [{ f: 0, a: { right: true } }, { f: 200, a: null }], 20000);
  await page.waitForFunction(() => window.__blast.state().bossSpawned === true, null,
                             { timeout: 20000 });
  await page.evaluate(() => window.__blast.cheat.killBoss());
  await page.evaluate(() => window.__blast.cheat.warpPad());
  await runTape(page, [{ f: 0, a: { right: true } }, { f: 90, a: null }], 20000);
  await page.waitForFunction(() => window.__blast.state().takeoff === true, null,
                             { timeout: 20000 });
  const log = await page.evaluate(() => window.__blast.sfx.current().log);
  expect(log.filter(n => n === 'takeoff')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('afktick clicks once per countdown second, and only while the warning shows', async ({ page }) => {
  const errors = await boot(page);
  const ticksNow = () => page.evaluate(() =>
    window.__blast.sfx.current().log.filter(n => n === 'afktick').length);
  expect(await ticksNow()).toBe(0);                   // no warning, no ticks
  await page.evaluate(() => window.__blast.cheat.idle(125));
  await page.waitForFunction(() => window.__blast.state().countdownOn === true, null,
                             { timeout: 5000 });
  // ~2.5 real seconds under the countdown → 2-4 whole-second edges. The exact
  // count is timing-dependent; once per second is the shape being asserted.
  await page.waitForTimeout(2500);
  const ticks = await ticksNow();
  expect(ticks).toBeGreaterThanOrEqual(2);
  expect(ticks).toBeLessThanOrEqual(4);
  // Any input ends the incident: the count stops moving.
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__blast.state().countdownOn === false, null,
                             { timeout: 5000 });
  const after = await ticksNow();
  await page.waitForTimeout(1200);
  expect(await ticksNow()).toBe(after);
  expect(errors).toEqual([]);
});

test('landing kicks dust into the render pool; idle air kicks none', async ({ page }) => {
  const errors = await boot(page);
  expect((await page.evaluate(() => window.__blast.state())).parts).toBe(0);
  // A hop straight up: the landing (and only the landing) puffs dust.
  await page.evaluate(() => {
    const base = window.__blast.frame;
    window.__blast.playTape([{ f: base + 2, a: { down: true, fire: true } },
                             { f: base + 6, a: null }]);
  });
  await page.waitForFunction(() => window.__blast.state().parts > 0, null,
                             { timeout: 8000 });
  const peak = (await page.evaluate(() => window.__blast.state())).parts;
  expect(peak).toBeGreaterThanOrEqual(1);
  expect(peak).toBeLessThanOrEqual(64);               // the fixed pool is the law
  // ...and the pool drains back to zero on its own: particles are bounded in
  // TIME as well as count.
  await page.waitForFunction(() => window.__blast.state().parts === 0, null,
                             { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('rapid coins climb the combo; a gap resets it', async ({ page }) => {
  const errors = await boot(page);
  // Sprint right out of spawn: C1's opening coin line is the designed
  // "several pickups in quick succession" — the streak must climb past 0.
  await page.evaluate(() => {
    const base = window.__blast.frame;
    window.__blast.playTape([{ f: base + 2, a: { right: true } }, { f: base + 300, a: null }]);
  });
  let maxCombo = 0;
  for (let i = 0; i < 60; i++) {
    const c = await page.evaluate(() => window.__blast.sfx.current().combo);
    maxCombo = Math.max(maxCombo, c);
    if (await page.evaluate(() => window.__blast.tapeDone())) break;
    await page.waitForTimeout(100);
  }
  expect(maxCombo).toBeGreaterThanOrEqual(1);
  // (Reset-on-gap and the cap are pure logic, pinned by the unit suite —
  // what THIS spec proves is the wiring: real pickups drive the streak.)
  expect(errors).toEqual([]);
});
