import { test, expect } from '@playwright/test';

// The sound check, end to end on the desktop project. It boots the plain '/'
// front door (not ?test): the way IN is a key sequence on the real title
// screen, and that is precisely the thing under test. The sfx hook still
// reports every play either way.
//
// The sequence detector is a raw keydown listener (main.js), so the keys can
// land back to back; the SCREEN's own navigation is frame-sampled input, so
// those presses get a beat between them — same pacing rule as the touch specs.

const SEQ = ['P', 'I', 'C', 'K', 'T', 'O', 'N', 'E'];

async function bootTitle(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  return errors;
}

async function enterAudition(page) {
  for (const k of SEQ) await page.keyboard.press(k);
  await page.waitForFunction(() => window.__blast.state().scene === 'audition',
                             null, { timeout: 5000 });
}

test('the sequence opens the sound check; a fumbled one does not', async ({ page }) => {
  const errors = await bootTitle(page);
  // Everything but the last key, then a wrong one: still the title, and none
  // of those keys mean anything to the title screen either.
  for (const k of SEQ.slice(0, -1)) await page.keyboard.press(k);
  await page.keyboard.press('Q');
  await page.waitForTimeout(300);
  expect((await page.evaluate(() => window.__blast.state())).scene).toBe('title');
  // A fumble resets cleanly: the full sequence still works right after.
  await enterAudition(page);
  const s = await page.evaluate(() => window.__blast.state());
  expect(s.sound).toBe('pew');                  // cursor parks on the first row
  expect(s.variant).toBe('a');
  expect(errors).toEqual([]);
});

test('a kept pick persists across reload and retunes the next real trigger', async ({ page }) => {
  const errors = await bootTitle(page);
  await enterAudition(page);
  // Walk to the last row (uiclick) and onto candidate B. Frame-sampled: pace
  // the presses, and step by OBSERVED row rather than a fixed count — an edge
  // that lands inside the same 16ms frame as the previous one is one edge.
  for (let i = 0; i < 30 &&
       (await page.evaluate(() => window.__blast.state().sound)) !== 'uiclick'; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => {
    const s = window.__blast.state();
    return s.sound === 'uiclick' && s.variant === 'b';
  }, null, { timeout: 5000 });
  // Selecting a candidate plays it — tagged in the log.
  expect(await page.evaluate(() => window.__blast.sfx.current().log.at(-1))).toBe('uiclick#b');
  await page.keyboard.press('X');               // keep it
  await page.waitForFunction(() =>
    window.__blast.state().picks?.uiclick === 'b', null, { timeout: 5000 });
  // Banked in the save, not just in scene state — stamped with the pick
  // GENERATION (save.js SFX_PICKS_V): an unstamped map is discarded at load.
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('suchblast_v1')).sfxPicks)).toEqual({ v: 2, uiclick: 'b' });

  // Cold reload: the pick survives, and the NEXT thing the game itself plays
  // (the title's advance click) resolves through it.
  await page.reload();
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.keyboard.press('X');               // walks an intro card → uiclick
  await page.waitForFunction(() => window.__blast.sfx.current().plays >= 1,
                             null, { timeout: 5000 });
  expect(await page.evaluate(() => window.__blast.sfx.current().log.at(-1))).toBe('uiclick#b');
  expect(errors).toEqual([]);
});

test('Escape puts the title back', async ({ page }) => {
  const errors = await bootTitle(page);
  await enterAudition(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__blast.state().scene === 'title',
                             null, { timeout: 5000 });
  expect(errors).toEqual([]);
});
