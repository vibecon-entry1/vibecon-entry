import { test, expect } from '@playwright/test';

// The music specs deliberately do NOT assert playback. Headless Chromium's
// autoplay policy, media pipeline and codec availability are all environment
// dependent, so "did a note come out" is a coin flip in CI. What IS stable, and
// what the streaming design actually promises, is:
//   - a boot with no user gesture fetches ZERO mp3 bytes (preload='none' plus
//     the autoplay gate), so 27MB of music costs the suite nothing;
//   - blocked play() promises never reach the console (the whole suite asserts
//     an empty console, and this is the normal path);
//   - a gesture at most starts ONE track, never a pool.
// Like boot.spec.js's first test, these use the plain '/' front door — that's
// the only entry that builds a live jukebox (?test builds a silent one so the
// tape-driven specs don't stream a run track on every synthetic keypress).

/** Request URLs for actual audio media, ignoring the tiny manifest.json. */
function audioTracker(page) {
  const mp3 = [], any = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.includes('/assets/audio/')) return;
    any.push(u);
    if (u.endsWith('.mp3')) mp3.push(u);
  });
  return { mp3, any };
}

test('boot with no gesture: jukebox armed, zero mp3 bytes fetched, clean console', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const req = audioTracker(page);

  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  // Give the manifest fetch and any stray media load a real window to happen in.
  await page.waitForFunction(() => window.__blast?.jukebox.current().ready === true,
                             null, { timeout: 10000 });
  await page.waitForTimeout(500);

  const st = await page.evaluate(() => window.__blast?.jukebox.current());
  expect(st.inert).toBe(false);          // live jukebox, manifest loaded
  expect(st.unlocked).toBe(false);       // no gesture yet
  expect(st.pending).toBe('title');      // title scene's intent is recorded...
  expect(st.pool).toBe(null);            // ...but nothing is playing
  expect(req.mp3).toEqual([]);           // THE guard: no music bytes before a gesture
  expect(req.any).toEqual([`http://localhost:8123/assets/audio/manifest.json`]);
  expect(errors).toEqual([]);
});

test('first keypress unlocks the jukebox: one track at most, still no errors', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const req = audioTracker(page);

  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.jukebox.current().ready === true,
                             null, { timeout: 15000 });
  const before = await page.evaluate(() => window.__blast.state());

  await page.keyboard.press('KeyX', { delay: 30 });
  await page.waitForFunction(() => window.__blast?.jukebox.current().unlocked === true,
                             null, { timeout: 5000 });
  await page.waitForTimeout(500);

  const st = await page.evaluate(() => window.__blast?.jukebox.current());
  expect(st.unlocked).toBe(true);
  expect(st.pool).toBe('title');
  expect(st.index).toBeGreaterThanOrEqual(0);
  expect(st.track).toMatch(/^title-\d\.mp3$/);
  // One selected track streams — never the pool. (Zero is also acceptable: a
  // headless build with no mp3 decoder may reject play() before any fetch.)
  expect(req.mp3.length).toBeLessThanOrEqual(1);
  // The rest of the game is untouched by audio: X still walked the intro.
  const after = await page.evaluate(() => window.__blast.state());
  expect(before.phase).toBe('title');
  expect(after.scene).toBe('title');
  expect(after.phase).toBe('intro0');
  expect(errors).toEqual([]);
});

test('mute persists across a reload, and the pool re-rolls its first track', async ({ page }) => {
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.jukebox.current().ready === true,
                             null, { timeout: 15000 });
  await page.keyboard.press('KeyX', { delay: 30 });     // unlock + start the title pool
  await page.waitForFunction(() => window.__blast?.jukebox.current().pool === 'title',
                             null, { timeout: 5000 });
  const first = await page.evaluate(() => window.__blast?.jukebox.current().index);

  await page.keyboard.press('KeyM', { delay: 30 });
  await page.waitForFunction(() => window.__blast?.jukebox.current().muted === true,
                             null, { timeout: 5000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('suchblast_v1')).audio);
  expect(saved.muted).toBe(true);
  expect(saved.lastFirst.title).toBe(first);

  await page.reload();
  await page.waitForFunction(() => window.__blast?.jukebox.current().ready === true,
                             null, { timeout: 15000 });
  expect(await page.evaluate(() => window.__blast?.jukebox.current().muted)).toBe(true);
  await page.keyboard.press('KeyX', { delay: 30 });
  await page.waitForFunction(() => window.__blast?.jukebox.current().pool === 'title',
                             null, { timeout: 5000 });
  // Rule 2: a new session never opens on the track the last one opened with.
  expect(await page.evaluate(() => window.__blast?.jukebox.current().index)).not.toBe(first);
});

test('?test boot builds a silent jukebox and never touches the audio dir', async ({ page }) => {
  const req = audioTracker(page);
  await page.goto('http://localhost:8123/?test');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.keyboard.press('KeyX', { delay: 30 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__blast?.jukebox.current().inert)).toBe(true);
  expect(req.any).toEqual([]);            // not even the manifest
});
