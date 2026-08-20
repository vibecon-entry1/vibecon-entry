import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScale } from '../../web/engine/fit.js';

const VW = 640, VH = 360;

// The invariant the whole exercise exists for: the backing store main.js will
// build (round(VW*scale) x round(VH*scale)) occupies at most the window's
// device pixels, so its CSS box (backing/dpr) can never overflow the glass.
function assertFits(winW, winH, dpr, mode) {
  const s = fitScale({ winW, winH, dpr, mode, vw: VW, vh: VH });
  assert.ok(s > 0, `scale must be positive (got ${s})`);
  assert.ok(Math.round(VW * s) <= winW * dpr,
            `${winW}x${winH}@${dpr} ${mode}: width ${Math.round(VW * s)} > ${winW * dpr}`);
  assert.ok(Math.round(VH * s) <= winH * dpr,
            `${winW}x${winH}@${dpr} ${mode}: height ${Math.round(VH * s)} > ${winH * dpr}`);
  return s;
}

test('sub-640 viewports downscale fractionally instead of overflowing', () => {
  for (const [w, h] of [[320, 568], [375, 667], [568, 320]])
    for (const dpr of [1, 2])
      for (const mode of ['crisp', 'fill']) {
        const s = assertFits(w, h, dpr, mode);
        const raw = Math.min(w * dpr / VW, h * dpr / VH);
        if (raw < 1) assert.equal(s, raw);      // fraction kept, not clamped to 1
      }
});

test('320x568 portrait at dpr 1 is the worst case and still fits', () => {
  const s = fitScale({ winW: 320, winH: 568, dpr: 1, mode: 'crisp', vw: VW, vh: VH });
  assert.equal(s, 0.5);                          // 320/640 constrains
  assert.equal(Math.round(VW * s), 320);
  assert.equal(Math.round(VH * s), 180);
});

test('raw >= 1 keeps the shipped behaviour: crisp floors, fill keeps fraction', () => {
  assert.equal(fitScale({ winW: 1280, winH: 720, dpr: 1, mode: 'crisp', vw: VW, vh: VH }), 2);
  assert.equal(fitScale({ winW: 1500, winH: 850, dpr: 1, mode: 'crisp', vw: VW, vh: VH }), 2);
  const fill = fitScale({ winW: 1500, winH: 850, dpr: 1, mode: 'fill', vw: VW, vh: VH });
  assert.ok(Math.abs(fill - 1500 / 640) < 1e-9); // width-constrained fraction
  // dpr 3 phone landscape (390x844 rotated): floor(3.25) = 3
  assert.equal(fitScale({ winW: 844, winH: 390, dpr: 3, mode: 'crisp', vw: VW, vh: VH }), 3);
});

test('the raw < 1 boundary itself still counts as integer 1', () => {
  assert.equal(fitScale({ winW: 640, winH: 360, dpr: 1, mode: 'crisp', vw: VW, vh: VH }), 1);
  assert.equal(fitScale({ winW: 640, winH: 360, dpr: 1, mode: 'fill', vw: VW, vh: VH }), 1);
});
