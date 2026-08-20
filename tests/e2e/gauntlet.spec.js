import { test, expect } from '@playwright/test';
import { boot, runTape } from './helpers.mjs';

test('world is populated: enemies, coins render without errors', async ({ page }) => {
  const errors = await boot(page);
  const st = await page.evaluate(() => window.__blast.state());
  expect(st.enemies).toBe(39);   // 17 hoppers + 8 red hoppers + 14 saucers
  expect(st.coins).toBe(151);
  expect(st.hp).toBe(3);
  await page.screenshot({ path: 'tests/artifacts/gauntlet-spawn.png' });
  expect(errors).toEqual([]);
});

test('forward fire kills a hopper; score wiring live', async ({ page }) => {
  const errors = await boot(page);
  // Shared opening: sprint C1, hop both C2 pits (same three hops as verb.spec's
  // "full gauntlet tape", plus a third to clear C2's second pit that test never
  // reaches) — lands us walking into C3 where the first hopper (spawns at
  // x=1832, patrols the whole C3/C4-mouth stretch) is now closing in.
  //
  // Calibrated against the real page (playwright chromium, polling
  // window.__blast.frame/state() every rAF — see the death test below for why
  // the offline node harness isn't trusted for frame numbers tied to a
  // dynamic event): holding `right` the whole way, the hopper and player are
  // on a collision course. Releasing `right` at f850 (an offline-harness
  // number) turned out to let a contact hit land first in the real page —
  // hp dropped to 2 before the kill landed, still passing this test's
  // assertions (they don't check hp) but not the safe standoff the test name
  // promises. Releasing earlier, at f800 (player settles idle at x=2051,
  // ~85px short of hopper1's contact range when the stop happens), reproduced
  // clean across three consecutive real-page runs: hp stays at 3, one bolt
  // lands the kill once the hopper's 30px/s patrol drifts inside forward-bolt
  // range (380px/s * 0.6s life = 228px). enemies 39->38, score 110->210 (a
  // "+100" kill, no airborne WOW bonus since we're grounded).
  const tape = [];
  const at = (f, a) => tape.push({ f, a });
  at(0, { right: true });
  at(390, { down: true, fire: true }); at(391, { right: true });   // free hop, no pit here
  at(515, { down: true, fire: true }); at(516, { right: true });   // clears C2 pit 1 (tx66, 48px)
  at(630, { down: true, fire: true }); at(631, { right: true });   // clears C2 pit 2 (tx84, 64px)
  at(800, { fire: true });                                        // stop; standoff + hold fire
  at(850, null);
  await runTape(page, tape, 20000);
  const st = await page.evaluate(() => window.__blast.state());
  await page.screenshot({ path: 'tests/artifacts/gauntlet-combat.png' });
  expect(st.score).toBeGreaterThanOrEqual(100);
  expect(st.enemies).toBe(38);   // one hopper down
  expect(st.deaths).toBe(0);
  expect(errors).toEqual([]);
});

test('contact hurts once per iframe window; death respawns at checkpoint with full hp', async ({ page }) => {
  const errors = await boot(page);
  // Same opening as the combat test, but this time we never stop: hold `right`
  // straight through. A single-hit-then-retreat tape was tried first (switch
  // to `left` one frame after the offline harness's predicted hit frame, ride
  // out the 1.2s iframe window, assert hp===2 && deaths===0) but it didn't
  // stabilize: the offline node harness (fresh player, tape starts at its
  // literal frame 0, still inside the 'spawn' pose) and the live page (tape
  // starts only after boot()'s wait for pstate 'idle', i.e. already past
  // 'spawn') don't count frames the same way relative to a dynamic event like
  // "when does the hit land" — walk-distance milestones (the hop frames below)
  // happen to transfer fine since they're anchored to absolute progress, but
  // the retreat's timing is anchored to the hit itself, and calibrating that
  // against the real page (playwright chromium, polling
  // window.__blast.frame/state() every rAF) showed the hit landing ~117
  // frames earlier than the harness predicted. By the time the retreat switch
  // fired, the player's still-held `right` had already walked it back into
  // the hopper for a second hit just 2-3 frames after the first iframe window
  // expired — a single-frame margin at 60fps, too tight to trust across runs.
  // Simplifying per the fallback: just ride the whole contact chain out.
  //
  // Calibrated directly against the real page: holding `right` the whole way,
  // contact lands 3 hits (hp 3->2->1->0) between real relF 843 and 918, hp 0
  // flips pstate to 'ded' at relF 993, and the respawn beam-in at C3's
  // checkpoint (x=1576, hp reset to 3, deaths -> 1) lands at relF 1084,
  // holding through 'spawn' until relF ~1202 when it flips back to 'idle' and
  // (since `right` is still held) starts walking into the hopper again for a
  // second death cycle. Releasing input at relF 1150 sits mid-'spawn' with
  // ~66 frames of margin on the near side and ~50 on the far side.
  const tape = [];
  const at = (f, a) => tape.push({ f, a });
  at(0, { right: true });
  at(390, { down: true, fire: true }); at(391, { right: true });
  at(515, { down: true, fire: true }); at(516, { right: true });
  at(630, { down: true, fire: true }); at(631, { right: true });
  at(1150, null);
  await runTape(page, tape, 25000);
  const st = await page.evaluate(() => window.__blast.state());
  await page.screenshot({ path: 'tests/artifacts/gauntlet-respawn.png' });
  expect(st.deaths).toBe(1);
  expect(st.hp).toBe(3);
  expect(errors).toEqual([]);
});

test('respawn economy: a kill\'s points refund on the very next respawn, world resets with it', async ({ page }) => {
  const errors = await boot(page);
  // Identical opening to 'forward fire kills a hopper' above (calibrated
  // there): sprint C1, hop both C2 pits, stop at f800 well short of hopper1's
  // contact range, hold fire. That lands one clean grounded kill (+100, no
  // WOW+ since we never leave the ground) with enemies 39->38.
  const tape = [];
  const at = (f, a) => tape.push({ f, a });
  at(0, { right: true });
  at(390, { down: true, fire: true }); at(391, { right: true });
  at(515, { down: true, fire: true }); at(516, { right: true });
  at(630, { down: true, fire: true }); at(631, { right: true });
  at(800, { fire: true });
  at(850, null);
  await runTape(page, tape, 20000);
  const afterKill = await page.evaluate(() => window.__blast.state());
  expect(afterKill.enemies).toBe(38);
  expect(afterKill.deaths).toBe(0);

  // Now dunk into a pit. hp starts at 3, so this is a SOFT respawn (one heart
  // lost, not a full-hp beam-in) — but the user ruling is every respawn, soft
  // or real, revives the roster and refunds every kill point earned since the
  // last one. score.js's killEarned tracks exactly the +100 this kill banked
  // (no coins were on this route, and the kill itself carried no WOW+ bonus),
  // so the refund should land the score back EXACTLY where it stood before
  // the kill: afterKill.score - 100.
  await page.evaluate(() => window.__blast.cheat.pit());
  await page.waitForFunction(() => window.__blast.state().deaths === 1, null,
                             { timeout: 10000 });
  const st = await page.evaluate(() => window.__blast.state());
  await page.screenshot({ path: 'tests/artifacts/gauntlet-refund.png' });
  expect(st.enemies).toBe(39);              // the whole roster is back, hopper included
  expect(st.score).toBe(afterKill.score - 100);
  expect(st.hp).toBe(2);                    // SOFT respawn: one heart down, not a full heal
  expect(errors).toEqual([]);
});

test('a real death with nothing earned docks the flat 100 and goes negative', async ({ page }) => {
  const errors = await boot(page);
  const start = await page.evaluate(() => window.__blast.state());
  expect(start.score).toBe(0);              // fresh boot, nothing banked yet

  // Two soft pit dunks in place (no movement, no kills, no coins picked up)
  // burn the first two hearts and prove the refund is a genuine no-op when
  // killEarned is already zero — score should not move at all.
  await page.evaluate(() => window.__blast.cheat.pit());
  await page.waitForFunction(() => window.__blast.state().deaths === 1, null,
                             { timeout: 10000 });
  await page.evaluate(() => window.__blast.cheat.pit());
  await page.waitForFunction(() => window.__blast.state().deaths === 2, null,
                             { timeout: 10000 });
  const beforeLast = await page.evaluate(() => window.__blast.state());
  expect(beforeLast.score).toBe(0);
  expect(beforeLast.hp).toBe(1);

  // The third dunk takes the last heart: a real death. dock(100) fires on the
  // 'ded' state edge, and — with the floor removed from score.js's dock() —
  // there is nothing left to clamp it at zero.
  await page.evaluate(() => window.__blast.cheat.pit());
  await page.waitForFunction(() => window.__blast.state().pstate === 'ded', null,
                             { timeout: 10000 });
  await page.waitForFunction(() => window.__blast.state().deaths === 3, null,
                             { timeout: 10000 });
  const st = await page.evaluate(() => window.__blast.state());
  await page.screenshot({ path: 'tests/artifacts/gauntlet-negative-score.png' });
  expect(st.score).toBe(-100);
  expect(st.hp).toBe(3);                    // real death: full-hp respawn
  expect(errors).toEqual([]);
});

test('scenery props are landmarks: each one exists at exactly one place', async ({ page }) => {
  const errors = await boot(page);
  // The parallax bands TILE every 640px, so anything painted into a strip
  // repeats forever. These two props are drawn by the scene instead, once each,
  // and this is the test that keeps them that way: a colour that only that
  // prop's art uses is counted over the whole finished frame at camera
  // positions spread across the level. Exactly one position may see it.
  const counts = await page.evaluate(async (spots) => {
    const SIG = { prop1: [113, 86, 69], prop2: [156, 82, 55] };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const out = [];
    for (const x of spots) {
      window.__blast.cheat.warp(x);
      await sleep(700);                       // let the camera catch up and redraw
      const c = document.getElementById('screen');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const n = { warp: x, prop1: 0, prop2: 0 };
      for (let i = 0; i < d.length; i += 4)
        for (const k in SIG)
          if (d[i] === SIG[k][0] && d[i + 1] === SIG[k][1] && d[i + 2] === SIG[k][2]) n[k]++;
      out.push(n);
    }
    return out;
  }, [1000, 6000, 9020, 12000, 15800, 20000, 23000]);

  for (const k of ['prop1', 'prop2']) {
    const seen = counts.filter(c => c[k] > 0);
    expect(seen.map(c => c.warp), `${k} seen at ${JSON.stringify(seen)}`).toHaveLength(1);
  }
  expect(counts.find(c => c.warp === 9020).prop1).toBeGreaterThan(0);   // mid-run, far band
  expect(counts.find(c => c.warp === 15800).prop2).toBeGreaterThan(0);  // deep, near band
  expect(errors).toEqual([]);
});
