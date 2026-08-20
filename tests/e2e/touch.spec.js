import { test, expect } from '@playwright/test';
import { boot } from './helpers.mjs';
import { touchRig, st } from './touchhelpers.mjs';

// The touch verb, end to end, on the mobile project (hasTouch, dpr 3,
// landscape). Everything here drives the REAL input path: browser touch input
// via the touchscreen/CDP, through the pointer handlers in engine/input.js,
// out the same abstract actions the keyboard emits. No tapes, no setVirtual.

test('touch boot: the touch UI is live before any finger lands', async ({ page }) => {
  const errors = await boot(page);
  const s = await st(page);
  expect(s.touchUI).toBe(true);                 // coarse pointer alone arms it
  expect(s.portraitBlocked).toBe(false);        // landscape: no veil
  await page.screenshot({ path: 'tests/artifacts/touch-hints.png' });
  expect(errors).toEqual([]);
});

test('move zone: drag right runs, release stops', async ({ page }) => {
  const errors = await boot(page);
  const t = await touchRig(page);
  const x0 = (await st(page)).x;
  await t.drag(1, [120, 200], [180, 200]);      // 60 virtual px: well past the deadzone
  await page.waitForFunction(x => window.__blast.state().x > x + 40, x0, { timeout: 5000 });
  expect((await st(page)).pstate).toBe('walk');
  await t.endAll();
  await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('slide: drag down-forward seats the slide; a second thumb bursts', async ({ page }) => {
  const errors = await boot(page);
  const t = await touchRig(page);
  // The chord needs an ESTABLISHED slide (>= 0.12s seated) at the moment the
  // fire tick lands — a held fire thumb autofires and always catches the next
  // slide fresh (that's the hop, by design), so this taps like a human does:
  // seat the slide, beat, tap. Bounded retries because the slide itself
  // decays out from under a slow frame.
  let burst = false;
  for (let i = 0; i < 8 && !burst; i++) {
    await t.drag(1, [120, 160], [180, 220]);    // right + down = slide
    const seated = await page.waitForFunction(() => window.__blast.state().h === 24,
                                              null, { timeout: 5000 }).then(() => true);
    await page.waitForTimeout(200);             // past the 0.12s establishment line
    await t.send('touchStart', [[180, 220, 1], [520, 200, 2]]);   // fire thumb down
    await page.waitForTimeout(100);
    await t.send('touchEnd', [[180, 220, 1]]);  // fire thumb up, move thumb stays
    // The burst is the one fire path that pushes vx past slide speed.
    burst = seated && await page.waitForFunction(() => {
      const s = window.__blast.state();
      return s.shots > 0 && Math.abs(s.vx) > window.__blast.P.SLIDE_SPEED + 40;
    }, null, { timeout: 700 }).then(() => true, () => false);
    await t.endAll();
  }
  expect(burst).toBe(true);
  expect(errors).toEqual([]);
});

test('fire zone: tap pews; a held down-drag hops, then boosts in air', async ({ page }) => {
  const errors = await boot(page);
  const t = await touchRig(page);
  await t.hold(520, 200, 9);                    // thumb-length tap = pew
  await page.waitForFunction(() => window.__blast.state().shots >= 1, null, { timeout: 5000 });
  // Down-drag held on the fire zone: grounded tick = hop, the next airborne
  // tick = boost, which is the only thing that spends an air charge here.
  await t.drag(2, [520, 160], [520, 220]);
  await page.waitForFunction(() => window.__blast.state().charges < 3, null, { timeout: 5000 });
  await t.endAll();
  expect(errors).toEqual([]);
});

test('pause and mute plates answer taps at phone size', async ({ page }) => {
  const errors = await boot(page);
  const t = await touchRig(page);
  await t.tap(597, 13);                         // pause plate centre
  await page.waitForFunction(() => window.__blast.state().paused === true, null, { timeout: 5000 });
  await page.screenshot({ path: 'tests/artifacts/touch-paused.png' });
  await t.tap(597, 13);
  await page.waitForFunction(() => window.__blast.state().paused === false, null, { timeout: 5000 });
  await t.tap(626, 13);                         // sound plate centre
  await page.waitForFunction(() => window.__blast.jukebox.current().muted === true,
                             null, { timeout: 5000 });
  await t.tap(626, 13);
  await page.waitForFunction(() => window.__blast.jukebox.current().muted === false,
                             null, { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('a touch is presence: the afk clock resets on it', async ({ page }) => {
  const errors = await boot(page);
  const t = await touchRig(page);
  await page.evaluate(() => window.__blast.cheat.idle(125));
  await page.waitForFunction(() => window.__blast.state().countdownOn === true,
                             null, { timeout: 5000 });
  // A short hold rather than a tap: the clock samples once per frame and a
  // held action is the unambiguous "somebody is there".
  await t.drag(1, [120, 200], [160, 200]);
  await page.waitForFunction(() => window.__blast.state().countdownOn === false,
                             null, { timeout: 5000 });
  expect((await st(page)).idleT).toBeLessThan(2);
  await t.endAll();
  expect(errors).toEqual([]);
});

test('end screen: the share band takes a tap, anywhere else is very again', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/?test&wow');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });
  const t = await touchRig(page);
  await page.evaluate(() => window.__blast.cheat.pit());
  await page.waitForFunction(() => window.__blast.state().scene === 'wowend', null, { timeout: 15000 });
  await page.waitForTimeout(800);               // the screen arms taps after 0.5s
  await t.tap(320, 311);                        // the share line's band
  // Headless clipboard grants are a lottery — ok OR fail both prove the tap
  // reached the share flow (idle would mean it never landed).
  await page.waitForFunction(() => {
    const s = window.__blast.state().shareStatus;
    return s === 'ok' || s === 'fail';
  }, null, { timeout: 5000 });
  await t.tap(320, 120);                        // anywhere else: the primary action
  await page.waitForFunction(() => window.__blast.state().scene === 'title', null, { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('title: a tap anywhere walks the intro and starts the run', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  const t = await touchRig(page);
  // Taps are polled once per frame; bounded retry, same idiom as display.spec.
  for (let i = 0; i < 12 && (await st(page)).scene !== 'play'; i++) {
    await t.tap(320, 180);
    await page.waitForTimeout(250);
  }
  expect((await st(page)).scene).toBe('play');
  expect(errors).toEqual([]);
});
