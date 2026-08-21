import { test, expect } from '@playwright/test';
import { boot, runTape } from './helpers.mjs';

// Plan 4 / T4: sharing a run. Both end screens have to do the same thing when S
// is pressed — put a link to THIS run on the clipboard and say so on screen.
//
// CLIPBOARD IN HEADLESS, decided by trying it: chromium honours
// context.grantPermissions(['clipboard-read','clipboard-write']) and
// navigator.clipboard.readText() then returns what the game wrote, so these
// specs assert on the REAL clipboard — that is the thing a player experiences,
// and a state hook that agreed with itself would prove nothing. The game's own
// belief (state().shareUrl/shareStatus) is asserted too, so a future browser
// that stops granting the read permission degrades to a still-meaningful test
// instead of a silent pass. The copy is LINK-ONLY by design (user bug report:
// an attached image/png made chat apps paste the picture and drop the link,
// starving the unfurl worker) — so these specs assert the clipboard holds the
// bare URL and that NO image representation rides along with it.
//
// KeyS is the 'down' action (engine/input.js). Nothing on these screens reads
// 'down', which is why the prompt can say "press S" — see shareui.js.

const WORKER = 'https://sb-share.vibecon-entry.workers.dev/';

// The URL is an opaque signed token: ?r=base64url("s.k.d.m.SIG") — share.js.
// Signing is async — the scene builds with a readable placeholder and the ?r=
// form lands a beat later — so specs wait for it before comparing URLs.
// localhost is a secure context, so crypto.subtle exists here and the signed
// token is the shape a player actually copies. The specs decode the token
// (it's obfuscation, not secrecy) to assert the run really rides inside it.
const SIG = /\?r=[A-Za-z0-9_-]+$/;
const waitForSig = (page) =>
  page.waitForFunction(() => /\?r=[A-Za-z0-9_-]+$/.test(window.__blast.state().shareUrl),
                       null, { timeout: 5000 });
/** "s.k.d.m.SIG" out of a share URL. */
const decodeTok = (url) =>
  Buffer.from(url.split('?r=')[1], 'base64url').toString();

async function grantClipboard(context) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'],
                                 { origin: 'http://localhost:8123' });
}

/** Press S until the share prompt reports a finished copy. Same bounded-retry
 *  idiom as the other specs: a press whose keyup lands in the same rAF as its
 *  keydown is never observed as an edge. */
async function pressShare(page) {
  for (let i = 0; i < 15; i++) {
    const st = await page.evaluate(() => window.__blast.state());
    if (st.shareStatus === 'ok' || st.shareStatus === 'fail') return st.shareStatus;
    await page.keyboard.press('KeyS', { delay: 30 });
    await page.waitForTimeout(80);
  }
  return (await page.evaluate(() => window.__blast.state())).shareStatus;
}

test('win screen: S copies this run to the clipboard', async ({ page, context }) => {
  await grantClipboard(context);
  const errors = await boot(page);

  // Same cheat route to the win screen the wow spec's unlock test uses.
  await page.evaluate(() => window.__blast.cheat.warp(21500));
  await runTape(page, [{ f: 0, a: { right: true } }, { f: 200, a: null }], 20000);
  await page.waitForFunction(() => window.__blast.state().bossSpawned === true, null,
                             { timeout: 20000 });
  await page.evaluate(() => window.__blast.cheat.killBoss());
  await page.evaluate(() => window.__blast.cheat.warpPad());
  await runTape(page, [{ f: 0, a: { right: true } }, { f: 90, a: null }], 20000);
  await page.waitForFunction(() => window.__blast.state().scene === 'win', null,
                             { timeout: 20000 });

  await waitForSig(page);
  const before = await page.evaluate(() => window.__blast.state());
  expect(before.shareStatus).toBe('idle');
  expect(before.shareUrl).toContain(WORKER);
  expect(before.shareUrl).toMatch(SIG);              // the opaque signed token
  const tok = decodeTok(before.shareUrl).split('.');
  expect(tok[0]).toBe(String(before.finalScore));    // the score rides IN the token
  expect(tok[3]).toBe('g');                          // gauntlet
  expect(tok[4]).toMatch(/^[0-9a-f]{10}$/);          // signed, not the "0" fallback

  expect(await pressShare(page)).toBe('ok');

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(WORKER);
  expect(clip).toMatch(SIG);
  expect(decodeTok(clip).startsWith(`${before.finalScore}.`)).toBe(true);
  expect(clip).toBe(before.shareUrl);                // the bare link, nothing else
  // ...and no image representation on the clipboard beside it: an image is
  // exactly what made chat apps drop the link.
  const kinds = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return items.flatMap(i => [...i.types]);
  });
  expect(kinds).not.toContain('image/png');

  // The confirmation is on screen for three seconds — screenshot it while it is.
  const st = await page.evaluate(() => window.__blast.state());
  expect(st.shareStatus).toBe('ok');
  await page.screenshot({ path: 'tests/artifacts/share-win.png' });
  expect(errors).toEqual([]);
});

test('wowend: S copies the zone run, mode and all', async ({ page, context }) => {
  await grantClipboard(context);
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/?test&wow&wowseed=777');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null,
                             { timeout: 15000 });

  await runTape(page, [{ f: 0, a: { right: true } }, { f: 240, a: null }], 20000);
  await page.evaluate(() => window.__blast.cheat.pit());
  await page.waitForFunction(() => window.__blast.state().scene === 'wowend', null,
                             { timeout: 15000 });

  await waitForSig(page);
  const before = await page.evaluate(() => window.__blast.state());
  expect(before.shareUrl).toMatch(SIG);
  const tok = decodeTok(before.shareUrl).split('.');
  expect(tok[3]).toBe('w');                          // the zone, not the gauntlet
  expect(tok[2]).toBe('1');                          // the death that ended it

  expect(await pressShare(page)).toBe('ok');

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(WORKER);
  expect(clip).toMatch(SIG);
  expect(decodeTok(clip).startsWith(`${before.finalScore}.`)).toBe(true);
  expect(clip).toBe(before.shareUrl);
  await page.screenshot({ path: 'tests/artifacts/share-wowend.png' });
  expect(errors).toEqual([]);
});

test('no clipboard: the URL goes on screen instead', async ({ page, context }) => {
  // No grantPermissions here, and the clipboard is shot out from under the page
  // before it boots — the state a player hits on a browser that refuses the
  // write. The share must degrade to "read it off the screen", not to nothing.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    // The last-ditch copy path is a native prompt(), which is the only
    // pre-selected text box every browser has without a clipboard API. Stubbed
    // rather than dialog-handled: the real one BLOCKS the page, and what this
    // asserts is the argument, not the dialog.
    window.__prompts = [];
    window.prompt = (...a) => { window.__prompts.push(a); return null; };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/?test&wow&wowseed=777');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.evaluate(() => window.__blast.cheat.pit());
  await page.waitForFunction(() => window.__blast.state().scene === 'wowend', null,
                             { timeout: 15000 });

  await waitForSig(page);   // sig lands before any press, so prompt === state url
  expect(await pressShare(page)).toBe('fail');
  const st = await page.evaluate(() => window.__blast.state());
  await page.waitForFunction(() => window.__prompts.length > 0, null, { timeout: 5000 });
  const calls = await page.evaluate(() => window.__prompts);
  expect(calls).toHaveLength(1);                     // once per press, not per frame
  expect(calls[0][0]).toBe('very manual. copy this:');
  expect(calls[0][1]).toBe(st.shareUrl);             // the SAME url the screen shows
  await page.screenshot({ path: 'tests/artifacts/share-fallback.png' });
  expect(errors).toEqual([]);
});
