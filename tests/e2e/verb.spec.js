import { test, expect } from '@playwright/test';
import { P } from '../../web/game/physics.js';
import { boot, runTape } from './helpers.mjs';

// Tapes are frame-indexed STATE CHANGES: an entry's actions hold until the next
// entry; end every tape with an { a: null } release. Same-frame entries collapse.

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
  // The CHORD: down + right + X, and down is NEVER released. X is tapped ~20
  // frames into the slide, well past the 0.12s (8-frame) fresh window that
  // would otherwise hop. Two taps chain toward BURST_MAX; the pose stays seated.
  const tape = [
    { f: 0, a: { right: true } },
    { f: 25, a: { right: true, down: true } },                        // slide
    { f: 45, a: { right: true, down: true, fire: true } },            // burst 1 (20f in)
    { f: 47, a: { right: true, down: true } },
    { f: 54, a: { right: true, down: true, fire: true } },            // burst 2 → BURST_MAX
    { f: 56, a: { right: true, down: true } },
    { f: 64, a: null },
  ];
  await page.evaluate(t => {
    const base = window.__blast.frame;
    window.__blast.playTape(t.map(e => ({ f: base + e.f, a: e.a })));
  }, tape);
  // latch the burst peak while it is live; SLIDE_SPEED alone can never reach it
  await page.waitForFunction(() => Math.abs(window.__blast.state().vx) > 300,
                             null, { timeout: 10000 });
  const peak = await page.evaluate(() => window.__blast.state());
  expect(peak.pstate).toBe('slide');               // burst stays seated, down still held
  await page.screenshot({ path: 'tests/artifacts/verb-burst.png' });
  await page.waitForFunction(() => window.__blast.tapeDone(), null, { timeout: 15000 });
  const st = await page.evaluate(() => window.__blast.state());
  expect(Math.abs(st.vx)).toBeGreaterThan(P.RUN);
  expect(st.deaths).toBe(0);
  expect(errors).toEqual([]);
});

test('slide-hop: down+fire in the fresh-slide window hops instead of bursting', async ({ page }) => {
  const errors = await boot(page);
  // The running pit-saver: hold right THROUGH a down+fire tap. down and fire
  // land on the SAME frame, so the slide is 0s old — inside the 0.12s fresh
  // window the ground shot still wins and hops, or no gap is clearable at speed.
  const x0 = (await page.evaluate(() => window.__blast.state())).x;
  await runTape(page, [
    { f: 0, a: { right: true } },
    { f: 55, a: { right: true, down: true, fire: true } },
    { f: 58, a: { right: true } },
    { f: 120, a: null },
  ]);
  const st = await page.evaluate(() => window.__blast.state());
  await page.screenshot({ path: 'tests/artifacts/verb-slide-hop.png' });
  expect(x0).toBeLessThan(260);                   // we really did start back here
  expect(st.x).toBeGreaterThan(260);              // hopped and kept running, right never released
  expect(st.deaths).toBe(0);
  expect(st.charges).toBe(3);                     // the hop was free
  expect(errors).toEqual([]);
});

test('full gauntlet tape makes real progress', async ({ page }) => {
  const errors = await boot(page);
  // Scripted run over the REAL level (GAUNTLET): sprint C1's 48-tile runway,
  // then clear both of C2's hop pits (3-wide at tx66, 4-wide at tx84) with free
  // grounded ground-shots. Landing past the second pit puts us in C3.
  //
  // Shape note: the grounded hops below fire on a frame with `right` OFF, then
  // re-press right one frame later. That is no longer *required* — the ground
  // shot beats slide-fire, so holding right through the tap gives a slide-hop
  // (covered by the slide-hop test above) — but a standing hop and a slide-hop
  // carry different speed, and these frame numbers are calibrated against the
  // standing one.
  //
  // Frame numbers assume P as of this commit (HOP_VY -290, BOOST_VY -320, RUN 150,
  // RUN_ACCEL 1400, GRAV 900, FIRE_CD 0.12) and GAUNTLET's C1/C2 geometry. Each
  // hop frame sits mid-window of a ~19-frame band that clears its pit; retune by
  // iterating against the live sim after any feel-gate or chunk change —
  // arithmetic won't get you there.
  const tape = [];
  const at = (f, a) => tape.push({ f, a });
  at(0, { right: true });
  at(390, { down: true, fire: true }); at(391, { right: true });   // hop C2 pit 1 (48px)
  at(515, { down: true, fire: true }); at(516, { right: true });   // hop C2 pit 2 (64px)
  at(635, null);
  await runTape(page, tape, 30000);
  const st = await page.evaluate(() => window.__blast.state());
  await page.screenshot({ path: 'tests/artifacts/verb-gauntlet-progress.png' });
  expect(st.x).toBeGreaterThan(48 * 16);          // past C1's runway, into C2
  expect(st.deaths).toBe(0);                      // without dying
  expect(st.score).toBeGreaterThan(0);            // coins along the way actually scored
  expect(errors).toEqual([]);
});

// --- the HUMAN path -------------------------------------------------------
// Everything above drives the sim through the input tape, which is a virtual
// action source: it sets whole action SETS on chosen frames and holds them
// until the next entry. That can never reproduce the one thing a real player
// does — press a key for a handful of milliseconds that the fixed-step loop
// may or may not be looking at. The three tests below use real keyboard
// events at real cadence instead, and they are the only place that bug class
// can be caught.

/** Hold a key for `ms` of wall clock, the way a thumb does. */
async function tap(page, key, ms = 60) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Run right, then sit into a slide and let it establish past the 0.12s gate. */
async function slideIn(page) {
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(250);
}

test('real keyboard: the slide chord still bursts at human cadence', async ({ page }) => {
  const errors = await boot(page);
  await slideIn(page);
  const before = await page.evaluate(() => window.__blast.state());
  expect(before.pstate).toBe('slide');
  // No trailing gap after the last tap: SLIDE_DECAY starts eating the burst the
  // very next frame, so the peak has to be read while it is still standing.
  for (let i = 0; i < 3; i++) { if (i) await page.waitForTimeout(150); await tap(page, 'KeyX', 60); }
  const st = await page.evaluate(() => window.__blast.state());
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('ArrowRight');
  expect(st.pstate).toBe('slide');                 // the chord stays seated
  expect(st.shots - before.shots).toBe(3);         // every tap left the barrel
  expect(Math.abs(st.vx)).toBeGreaterThan(P.BURST_MAX - 60);   // climbed to the cap
  expect(errors).toEqual([]);
});

test('real keyboard: a tap that lands inside a world stall is not eaten', async ({ page }) => {
  const errors = await boot(page);
  await slideIn(page);
  // The stall a mid-chain kill causes is 0.05s — three frames, too narrow to
  // place a keystroke inside from out here. cheat.stall() opens the SAME window
  // (it sets the same hitstop) wide enough to tap squarely into the middle of
  // it, which is the only way to make this deterministic rather than a race.
  const before = await page.evaluate(() => window.__blast.state());
  await page.evaluate(() => window.__blast.cheat.stall(0.3));
  await page.waitForTimeout(60);
  expect((await page.evaluate(() => window.__blast.state())).hitstop).toBeGreaterThan(0);
  await tap(page, 'KeyX', 40);                     // pressed AND released while frozen
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => window.__blast.state());
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('ArrowRight');
  expect(st.shots - before.shots).toBe(1);         // the bolt came out after the thaw
  expect(st.vx).toBeGreaterThan(before.vx);        // ...and it was a BURST, decay and all
  expect(errors).toEqual([]);
});

test('real keyboard: taps keep bursting through a kill mid-chain', async ({ page }) => {
  const errors = await boot(page);
  // Parked just past a hopper: the chord's bolt flies BACKWARD, so the thing
  // that dies mid-chain is the one you just slid past. Its death stalls the
  // world for 0.05s, right on top of the next tap.
  await page.evaluate(() => window.__blast.cheat.warp(2000));
  await slideIn(page);
  const before = await page.evaluate(() => window.__blast.state());
  for (let i = 0; i < 4; i++) { await tap(page, 'KeyX', 40); await page.waitForTimeout(200); }
  const st = await page.evaluate(() => window.__blast.state());
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('ArrowRight');
  await page.screenshot({ path: 'tests/artifacts/verb-burst-human.png' });
  expect(st.score).toBeGreaterThanOrEqual(100);    // something really did die mid-chain
  expect(st.shots - before.shots).toBe(4);         // and no tap was swallowed by the stall
  expect(Math.abs(st.vx)).toBeGreaterThan(P.RUN);
  expect(errors).toEqual([]);
});
