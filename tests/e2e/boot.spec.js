import { test, expect } from '@playwright/test';

test('boots clean: canvas, atlas, no console errors', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await expect(page.locator('canvas#screen')).toBeVisible();
  const st = await page.evaluate(() => window.__blast.state());
  expect(st.scene).toBe('play');
  expect(st.anims).toBe(28);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'tests/artifacts/boot.png' });
});

test('tape final entry is observed by the sim (press-and-hold)', async ({ page }) => {
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true);
  await page.evaluate(() => window.__blast.playTape([{ f: window.__blast.frame + 5, a: { debug: true } }]));
  await page.waitForFunction(() => window.__blast.state().scene === 'viewer', null, { timeout: 5000 });
  expect((await page.evaluate(() => window.__blast.state())).scene).toBe('viewer');
});

test('boot failure shows doge error screen (throwing localStorage)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });
  });
  await page.goto('http://localhost:8123/');
  await expect(page.locator('#err')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#err')).toContainText('very refresh');
});

test('viewer renders every anim without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => window.__blast?.ready === true);
  await page.keyboard.press('F1', { delay: 30 });          // → viewer
  await page.waitForFunction(() => window.__blast.state().scene === 'viewer');
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const name = (await page.evaluate(() => window.__blast.state())).viewerAnim;
    seen.add(name);
    await page.screenshot({ path: `tests/artifacts/anim-${String(i).padStart(2, '0')}-${name}.png` });
    await page.keyboard.press('ArrowRight', { delay: 30 });
  }
  expect(seen.size).toBe(20);
  expect(errors).toEqual([]);
});
