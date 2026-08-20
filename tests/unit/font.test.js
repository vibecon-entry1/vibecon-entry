import test from 'node:test';
import assert from 'node:assert/strict';
import { drawText, drawTextShadow, measure, lineHeight, hasGlyph, GLYPH_W, GLYPH_H }
  from '../../web/engine/font.js';

// Minimal ctx spy: the font module only ever fillRects and sets fillStyle.
function spy() {
  return {
    fillStyle: '',
    rects: [],
    fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, c: this.fillStyle }); },
  };
}

// Every character the UI actually puts on screen must have a real glyph, not
// the tofu box. This is the test that catches "I added a string with a ° in it".
const UI_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?-_+=/\'()×·—';

test('glyph coverage: every UI character is authored', () => {
  for (const ch of UI_CHARS) assert.equal(hasGlyph(ch), true, `missing glyph: ${ch}`);
});

test('lowercase folds to caps and renders identically', () => {
  const a = spy(), b = spy();
  drawText(a, 'wow', 0, 0);
  drawText(b, 'WOW', 0, 0);
  assert.deepEqual(a.rects, b.rects);
  assert.ok(a.rects.length > 0);
});

test('every authored glyph is 7 rows of 5 columns', () => {
  // Drawn one at a time, no glyph may emit ink outside its own 5x7 cell.
  for (const ch of UI_CHARS) {
    const s = spy();
    drawText(s, ch, 0, 0);
    for (const r of s.rects) {
      assert.ok(r.x >= 0 && r.x + r.w <= GLYPH_W, `${ch} overflows horizontally`);
      assert.ok(r.y >= 0 && r.y + r.h <= GLYPH_H, `${ch} overflows vertically`);
    }
  }
});

test('space is blank, tofu is drawn for an unknown glyph', () => {
  const sp = spy(); drawText(sp, ' ', 0, 0);
  assert.equal(sp.rects.length, 0);
  const un = spy(); drawText(un, '☃', 0, 0);      // snowman: not authored
  assert.ok(un.rects.length > 0, 'unknown glyph must be visible, not silent');
});

test('measure: gaps between glyphs, none trailing', () => {
  assert.equal(measure(''), 0);
  assert.equal(measure('A'), GLYPH_W);
  assert.equal(measure('AB'), GLYPH_W * 2 + 1);
  assert.equal(measure('ABC'), GLYPH_W * 3 + 2);
  assert.equal(measure('ABC', 3), (GLYPH_W * 3 + 2) * 3);
  assert.equal(measure('ABC', 1, 2), GLYPH_W * 3 + 4);
  assert.equal(lineHeight(), GLYPH_H);
  assert.equal(lineHeight(4), GLYPH_H * 4);
});

test('drawText returns the same width measure reports', () => {
  const s = spy();
  assert.equal(drawText(s, 'WOW 100', 0, 0, { scale: 2 }), measure('WOW 100', 2));
});

test('alignment shifts the box, never the glyph grid', () => {
  const L = spy(), C = spy(), R = spy();
  drawText(L, 'AB', 100, 10);
  drawText(C, 'AB', 100, 10, { align: 'center' });
  drawText(R, 'AB', 100, 10, { align: 'right' });
  const minX = s => Math.min(...s.rects.map(r => r.x));
  const maxX = s => Math.max(...s.rects.map(r => r.x + r.w));
  const w = measure('AB');
  assert.equal(minX(L), 100);
  assert.equal(maxX(R), 100);                       // right edge lands ON x
  assert.equal(minX(C), Math.round(100 - w / 2));
});

test('all output lands on whole pixels at integer scale (the crispness invariant)', () => {
  const s = spy();
  drawText(s, 'MUCH WOW 42', 13.4, 7.6, { scale: 3 });
  for (const r of s.rects)
    for (const v of [r.x, r.y, r.w, r.h]) assert.equal(v, Math.round(v), 'fractional rect');
});

test('scale multiplies every rect dimension and offset', () => {
  const one = spy(), three = spy();
  drawText(one, 'S', 0, 0, { scale: 1 });
  drawText(three, 'S', 0, 0, { scale: 3 });
  assert.equal(one.rects.length, three.rects.length);
  one.rects.forEach((r, i) => {
    const t = three.rects[i];
    assert.deepEqual([t.x, t.y, t.w, t.h], [r.x * 3, r.y * 3, r.w * 3, r.h * 3]);
  });
});

test('row runs are merged, not one rect per ink pixel', () => {
  const s = spy();
  drawText(s, 'E', 0, 0);                            // three solid 5px bars
  assert.ok(s.rects.some(r => r.w === 5), 'expected a merged 5-wide run');
});

test('drawTextShadow lays the shadow down first, offset by half the scale', () => {
  const s = spy();
  drawTextShadow(s, 'X', 10, 10, { scale: 4 }, '#eec548', '#2a1c33');
  const shadow = s.rects.filter(r => r.c === '#2a1c33');
  const fill = s.rects.filter(r => r.c === '#eec548');
  assert.equal(shadow.length, fill.length);
  assert.equal(s.rects[0].c, '#2a1c33');             // shadow pass is first
  assert.equal(shadow[0].x - fill[0].x, 2);          // half of scale 4
  assert.equal(shadow[0].y - fill[0].y, 2);
});

test('shadow offset never rounds to zero, and shadowOff overrides it', () => {
  const one = spy();
  drawTextShadow(one, 'X', 0, 0, { scale: 1 }, '#fff', '#000');
  const s1 = one.rects.filter(r => r.c === '#000'), f1 = one.rects.filter(r => r.c === '#fff');
  assert.equal(s1[0].x - f1[0].x, 1);                // round(0.5) must not be 0
  const ovr = spy();
  drawTextShadow(ovr, 'X', 0, 0, { scale: 4, shadowOff: 1 }, '#fff', '#000');
  const s2 = ovr.rects.filter(r => r.c === '#000'), f2 = ovr.rects.filter(r => r.c === '#fff');
  assert.equal(s2[0].x - f2[0].x, 1);
});
