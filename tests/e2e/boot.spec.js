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
  expect(st.anims).toBe(20);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'tests/artifacts/boot.png' });
});
