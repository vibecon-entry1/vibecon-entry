import { test, expect } from '@playwright/test';
import { P } from '../../web/game/physics.js';

// Tapes are frame-indexed STATE CHANGES: an entry's actions hold until the next
// entry; end every tape with an { a: null } release. Same-frame entries collapse.

async function boot(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });
  return errors;
}

async function runTape(page, tape, doneMs = 15000) {
  await page.evaluate(t => {
    const base = window.__blast.frame;
    window.__blast.playTape(t.map(e => ({ f: base + e.f, a: e.a })));
  }, tape);
  await page.waitForFunction(() => window.__blast.tapeDone(), null, { timeout: doneMs });
}

test('walks right under tape control', async ({ page }) => {
  const errors = await boot(page);
  const x0 = (await page.evaluate(() => window.__blast.state())).x;
  await runTape(page, [{ f: 0, a: { right: true } }, { f: 60, a: null }]);
  const x1 = (await page.evaluate(() => window.__blast.state())).x;
  expect(x1 - x0).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('grounded down-shot hop is free; air boosts spend and landing refills', async ({ page }) => {
  const errors = await boot(page);
  await runTape(page, [{ f: 0, a: { down: true, fire: true } }, { f: 3, a: null }]);
  let st = await page.evaluate(() => window.__blast.state());
  expect(st.charges).toBe(3);                     // grounded hop is free
  await page.screenshot({ path: 'tests/artifacts/verb-hop.png' });
  const tape = [
    { f: 0, a: { down: true, fire: true } }, { f: 3, a: null },       // hop
    { f: 12, a: { down: true, fire: true } }, { f: 15, a: null },     // boost 1
    { f: 24, a: { down: true, fire: true } }, { f: 27, a: null },     // boost 2
    { f: 36, a: { down: true, fire: true } }, { f: 39, a: null },     // boost 3
  ];
  await runTape(page, tape);
  st = await page.evaluate(() => window.__blast.state());
  expect(st.charges).toBe(0);
  await page.screenshot({ path: 'tests/artifacts/verb-boost-chain.png' });
  await page.waitForFunction(() => window.__blast.state().charges === 3, null, { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('slide-fire burst accelerates past run speed', async ({ page }) => {
  const errors = await boot(page);
  // down is RELEASED on the fire frames: with down held a ground-shot hops out
  // of the slide instead (see the slide-hop test below). The slide survives the
  // release inside the SLIDE_MIN window, so both shots land as bursts.
  const tape = [
    { f: 0, a: { right: true } },
    { f: 25, a: { right: true, down: true } },                        // slide
    { f: 29, a: { right: true, fire: true } },                        // burst 1
    { f: 31, a: { right: true } },
    { f: 38, a: { right: true, fire: true } },                        // burst 2 → BURST_MAX
    { f: 40, a: { right: true } },
    { f: 46, a: null },
  ];
  await page.evaluate(t => {
    const base = window.__blast.frame;
    window.__blast.playTape(t.map(e => ({ f: base + e.f, a: e.a })));
  }, tape);
  // latch the burst peak while it is live; SLIDE_SPEED alone can never reach it
  await page.waitForFunction(() => Math.abs(window.__blast.state().vx) > 300,
                             null, { timeout: 10000 });
  await page.screenshot({ path: 'tests/artifacts/verb-burst.png' });
  await page.waitForFunction(() => window.__blast.tapeDone(), null, { timeout: 15000 });
  const st = await page.evaluate(() => window.__blast.state());
  expect(Math.abs(st.vx)).toBeGreaterThan(P.RUN);
  expect(st.deaths).toBe(0);
  expect(errors).toEqual([]);
});

test('slide-hop: down+fire with direction held hops instead of bursting', async ({ page }) => {
  const errors = await boot(page);
  // The human gesture that used to be fatal: hold right THROUGH a down+fire tap.
  // Movement resolves before fire, so the frame reads as a slide — the ground
  // shot must still win and hop, or the first gap is unclearable at speed.
  const x0 = (await page.evaluate(() => window.__blast.state())).x;
  await runTape(page, [
    { f: 0, a: { right: true } },
    { f: 55, a: { right: true, down: true, fire: true } },
    { f: 58, a: { right: true } },
    { f: 120, a: null },
  ]);
  const st = await page.evaluate(() => window.__blast.state());
  await page.screenshot({ path: 'tests/artifacts/verb-slide-hop.png' });
  expect(x0).toBeLessThan(260);                   // the gap really was ahead of us
  expect(st.x).toBeGreaterThan(260);              // cleared gap 1 without releasing right
  expect(st.deaths).toBe(0);
  expect(st.charges).toBe(3);                     // the hop was free
  expect(errors).toEqual([]);
});

test('full gauntlet tape makes real progress', async ({ page }) => {
  const errors = await boot(page);
  // Scripted run: cross the hop gap and the boost gap at minimum. Calibrated
  // against the real GB1 physics (see calibration notes below); keep the
  // assertions.
  //
  // Shape note: the grounded hops below fire on a frame with `right` OFF, then
  // re-press right one frame later. That is no longer *required* — the ground
  // shot now beats slide-fire, so holding right through the tap gives a
  // slide-hop (covered by the slide-hop test above) — but a standing hop and a
  // slide-hop carry different speed, and these frame numbers are calibrated
  // against the standing one. Airborne down+fire rides on top of `right`.

  // Frame numbers assume P as of this commit (HOP_VY -290, BOOST_VY -320, RUN 150,
  // RUN_ACCEL 1400, GRAV 900, FIRE_CD 0.12). Retune by iterating against the live
  // sim after any feel-gate change — arithmetic won't get you there.
  const tape = [];
  const at = (f, a) => tape.push({ f, a });
  at(0, { right: true });
  at(56, { down: true, fire: true }); at(57, { right: true });                        // free grounded hop over the small gap (~96px arc clears the 48px gap)
  at(176, { down: true, fire: true }); at(177, { right: true });                      // free grounded hop off the boost-gap ledge
  at(209, { right: true, down: true, fire: true }); at(210, { right: true });         // boost 1, timed near the hop's natural apex-to-fall point
  at(230, { right: true, down: true, fire: true }); at(231, { right: true });         // boost 2, well past boost 1's fire cooldown
  at(400, null);
  await runTape(page, tape, 30000);
  const st = await page.evaluate(() => window.__blast.state());
  await page.screenshot({ path: 'tests/artifacts/verb-gauntlet-progress.png' });
  expect(st.x).toBeGreaterThan(672);              // landed beyond the boost gap
  expect(st.deaths).toBe(0);                      // without dying
  expect(errors).toEqual([]);
});
