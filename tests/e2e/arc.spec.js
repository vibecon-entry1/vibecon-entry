import { test, expect } from '@playwright/test';
import { boot, runTape } from './helpers.mjs';

// Plan 3 / M4 wrap: the full arc, end to end — title → intro → play, pause
// freezing the clock, the boss gate (trigger/kill/carve), and the win screen
// with best-score persistence. Unlike boot.spec.js/gauntlet.spec.js these
// deliberately exercise scenes OUTSIDE play (title, win), so only the first
// test skips boot() (same reason as boot.spec.js's "plain boot" test: title
// has no player, so boot()'s idle-pstate wait would hang).

test('plain boot: title → intro → play flow', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  expect((await page.evaluate(() => window.__blast.state())).scene).toBe('title');

  // 1st X: title -> intro0.
  await page.keyboard.press('KeyX', { delay: 30 });
  expect((await page.evaluate(() => window.__blast.state())).phase).toBe('intro0');

  // 3 more cards to clear (intro0 -> intro1 -> intro2 -> play), one X each.
  // The title scene's `pressed('fire')` edge is polled once per rAF, and a
  // KeyX press this close to the next one can occasionally land inside the
  // same frame as the previous release and get swallowed (observed: 5 raw
  // presses sometimes needed to clear 4 cards) — so drive with a bounded
  // retry loop keyed off scene state instead of a fixed press count.
  for (let i = 0; i < 15 && (await page.evaluate(() => window.__blast.state())).scene !== 'play'; i++) {
    await page.keyboard.press('KeyX', { delay: 30 });
    await page.waitForTimeout(60);          // let a rAF land between edges
  }
  expect((await page.evaluate(() => window.__blast.state())).scene).toBe('play');
  await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });

  expect(errors).toEqual([]);
});

test('pause freezes the clock', async ({ page }) => {
  const errors = await boot(page);

  const t1 = (await page.evaluate(() => window.__blast.state())).timeS;
  await page.waitForTimeout(1200);
  const t2 = (await page.evaluate(() => window.__blast.state())).timeS;
  expect(t2).toBeGreaterThan(t1);

  await page.keyboard.press('Escape', { delay: 30 });
  expect((await page.evaluate(() => window.__blast.state())).paused).toBe(true);

  const p1 = (await page.evaluate(() => window.__blast.state())).timeS;
  await page.waitForTimeout(1000);
  const p2 = (await page.evaluate(() => window.__blast.state())).timeS;
  expect(p2).toBe(p1);

  await page.keyboard.press('Escape', { delay: 30 });
  expect((await page.evaluate(() => window.__blast.state())).paused).toBe(false);

  expect(errors).toEqual([]);
});

test('boss gate: trigger, kill, carve', async ({ page }) => {
  const errors = await boot(page);

  await page.evaluate(() => window.__blast.cheat.warp(5400));
  const tape = [{ f: 0, a: { right: true } }, { f: 200, a: null }];
  await runTape(page, tape, 20000);
  await page.waitForFunction(() => window.__blast.state().bossSpawned === true, null, { timeout: 20000 });

  const st1 = await page.evaluate(() => window.__blast.state());
  expect(st1.bossOn).toBe(true);
  expect(st1.bossHp).toBe(40);
  expect(st1.gateOpen).toBe(false);

  await page.evaluate(() => window.__blast.cheat.killBoss());
  const st2 = await page.evaluate(() => window.__blast.state());
  expect(st2.bossOn).toBe(false);
  expect(st2.gateOpen).toBe(true);
  expect(st2.score).toBeGreaterThanOrEqual(500);

  await page.screenshot({ path: 'tests/artifacts/arc-boss.png' });
  expect(errors).toEqual([]);
});

test('win: takeoff → win screen → best persists', async ({ page }) => {
  const errors = await boot(page);

  // warp() only moves x — bossSpawned is latched inside play.js's per-frame
  // update() when it notices player.x > bossTrigger, so killBoss() right
  // after warp() (no frame in between) finds boss still null and no-ops.
  // Same fix as the boss-gate test above: give it a frame to notice.
  await page.evaluate(() => window.__blast.cheat.warp(5400));
  await runTape(page, [{ f: 0, a: { right: true } }, { f: 200, a: null }], 20000);
  await page.waitForFunction(() => window.__blast.state().bossSpawned === true, null, { timeout: 20000 });

  await page.evaluate(() => window.__blast.cheat.killBoss());
  await page.evaluate(() => window.__blast.cheat.warpPad());

  const tape = [{ f: 0, a: { right: true } }, { f: 90, a: null }];
  await runTape(page, tape, 20000);

  await page.waitForFunction(() => window.__blast.state().takeoff === true, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__blast.state().scene === 'win', null, { timeout: 20000 });

  const st = await page.evaluate(() => window.__blast.state());
  expect(st.finalScore).toBeGreaterThan(0);
  expect(st.best).toBeGreaterThanOrEqual(st.finalScore);

  await page.screenshot({ path: 'tests/artifacts/arc-win.png' });

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('suchblast_v1')));
  expect(saved.best.gauntlet).toBe(st.best);

  await page.keyboard.press('KeyR', { delay: 30 });
  expect((await page.evaluate(() => window.__blast.state())).scene).toBe('title');

  expect(errors).toEqual([]);
});
