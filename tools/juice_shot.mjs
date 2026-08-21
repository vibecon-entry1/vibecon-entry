// Juice-pass screenshot helper (dev tool, not part of any suite).
//   node tools/juice_shot.mjs <outPng> [warpX] [settleMs]
// Boots ?test, waits for idle, optionally warps, waits a beat, screenshots.
import { chromium } from '@playwright/test';

const [out, warpX, settleMs] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGEERROR', e));
await page.goto('http://localhost:8123/?test');
await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });
if (warpX) await page.evaluate(x => window.__blast.cheat.warp(x), Number(warpX));
await page.waitForTimeout(Number(settleMs ?? 600));
await page.screenshot({ path: out });
console.log('shot', out, JSON.stringify(await page.evaluate(() => {
  const s = window.__blast.state(); return { x: Math.round(s.x), hp: s.hp };
})));
await browser.close();
