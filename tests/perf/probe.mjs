// Frame-time probe at max entity load (spec §13). NOT part of the default
// suite — numbers are machine-relative, so nothing here asserts; it prints.
//
//   node tools/serve.mjs 8123 &        # or: npm run serve
//   node tests/perf/probe.mjs [cpuThrottle]   # default 4
//
// Setup: 1280x720 dpr1 (crisp scale 2), ?test boot, warp to the boss arena,
// wait for the summon phase (boss + minions + the roster around the arena),
// then a 12s tape holding fire and wiggling direction — bolts in both
// directions, camera churn, popups, the works.
//
// Two readings, both from a rAF wrap installed BEFORE boot:
//   WORK  — ms spent inside each rAF callback (sim steps + render): the
//           number the 16.6ms budget is about.
//   DELTA — ms between rAF callbacks, plus a count of missed vsyncs (>25ms):
//           what the player's eye actually sees.
//
// Recorded on the dev box that gated Plan 5 (4x throttle):
//   before perf pass  WORK mean 11.7  p50 11.6  p95 15.4  p99 21.3 — 31 missed/6s
//   after  perf pass  WORK mean  5.7  p50  5.6  p95 10.0  p99 12.3 —  0 missed/6s
import { chromium } from '@playwright/test';

const RATE = Number(process.argv[2]) || 4;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const orig = window.requestAnimationFrame.bind(window);
  window.__work = []; window.__delta = [];
  let last = 0;
  window.requestAnimationFrame = cb => orig(ts => {
    if (last) window.__delta.push(ts - last);
    last = ts;
    const a = performance.now();
    cb(ts);
    window.__work.push(performance.now() - a);
  });
});
page.on('pageerror', e => console.log('PAGEERROR', e));
await page.goto('http://localhost:8123/?test');
await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });
await page.evaluate(() => window.__blast.cheat.warp(22300));
await page.waitForFunction(() => window.__blast.state().minions >= 2, null, { timeout: 30000 });
console.log('load', JSON.stringify(await page.evaluate(() => {
  const s = window.__blast.state();
  return { enemies: s.enemies, minions: s.minions, bossOn: s.bossOn };
})), 'cpuThrottle', RATE);

const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
await page.evaluate(() => {
  const base = window.__blast.frame;
  const tape = [];
  for (let i = 0; i < 12; i++)
    tape.push({ f: base + i * 60, a: { fire: true, [i % 2 ? 'left' : 'right']: true } });
  tape.push({ f: base + 720, a: null });
  window.__blast.playTape(tape);
  window.__work.length = 0; window.__delta.length = 0;
});
await page.waitForTimeout(6500);

const out = await page.evaluate(() => {
  const stat = a => {
    const d = [...a].sort((x, y) => x - y);
    const q = p => d[Math.min(d.length - 1, Math.floor(d.length * p))];
    return { n: d.length,
             mean: +(d.reduce((s, v) => s + v, 0) / d.length).toFixed(2),
             p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2),
             p99: +q(0.99).toFixed(2), max: +Math.max(...d).toFixed(2) };
  };
  return { work: stat(window.__work), delta: stat(window.__delta),
           missed: window.__delta.filter(d => d > 25).length };
});
console.log('WORK ms ', JSON.stringify(out.work));
console.log('DELTA ms', JSON.stringify(out.delta), 'missed(>25ms):', out.missed);
await browser.close();
