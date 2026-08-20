import { test, expect } from '@playwright/test';

// Display-quality pass. The bug these guard: fit() used to size the canvas
// BACKING STORE in CSS pixels, so on a dpr-2 panel the browser smooth-upscaled
// a 1280x720 buffer onto 2560x1440 of glass — the "dull, text blurry on the big
// screen" report. The invariant now is backing == CSS * dpr, exactly.

const st = (page) => page.evaluate(() => window.__blast.state());

// The title scene is the only place the display setting is offered, so these
// boot the plain front door rather than ?test (which skips straight to play).
async function bootTitle(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  return errors;
}

// KeyD's edge is polled once per rAF, same swallow hazard as KeyX on the title
// (see arc.spec.js) — drive it with a bounded retry keyed off the state.
async function toggleTo(page, want) {
  for (let i = 0; i < 15 && (await st(page)).display !== want; i++) {
    await page.keyboard.press('KeyD', { delay: 30 });
    await page.waitForTimeout(60);
  }
  expect((await st(page)).display).toBe(want);
}

test.describe('dpr 1', () => {
  test('crisp: backing store is an integer multiple of the virtual size', async ({ page }) => {
    const errors = await bootTitle(page);
    const s = await st(page);
    expect(s.dpr).toBe(1);
    expect(s.display).toBe('crisp');
    expect(s.scale).toBe(2);                        // 1280x720 viewport / 640x360
    expect(s.backing).toEqual({ w: 1280, h: 720 });
    expect(s.css).toEqual({ w: '1280px', h: '720px' });
    expect(errors).toEqual([]);
  });
});

test.describe('dpr 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('crisp: backing store is in DEVICE pixels, CSS box stays put', async ({ page }) => {
    const errors = await bootTitle(page);
    const s = await st(page);
    expect(s.dpr).toBe(2);
    expect(s.scale).toBe(4);                        // 4 hardware px per game px
    // THE regression guard: backing must be dpr times the CSS box, or the
    // browser is resampling again.
    expect(s.backing).toEqual({ w: 2560, h: 1440 });
    expect(s.css).toEqual({ w: '1280px', h: '720px' });
    const box = await page.locator('#screen').boundingBox();
    expect(box.width).toBe(1280);
    expect(box.height).toBe(720);
    expect(errors).toEqual([]);
  });

  test('sound button click mapping still lands at dpr 2', async ({ page }) => {
    await bootTitle(page);
    // toVirtual() is rect-relative, and getBoundingClientRect is CSS px at any
    // dpr — so the button must still be hittable at its CSS-space position.
    // MUTE_BTN is virtual x 615..637, y 3..23; centre ~ (626, 13).
    const box = await page.locator('#screen').boundingBox();
    const cx = box.x + box.width * (626 / 640);
    const cy = box.y + box.height * (13 / 360);
    const muted = () => page.evaluate(() => JSON.parse(localStorage.getItem('suchblast_v1')).audio.muted);
    await page.mouse.click(cx, cy);
    expect(await muted()).toBe(true);
    await page.mouse.click(cx, cy);
    expect(await muted()).toBe(false);
    // And a click well away from the plate must NOT toggle it.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await muted()).toBe(false);
  });

  test('D toggles crisp/fill, fill fills the window, and the choice persists', async ({ page }) => {
    const errors = await bootTitle(page);
    expect((await st(page)).display).toBe('crisp');

    await toggleTo(page, 'fill');
    const f = await st(page);
    // 1280x720 is EXACTLY 640x360's aspect, so the fractional scale here lands
    // on a whole number and fill is indistinguishable from crisp. That is the
    // correct behaviour, and worth pinning: a 16:9 window should never pay the
    // fill mode's unevenness for nothing. The fractional case is covered by the
    // awkward-window block at the bottom of this file.
    expect(f.scale).toBe(4);
    const box = await page.locator('#screen').boundingBox();
    expect(box.height).toBeCloseTo(720, 0);
    expect(f.backing.h).toBe(1440);

    // Persisted through a reload, and the title line reflects it.
    await page.reload();
    await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
    expect((await st(page)).display).toBe('fill');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suchblast_v1')).display))
      .toBe('fill');

    await toggleTo(page, 'crisp');
    expect((await st(page)).scale).toBe(4);
    expect(errors).toEqual([]);
  });
});

test.describe('awkward window', () => {
  test.use({ viewport: { width: 1500, height: 850 } });

  test('crisp letterboxes rather than half-scaling', async ({ page }) => {
    await bootTitle(page);
    const s = await st(page);
    expect(s.scale).toBe(2);                        // floor(min(2.34, 2.36))
    expect(s.backing).toEqual({ w: 1280, h: 720 });
    await toggleTo(page, 'fill');
    const f = await st(page);
    expect(f.scale).toBeCloseTo(2.344, 2);
    expect(f.backing).toEqual({ w: 1500, h: 844 });
  });
});
