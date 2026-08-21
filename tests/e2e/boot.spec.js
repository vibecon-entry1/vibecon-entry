import { test, expect } from '@playwright/test';

// None of these five adopt tests/e2e/helpers.mjs's boot()/runTape() — each one's
// setup differs from the shared helper in a way that would change behavior:
//   - "plain boot lands on title": deliberately goes to '/' WITHOUT '?test',
//     which is exactly what boot() (and every other e2e) can't do — the title
//     scene has no player, so boot()'s pstate wait would hang forever.
//   - "boots clean": only waits ready (checks scene/anims that don't depend on
//     player pstate); boot() also waits for pstate === 'idle', an extra wait
//     not present here.
//   - "tape final entry": doesn't collect errors and doesn't wait for idle
//     before driving the tape (adding the idle wait would delay the tape start).
//   - "boot failure": needs addInitScript registered BEFORE goto; boot() does
//     the goto internally, so it can't be interleaved.
//   - "viewer renders every anim": collects only pageerror (not console errors)
//     and, like the tape test, waits ready only, no idle wait.
//
// Every test that wants GAMEPLAY navigates to '/?test': the plain '/' front
// door is the title screen now.

test('plain boot lands on title', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');            // no ?test → the real front door
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  const st = await page.evaluate(() => window.__blast.state());
  expect(st.scene).toBe('title');
  expect(st.phase).toBe('title');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'tests/artifacts/title.png' });
});

test('boots clean: canvas, atlas, no console errors', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  // Cache-busting guard: every atlas fetch must carry the ?v= build stamp read
  // off index.html's module entry tag (engine/version.js). A returning
  // player's cache once mixed an old main.js with a new atlas — the stamp is
  // what keys those caches consistently, so its absence is a regression.
  const atlasReqs = [];
  page.on('request', r => {
    const u = new URL(r.url());
    if (/\/assets\/atlas\.(json|png)$/.test(u.pathname))
      atlasReqs.push(u.searchParams.get('v'));
  });
  await page.goto('http://localhost:8123/?test');       // test-mode boot → straight to play
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await expect(page.locator('canvas#screen')).toBeVisible();
  const st = await page.evaluate(() => window.__blast.state());
  expect(st.scene).toBe('play');
  expect(st.anims).toBe(51);
  expect(atlasReqs.length).toBe(2);                     // atlas.json + atlas.png
  for (const v of atlasReqs) expect(v).toMatch(/^.+$/); // both stamped, non-empty
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'tests/artifacts/boot.png' });
});

test('tape final entry is observed by the sim (press-and-hold)', async ({ page }) => {
  await page.goto('http://localhost:8123/?test');       // needs play: F1 toggles play<->viewer
  await page.waitForFunction(() => window.__blast?.ready === true);
  await page.evaluate(() => window.__blast.playTape([{ f: window.__blast.frame + 5, a: { debug: true } }]));
  await page.waitForFunction(() => window.__blast.state().scene === 'viewer', null, { timeout: 5000 });
  expect((await page.evaluate(() => window.__blast.state())).scene).toBe('viewer');
});

test('boot failure shows doge error screen (throwing localStorage)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });
  });
  await page.goto('http://localhost:8123/');
  await expect(page.locator('#err')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#err')).toContainText('very refresh');
});

test('viewer renders every anim without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/?test');       // F1 toggles play<->viewer, so start in play
  await page.waitForFunction(() => window.__blast?.ready === true);
  await page.keyboard.press('F1', { delay: 30 });          // → viewer
  await page.waitForFunction(() => window.__blast.state().scene === 'viewer');
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const name = (await page.evaluate(() => window.__blast.state())).viewerAnim;
    seen.add(name);
    await page.screenshot({ path: `tests/artifacts/anim-${String(i).padStart(2, '0')}-${name}.png` });
    await page.keyboard.press('ArrowRight', { delay: 30 });
  }
  expect(seen.size).toBe(20);
  expect(errors).toEqual([]);
});
