import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TIERS, S_MIN, S_MAX, WORKER, tierFor, shareParams, shareUrl, shareText,
  copyShare, drawShareCard, renderShareCanvas,
} from '../../web/game/share.js';

const ROOT = new URL('../../', import.meta.url);

test('tier ladder: a score gets the biggest rung it clears', () => {
  assert.equal(tierFor(0), 0);
  assert.equal(tierFor(999), 0);
  assert.equal(tierFor(1000), 1);
  assert.equal(tierFor(1999), 1);
  assert.equal(tierFor(2000), 2);
  assert.equal(tierFor(4999), 2);
  assert.equal(tierFor(12437), 10);
  assert.equal(tierFor(29999), 20);
  assert.equal(tierFor(50000), 50);
  assert.equal(tierFor(9999999), 50);          // above the top rung stays on it
});

test('a negative run still shares: tier 0, score preserved', () => {
  // The respawn economy docks 100 WOW a death, so this is a real score, not a
  // bug — the card says SUCH ATTEMPT and the title still quotes the number.
  assert.equal(tierFor(-1), 0);
  assert.equal(tierFor(-100000), 0);
  assert.equal(shareParams({ score: -1300 }).s, -1300);
});

test('params are clamped integers, mode collapses to one letter', () => {
  assert.deepEqual(shareParams({ score: 12437.9, kills: 9, deaths: 2, mode: 'gauntlet' }),
                   { s: 12437, k: 9, d: 2, m: 'g' });
  assert.deepEqual(shareParams({ score: 1e12, kills: -4, deaths: NaN, mode: 'wow' }),
                   { s: S_MAX, k: 0, d: 0, m: 'w' });
  assert.equal(shareParams({ score: -1e9 }).s, S_MIN);
  assert.equal(shareParams({ score: 5, mode: 'nonsense' }).m, 'g');
});

test('url and text carry the run and the worker', () => {
  const run = { score: 12437, kills: 9, deaths: 2, mode: 'gauntlet' };
  assert.equal(shareUrl(run), `${WORKER}?s=12437&k=9&d=2&m=g`);
  assert.match(shareText(run), /^i got 12437 WOW in SUCH BLAST\. https:\/\//);
  assert.ok(shareText(run).endsWith(shareUrl(run)));      // link last, always
  assert.equal(WORKER, 'https://sb-share.vibecon-entry.workers.dev/');
});

// The worker has no imports by design (one file, no bundler), so the ladder and
// the clamps exist twice. This is the test that catches the two copies drifting
// — and a third copy lives in tools/gencards.py, checked the same way.
test('worker and card generator agree with the game on the tier ladder', () => {
  const worker = readFileSync(new URL('share-worker/worker.js', ROOT), 'utf8');
  const gen = readFileSync(new URL('tools/gencards.py', ROOT), 'utf8');
  const list = `[${TIERS.join(', ')}]`;
  assert.ok(worker.includes(`const TIERS = ${list};`), 'worker TIERS drifted');
  assert.ok(gen.includes(`TIERS = ${list}`), 'gencards TIERS drifted');
  assert.ok(worker.includes(`const S_MIN = ${S_MIN}, S_MAX = ${S_MAX};`),
            'worker clamps drifted');
  // ...and every rung has a committed card to point at.
  for (const t of TIERS)
    readFileSync(new URL(`web/share/card-${t}.png`, ROOT));
  readFileSync(new URL('web/share/hero.png', ROOT));
});

test('the static og:image points at a card that exists', () => {
  const html = readFileSync(new URL('web/index.html', ROOT), 'utf8');
  const m = /<meta property="og:image" content="([^"]+)">/.exec(html);
  assert.ok(m, 'no og:image');
  assert.ok(m[1].startsWith('https://'), 'og:image must be absolute');
  assert.ok(m[1].endsWith('/share/hero.png'));
  assert.match(html, /twitter:card" content="summary_large_image"/);
});

// --- clipboard --------------------------------------------------------------

test('copyShare writes the text and reports the image it managed to attach', async () => {
  const writes = [];
  const clipboard = { writeText: async (t) => writes.push(t) };
  const res = await copyShare({ score: 500, kills: 1, deaths: 0 }, { clipboard });
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes('500 WOW'));
  assert.equal(res.image, false);           // no canvas, no picture — text stands
  assert.equal(res.url, shareUrl({ score: 500, kills: 1, deaths: 0 }));
});

test('copyShare rejects when there is no clipboard at all', async () => {
  await assert.rejects(() => copyShare({ score: 1 }, { clipboard: undefined }));
  await assert.rejects(() => copyShare({ score: 1 }, { clipboard: {} }));
});

test('a failed IMAGE write does not lose the text', async () => {
  const clipboard = {
    writeText: async () => {},
    write: async () => { throw new Error('nope'); },
  };
  const canvas = { toBlob: (cb) => cb({}) };
  globalThis.ClipboardItem = function ClipboardItem() {};
  const res = await copyShare({ score: 7 }, { clipboard, canvas });
  delete globalThis.ClipboardItem;
  assert.equal(res.image, false);
  assert.ok(res.text.includes('7 WOW'));
});

// --- the card ---------------------------------------------------------------

// One shared gradient stub, not a fresh object per call: two spies have to be
// comparable, and a per-call object would make every gradient fill differ by
// identity alone.
const GRAD = { addColorStop() {} };

function ctxSpy() {
  return {
    fillStyle: '', imageSmoothingEnabled: true, rects: [],
    fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, c: this.fillStyle }); },
    createLinearGradient() { return GRAD; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
  };
}

test('the live card draws the EXACT score, deterministically', () => {
  const run = { score: 12437, kills: 9, deaths: 2, mode: 'gauntlet' };
  const a = ctxSpy(), b = ctxSpy();
  drawShareCard(a, run);
  drawShareCard(b, run);
  assert.deepEqual(a.rects, b.rects);            // same run → same picture
  assert.ok(a.rects.length > 1000);
  // Every rect lands inside the 1200x630 card (the starfield/skyline are seeded
  // and the type is fitted, so nothing may hang off the edge).
  for (const r of a.rects) assert.ok(r.x >= -4 && r.x < 1200, `x=${r.x}`);

  const c = ctxSpy();
  drawShareCard(c, { ...run, score: 12438 });
  assert.notDeepEqual(c.rects, a.rects);         // a different score is a different card
});

test('renderShareCanvas is a no-op without a DOM', () => {
  assert.equal(renderShareCanvas({ score: 1 }, undefined), null);
});
