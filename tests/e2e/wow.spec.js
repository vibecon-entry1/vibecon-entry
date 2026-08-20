import { test, expect } from '@playwright/test';
import { boot, runTape } from './helpers.mjs';

// Plan 4 / T3: WOW ZONE. Three things have to hold end to end — the mode is
// UNLOCKED by finishing the gauntlet and entered with W, a SEED deals the same
// level twice, and a DEATH ends the run into the wowend screen with the score
// banked. The tapes here are deliberately short and un-calibrated: nothing in
// this spec depends on a specific piece of geometry (which is the point of a
// seeded mode), only on progress being reproducible.

// Like helpers.mjs's boot(), but through the '?test&wow' front door — see the
// note in main.js for why the wow e2e skips the title. The seed is pinned so
// two loads of the same URL deal the same 40 chunks.
async function bootWow(page, seed) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:8123/?test&wow&wowseed=${seed}`);
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });
  return errors;
}

test('wow entry: mode, level and HUD are live', async ({ page }) => {
  const errors = await bootWow(page, 123);
  const st = await page.evaluate(() => window.__blast.state());
  expect(st.scene).toBe('play');
  expect(st.mode).toBe('wow');
  expect(st.seed).toBe(123);
  expect(st.hp).toBe(3);
  expect(st.chunkIndex).toBe(0);          // WSTART
  // The zone is dealt out of the same authored chunks as the campaign, so it
  // must be populated — an empty roster would mean the deal silently failed.
  // (seed 123 deals 58 live enemies and 207 coins; the bars are floors, not
  // fingerprints — a different tier roll legitimately moves both.)
  expect(st.enemies).toBeGreaterThan(40);
  expect(st.coins).toBeGreaterThan(100);
  await page.screenshot({ path: 'tests/artifacts/wow-spawn.png' });
  expect(errors).toEqual([]);
});

test('unlock: finishing the gauntlet lights WOW ZONE on the title, W enters it',
  async ({ page }) => {
    const errors = await boot(page);
    // Same cheat route the arc spec uses to reach the win screen. Winning is
    // the ONLY thing that sets wowUnlocked.
    await page.evaluate(() => window.__blast.cheat.warp(21500));
    await runTape(page, [{ f: 0, a: { right: true } }, { f: 200, a: null }], 20000);
    await page.waitForFunction(() => window.__blast.state().bossSpawned === true, null,
                               { timeout: 20000 });
    await page.evaluate(() => window.__blast.cheat.killBoss());
    await page.evaluate(() => window.__blast.cheat.warpPad());
    await runTape(page, [{ f: 0, a: { right: true } }, { f: 90, a: null }], 20000);
    await page.waitForFunction(() => window.__blast.state().scene === 'win', null,
                               { timeout: 20000 });

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('suchblast_v1')));
    expect(saved.wowUnlocked).toBe(true);

    // R off the win screen lands on the title, which now advertises the zone.
    await page.keyboard.press('KeyR', { delay: 30 });
    await page.waitForFunction(() => window.__blast.state().scene === 'title', null,
                               { timeout: 10000 });
    expect((await page.evaluate(() => window.__blast.state())).wowUnlocked).toBe(true);
    await page.screenshot({ path: 'tests/artifacts/wow-title-unlocked.png' });

    // W enters. Bounded retry for the same documented reason arc.spec.js uses
    // one: a press whose keyup lands in the same rAF as its keydown is never
    // observed as an edge, and that DOES bite under full-suite load.
    for (let i = 0; i < 15 &&
         (await page.evaluate(() => window.__blast.state())).scene !== 'play'; i++) {
      await page.keyboard.press('KeyW', { delay: 30 });
      await page.waitForTimeout(60);
    }
    const st = await page.evaluate(() => window.__blast.state());
    expect(st.scene).toBe('play');
    expect(st.mode).toBe('wow');
    expect(st.seed).toBeGreaterThan(0);      // rolled off the clock, not the URL
    expect(errors).toEqual([]);
  });

test('seeded determinism: the same seed replays to the same place', async ({ page }) => {
  // A plain right-hold with periodic hops: enough to cross the starter chunk
  // and a couple of dealt ones, and identical between the two loads.
  const tape = [];
  tape.push({ f: 0, a: { right: true } });
  for (let f = 120; f <= 900; f += 90) {
    tape.push({ f, a: { right: true, down: true, fire: true } });
    tape.push({ f: f + 2, a: { right: true } });
  }
  tape.push({ f: 960, a: null });

  const run = async () => {
    const errors = await bootWow(page, 4242);
    await runTape(page, tape, 30000);
    const st = await page.evaluate(() => window.__blast.state());
    expect(errors).toEqual([]);
    return st;
  };

  const a = await run();
  const b = await run();                 // fresh page load, same seed, same tape
  // This blind tape does NOT survive seed 4242 — it walks into a pit in chunk
  // 2 — which makes it a STRONGER determinism probe than a safe one: the two
  // runs have to agree on where the level put that pit, on every coin picked
  // up on the way, and on the frame the run ended. Both therefore land on
  // wowend, and the comparison is of the finished run.
  expect(a.scene).toBe('wowend');
  expect(b.scene).toBe(a.scene);
  expect(b.chunks).toBe(a.chunks);
  expect(b.finalScore).toBe(a.finalScore);
  expect(b.seed).toBe(a.seed);
  expect(a.chunks).toBeGreaterThan(0);   // the run actually went somewhere

  // ...and a DIFFERENT seed deals a different level. Asserted on the level, not
  // on where the tape ends up: two zones can coincidentally strand the same
  // blind right-hold at the same wall.
  const [namesA, namesB] = await page.evaluate(async () => {
    const m = await import('/game/chunks.js');
    return [m.buildWowZone(4242).chunkNames.join(','), m.buildWowZone(4243).chunkNames.join(',')];
  });
  expect(namesA).not.toBe(namesB);
});

test('death ends the run: pit → wowend, best banked', async ({ page }) => {
  const errors = await bootWow(page, 777);
  // Walk right for a bit so the run has a score and some progress on it, then
  // drop through the floor: in an endless level a pit is the end of the run,
  // not a heart and a walk back (there is nothing to walk back TO).
  const tape = [{ f: 0, a: { right: true } }];
  for (let f = 120; f <= 660; f += 90) {
    tape.push({ f, a: { right: true, down: true, fire: true } });   // hop the gaps
    tape.push({ f: f + 2, a: { right: true } });
  }
  tape.push({ f: 700, a: null });
  await runTape(page, tape, 30000);
  const mid = await page.evaluate(() => window.__blast.state());
  expect(mid.scene).toBe('play');           // survived the walk-in
  expect(mid.deaths).toBe(0);
  expect(mid.score).toBeGreaterThan(0);     // something to bank
  await page.screenshot({ path: 'tests/artifacts/wow-run.png' });

  await page.evaluate(() => window.__blast.cheat.pit());
  await page.waitForFunction(() => window.__blast.state().pstate === 'ded', null,
                             { timeout: 10000 });
  const dead = await page.evaluate(() => window.__blast.state());
  expect(dead.hp).toBe(0);                 // the pit took every heart, not one
  expect(dead.deaths).toBe(0);             // and nothing respawned

  await page.waitForFunction(() => window.__blast.state().scene === 'wowend', null,
                             { timeout: 10000 });
  const st = await page.evaluate(() => window.__blast.state());
  expect(st.seed).toBe(777);
  expect(st.chunks).toBe(mid.maxChunk);
  expect(st.best).toBeGreaterThanOrEqual(st.finalScore);
  await page.screenshot({ path: 'tests/artifacts/wow-end.png' });

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('suchblast_v1')));
  expect(saved.best.wow).toBe(st.best);
  expect(saved.best.gauntlet).toBe(0);     // the one-level best merge left it alone

  await page.keyboard.press('KeyR', { delay: 30 });
  await page.waitForFunction(() => window.__blast.state().scene === 'title', null,
                             { timeout: 10000 });
  expect(errors).toEqual([]);
});
