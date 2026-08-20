import { test, expect } from '@playwright/test';
import { boot, runTape } from './helpers.mjs';

// The afk fail-safe, end to end.
//
// The real thresholds are 2 minutes (countdown) and 5 minutes (death), which no
// suite can sit through — so these drive the clock through the ?test-only
// `idle(seconds)` cheat, which winds idleT forward directly and then lets the
// REAL scene code carry it the rest of the way. Nothing about the trigger, the
// death or the reset is faked: only the waiting is.

test('the countdown arms at two minutes of nothing, not before', async ({ page }) => {
  const errors = await boot(page);

  // Just short of the warning line: the clock is running, the screen is clean.
  await page.evaluate(() => window.__blast.cheat.idle(100));
  let st = await page.evaluate(() => window.__blast.state());
  expect(st.idleT).toBeGreaterThanOrEqual(100);
  expect(st.countdownOn).toBe(false);

  await page.evaluate(() => window.__blast.cheat.idle(125));
  st = await page.evaluate(() => window.__blast.state());
  expect(st.countdownOn).toBe(true);
  await page.screenshot({ path: 'tests/artifacts/afk-countdown.png' });

  // ...and any key at all takes it back to zero. `down` (not a tap) because the
  // clock is sampled once per frame: a keydown+keyup between two frames is
  // invisible to it, exactly as it is to input.pressed().
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.__blast.state().countdownOn === false,
                             null, { timeout: 5000 });
  await page.keyboard.up('ArrowRight');
  expect((await page.evaluate(() => window.__blast.state())).idleT).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('gauntlet: five minutes idle kills the run and resets the whole board', async ({ page }) => {
  const errors = await boot(page);
  // Bank something first, so "the board was reset" is an observable claim and
  // not just a scene that happened to already be empty.
  await runTape(page, [{ f: 0, a: { right: true } }, { f: 240, a: null }], 20000);
  const before = await page.evaluate(() => window.__blast.state());
  expect(before.score).toBeGreaterThan(0);

  // One second short of the fuse: the scene itself burns the rest.
  await page.evaluate(() => window.__blast.cheat.idle(299));
  await page.waitForFunction(() => window.__blast.state().hp === 0, null, { timeout: 15000 });
  expect((await page.evaluate(() => window.__blast.state())).pstate).toBe('ded');

  // Corpse beat, then a fresh gauntlet: still the play scene, but everything the
  // run had earned is gone.
  await page.waitForFunction(() => window.__blast.state().pstate === 'spawn',
                             null, { timeout: 15000 });
  const after = await page.evaluate(() => window.__blast.state());
  expect(after.scene).toBe('play');
  expect(after.mode).toBe('gauntlet');
  expect(after.score).toBe(0);
  expect(after.deaths).toBe(0);
  expect(after.hp).toBe(3);
  expect(after.idleT).toBeLessThan(5);      // fresh scene, fresh clock
  expect(after.countdownOn).toBe(false);
  expect(errors).toEqual([]);
});

test('wow: the same fuse ends the run through the normal run-end screen', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/?test&wow');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });

  await page.evaluate(() => window.__blast.cheat.idle(299));
  await page.waitForFunction(() => window.__blast.state().scene === 'wowend',
                             null, { timeout: 15000 });
  expect(errors).toEqual([]);
});
