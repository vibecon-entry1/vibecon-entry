import { test, expect } from '@playwright/test';
import { boot, runTape } from './helpers.mjs';

// Branding pass: the alpha-VP9 stickers and the on-screen sound button.
//
// These use the plain '/' front door, not '?test'. The stickers live on the
// title and win scenes (which '?test' skips past), and the sound button reads a
// LIVE jukebox — '?test' builds a silent one, so a mute toggle there would be
// asserting against an inert object.
//
// What is deliberately NOT asserted: pixels. Whether headless Chromium's VP9
// decoder has produced a frame by the time we look is a timing coin flip, and a
// screenshot diff of a 24fps looping video is not a stable test. What IS stable
// is the contract the sticker module actually makes — no console noise, a
// bounded number of decoders, and no interference with the audio guarantees.

async function bootTitle(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  return errors;
}

test('stickers: title boots clean with the brand art present', async ({ page }) => {
  const errors = await bootTitle(page);
  // Give the media pipeline a real window to fetch, decode and fail in.
  await page.waitForTimeout(1200);

  const st = await page.evaluate(() => window.__blast.stickers());
  // Headless Chromium ships a VP9 decoder, so this should hold here. It is the
  // one environment assumption in the file, and it's the reason the rest of the
  // assertions are meaningful rather than vacuously true on a no-codec build.
  expect(st.supported).toBe(true);
  // Exactly ONE decoder on the title scene: RocketRide. The cap is the point —
  // an uncached getSticker() would grow this on every scene bounce.
  expect(st.count).toBe(1);
  expect(st.urls).toEqual(['assets/brand/rocketride.webm']);
  expect(st.count).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('stickers: the win scene adds at most one more decoder', async ({ page }) => {
  // This one DOES use '?test' — reaching the win screen needs the boss/pad
  // cheats, which are gated on it. That costs a live jukebox, but this test is
  // about decoder counts, not audio. It also gives the cleanest possible
  // reading: '?test' opens straight into play, which has no stickers, so any
  // decoder that exists afterwards was opened by the win scene itself.
  const errors = await boot(page);
  expect(await page.evaluate(() => window.__blast.stickers().count)).toBe(0);

  await page.evaluate(() => window.__blast.cheat.warp(21500));   // see arc.spec.js
  await runTape(page, [{ f: 0, a: { right: true } }, { f: 200, a: null }], 20000);
  await page.waitForFunction(() => window.__blast.state().bossSpawned === true, null, { timeout: 20000 });
  await page.evaluate(() => window.__blast.cheat.killBoss());
  await page.evaluate(() => window.__blast.cheat.warpPad());
  await runTape(page, [{ f: 0, a: { right: true } }, { f: 90, a: null }], 20000);
  await page.waitForFunction(() => window.__blast.state().scene === 'win', null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const st = await page.evaluate(() => window.__blast.stickers());
  expect(st.count).toBe(1);                              // exactly the one that was rolled
  expect(st.count).toBeLessThanOrEqual(2);
  const picked = (await page.evaluate(() => window.__blast.state())).sticker;
  expect(['wagmi', 'popper', 'rocketride']).toContain(picked);
  expect(st.urls).toEqual([`assets/brand/${picked}.webm`]);
  expect(errors).toEqual([]);
});

test('sound button: a click on the icon toggles mute', async ({ page }) => {
  const errors = await bootTitle(page);

  // Click-mapping check, spelled out because it is the one piece of geometry in
  // the build that has to survive letterboxing:
  //   viewport 1280x720 -> scale = floor(min(1280/640, 720/360)) = 2
  //   canvas is exactly 1280x720, so `margin:auto` leaves ZERO letterbox here
  //   button rect (virtual) = x 615..637, y 3..23  ->  client 1230..1274, 6..46
  // Aim at the middle: virtual (626, 13) -> client (1252, 26).
  expect(await page.evaluate(() => window.__blast.jukebox.current().muted)).toBe(false);

  await page.mouse.click(1252, 26);
  await page.waitForFunction(() => window.__blast.jukebox.current().muted === true,
                             null, { timeout: 5000 });

  // ...and back. Proves it is a toggle, not a one-way latch, and that the
  // first-click-also-unlocks path (pointerdown fires unlock() before this
  // handler sees the click) left the mute state consistent.
  expect(await page.evaluate(() => window.__blast.jukebox.current().unlocked)).toBe(true);
  await page.mouse.click(1252, 26);
  await page.waitForFunction(() => window.__blast.jukebox.current().muted === false,
                             null, { timeout: 5000 });

  // Mute is persisted, same as the M key's path.
  await page.mouse.click(1252, 26);
  await page.waitForFunction(() => window.__blast.jukebox.current().muted === true,
                             null, { timeout: 5000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('suchblast_v1')).audio);
  expect(saved.muted).toBe(true);

  expect(errors).toEqual([]);
});

test('sound button: a click OUTSIDE the icon does not toggle', async ({ page }) => {
  const errors = await bootTitle(page);
  // Just left of the plate (virtual x=600 -> client 1200) and dead centre.
  await page.mouse.click(1200, 26);
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__blast.jukebox.current().muted)).toBe(false);
  expect(errors).toEqual([]);
});

test('stickers cost the audio guarantees nothing: ?test still fetches zero audio', async ({ page }) => {
  const any = [];
  page.on('request', r => { if (r.url().includes('/assets/audio/')) any.push(r.url()); });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto('http://localhost:8123/?test');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.waitForTimeout(800);

  expect(any).toEqual([]);                                  // not even the manifest
  // ?test boots straight into play, which has no stickers — so no decoder is
  // opened at all. The brand art is strictly a title/win affordance.
  expect(await page.evaluate(() => window.__blast.stickers().count)).toBe(0);
  expect(errors).toEqual([]);
});
