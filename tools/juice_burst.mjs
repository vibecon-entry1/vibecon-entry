// Burst screenshots around a hop-landing + a kill, to catch particles.
//   node tools/juice_burst.mjs <outPrefix> [warpX]
import { chromium } from '@playwright/test';

const [prefix, warpX] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGEERROR', e));
await page.goto('http://localhost:8123/?test');
await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });
if (warpX) await page.evaluate(x => window.__blast.cheat.warp(x), Number(warpX));
await page.evaluate(() => {
  const base = window.__blast.frame;
  window.__blast.playTape([
    { f: base + 5,  a: { down: true, fire: true } },   // hop straight up
    { f: base + 9,  a: {} },
    { f: base + 80, a: { right: true, fire: true } },  // then run+fire into enemies
    { f: base + 400, a: null },
  ]);
});
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(140);
  await page.screenshot({ path: `${prefix}-${String(i).padStart(2, '0')}.png` });
}
console.log('done');
await browser.close();
