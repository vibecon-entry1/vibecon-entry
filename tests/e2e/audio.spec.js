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

  // Hold-until-observed, not a single timed press: input.js resolves `pressed`
  // as held && !prev, sampled once per animation frame, so a keydown+keyup that
  // both fall between two frames is dropped entirely under load (see toggleMute
  // below, whose pattern this mirrors).
  await page.keyboard.down('KeyM');
  await page.waitForFunction(() => window.__blast?.jukebox.current().muted === true,
                             null, { timeout: 10000 });
  await page.keyboard.up('KeyM');
  await page.waitForTimeout(50);
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

// --- SFX --------------------------------------------------------------------
// Same doctrine as the music specs above: no assertion that a note came out.
// What IS stable is that an audio DEVICE is never opened — an AudioContext is
// a real hardware resource, and the two rules it must obey (never before a user
// gesture, never at all under ?test) are both observable by counting
// constructions from an init script.
const COUNT_CTX = `
  window.__ctxCount = 0;
  for (const key of ['AudioContext', 'webkitAudioContext']) {
    const Real = window[key];
    if (!Real) continue;
    window[key] = class extends Real { constructor(...a) { super(...a); window.__ctxCount++; } };
  }`;

test('?test boot builds a silent sfx engine and opens ZERO AudioContexts', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(COUNT_CTX);
  await page.goto('http://localhost:8123/?test');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });
  // A real (trusted) gesture that also fires the gun: unlock() runs, and so does
  // a play() — neither may open a device in the silent build.
  await page.keyboard.press('KeyX', { delay: 30 });
  await page.waitForTimeout(200);

  const st = await page.evaluate(() => window.__blast.sfx.current());
  expect(await page.evaluate(() => window.__ctxCount)).toBe(0);
  expect(st.inert).toBe(true);
  expect(st.ready).toBe(false);
  expect(st.master).toBe(null);
  // The engine still records what the GAME asked for, which is what makes the
  // event wiring observable at all without making a sound.
  expect(st.plays).toBeGreaterThan(0);
  expect(st.log).toContain('pew');
  expect(errors).toEqual([]);
});

test('the live front door opens no AudioContext until a user gesture', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(COUNT_CTX);
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__ctxCount)).toBe(0);
  expect(await page.evaluate(() => window.__blast.sfx.current().ready)).toBe(false);

  await page.keyboard.press('KeyX', { delay: 30 });     // title: advances the intro AND clicks
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => window.__blast.sfx.current());
  expect(await page.evaluate(() => window.__ctxCount)).toBe(1);   // exactly one, ever
  expect(st.ready).toBe(true);
  expect(st.master).toBe(0.5);                          // SFX sit UNDER the music
  expect(st.log).toEqual(['uiclick']);
  expect(errors).toEqual([]);
});

/**
 * Toggle mute and wait for it to land. keyboard.press() with a short delay is
 * NOT safe here: input.js resolves `pressed` as held && !prev, sampled once per
 * animation frame, so a keydown+keyup that both fall between two frames is
 * dropped entirely. Under a full-suite run frames can be well over 30ms apart.
 * Holding the key until the toggle is observed is immune to that, and holding
 * cannot double-toggle — the edge only fires once.
 */
async function toggleMute(page, want) {
  await page.keyboard.down('KeyM');
  await page.waitForFunction(w => window.__blast.sfx.current().muted === w, want, { timeout: 10000 });
  await page.keyboard.up('KeyM');
  await page.waitForTimeout(50);
}

test('M is ONE switch: it mutes the music and the sfx together, and persists', async ({ page }) => {
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.keyboard.press('KeyX', { delay: 30 });     // gesture: builds the context
  await page.waitForFunction(() => window.__blast.sfx.current().ready === true, null, { timeout: 5000 });

  await toggleMute(page, true);
  // Muted is a HARD zero on the master gain node, not a volume the mix can leak.
  expect(await page.evaluate(() => window.__blast.sfx.current().master)).toBe(0);
  expect(await page.evaluate(() => window.__blast.jukebox.current().muted)).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suchblast_v1')).audio.muted)).toBe(true);

  await toggleMute(page, false);
  expect(await page.evaluate(() => window.__blast.sfx.current().master)).toBe(0.5);
  expect(await page.evaluate(() => window.__blast.jukebox.current().muted)).toBe(false);

  // And the flag survives a reload — one persisted flag drives both engines.
  await toggleMute(page, true);
  await page.reload();
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  expect(await page.evaluate(() => window.__blast.sfx.current().muted)).toBe(true);
});
