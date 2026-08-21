// Juice-pass action screenshot: drives a short tape (run + hop + fire) and
// grabs frames so dust/debris are visible. Dev tool, not part of any suite.
//   node tools/juice_action.mjs <outPrefix> [warpX]
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
    { f: base + 5,   a: { right: true } },
    { f: base + 40,  a: { right: true, down: true, fire: true } },  // hop up
    { f: base + 44,  a: { right: true } },
    { f: base + 90,  a: { right: true, fire: true } },              // strafe fire
    { f: base + 200, a: { right: true, down: true } },              // slide
    { f: base + 280, a: null },
  ]);
});
for (const [ms, tag] of [[900, 'land'], [1800, 'fire'], [3600, 'slide']]) {
  await page.waitForTimeout(ms === 900 ? 900 : ms - (tag === 'fire' ? 900 : 1800));
  await page.screenshot({ path: `${prefix}-${tag}.png` });
  console.log('shot', `${prefix}-${tag}.png`);
}
await browser.close();
