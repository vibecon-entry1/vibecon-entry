import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TIERS, S_MIN, S_MAX, WORKER, tierFor, shareParams, shareUrl, shareText,
  canonical, signParams, signedShareUrl, encodeToken,
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

// --- the signature ----------------------------------------------------------
// A deterrent, not a defence: the key is public source. What these tests pin
// is that both ends compute the SAME thing, so a signed link unfurls its score
// and a URL-edited one doesn't.

test('canonical string is s.k.d.m, that order, dot-joined', () => {
  assert.equal(canonical({ s: 12437, k: 9, d: 2, m: 'g' }), '12437.9.2.g');
  assert.equal(canonical({ s: -1300, k: 0, d: 1, m: 'w' }), '-1300.0.1.w');
});

test('signature: known answer, deterministic, 10 lowercase hex chars', async () => {
  // Known-answer: HMAC-SHA256("12437.9.2.g") under the real (public) key,
  // first 10 hex chars. Recompute with node's crypto if the key ever moves.
  const p = { s: 12437, k: 9, d: 2, m: 'g' };
  assert.equal(await signParams(p), '7b79df86bf');
  assert.equal(await signParams(p), await signParams(p));
  assert.match(await signParams({ s: 0, k: 0, d: 0, m: 'w' }), /^[0-9a-f]{10}$/);
  // A one-off score is a different signature — the whole point.
  assert.notEqual(await signParams({ ...p, s: 12438 }), await signParams(p));
});

test('the token: base64url of canonical + sig, no padding chars', async () => {
  // Known answer end to end: "12437.9.2.g.7b79df86bf" base64url'd.
  const p = { s: 12437, k: 9, d: 2, m: 'g' };
  assert.equal(encodeToken(p, '7b79df86bf'), 'MTI0MzcuOS4yLmcuN2I3OWRmODZiZg');
  const run = { score: 12437, kills: 9, deaths: 2, mode: 'gauntlet' };
  assert.equal(await signedShareUrl(run), `${WORKER}?r=MTI0MzcuOS4yLmcuN2I3OWRmODZiZg`);
  assert.match(await signedShareUrl(run), /\?r=[A-Za-z0-9_-]+$/);   // URL-safe, unpadded
  // Round-trip: the token decodes back to exactly what was signed.
  const tok = encodeToken(p, await signParams(p));
  assert.equal(Buffer.from(tok, 'base64url').toString(),
               `${canonical(p)}.${await signParams(p)}`);
  // http:// off localhost has no crypto.subtle: sig "0" marks the token
  // unverifiable (the worker unfurls it generic) rather than the share
  // crashing. null, not undefined — undefined re-triggers the default param.
  assert.equal(await signedShareUrl(run, null), `${WORKER}?r=${encodeToken(p, '0')}`);
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
  // ...and the signature: the worker must assemble the same key from the same
  // pieces and cover the same canonical string, or every real link unfurls
  // generic. Pinned as source text because the worker can't be imported.
  assert.ok(worker.includes(`const KEY = ['much-', 'auth-', 'very-', 'wow'].join('');`),
            'worker HMAC key drifted');
  assert.ok(worker.includes('`${p.s}.${p.k}.${p.d}.${p.m}`'),
            'worker canonical string drifted');
  assert.ok(worker.includes(`.slice(0, 10)`), 'worker sig truncation drifted');
  // ...and every rung has a committed card to point at.
  for (const t of TIERS)
    readFileSync(new URL(`web/share/card-${t}.png`, ROOT));
  readFileSync(new URL('web/share/hero.png', ROOT));
});

// The worker imports nothing, but node can import IT — so the sig gate is
// exercised for real: same fetch handler, real Request/Response.
const workerGet = async (qs) => {
  const { default: worker } = await import('../../share-worker/worker.js');
  const res = await worker.fetch(new Request(`https://sb-share.example/?${qs}`));
  assert.equal(res.status, 200);
  return res.text();
};
const GENERIC = 'SUCH BLAST — much game. very mars.';

test('worker: a good ?r= token unfurls the score, a mangled one unfurls generic', async () => {
  const p = { s: 12437, k: 9, d: 2, m: 'g' };
  const tok = encodeToken(p, await signParams(p));
  const good = await workerGet(`r=${tok}`);
  assert.match(good, /i got 12437 WOW in SUCH BLAST/);
  assert.match(good, /card-10\.png/);                // tier card, not the hero

  // One flipped character — anywhere — and the claim dies to generic.
  const flip = tok.slice(0, 4) + (tok[4] === 'A' ? 'B' : 'A') + tok.slice(5);
  const bad = await workerGet(`r=${flip}`);
  assert.match(bad, new RegExp(GENERIC));
  assert.ok(!bad.includes('12437 WOW'), 'flipped token must not claim the score');

  // The unsigned-fallback token (sig "0") and outright garbage: generic, not 500.
  assert.match(await workerGet(`r=${encodeToken(p, '0')}`), new RegExp(GENERIC));
  assert.match(await workerGet('r=%%%not-base64%%%'), new RegExp(GENERIC));
  assert.match(await workerGet('r='), new RegExp(GENERIC));
});

test('worker legacy path: readable params + g= behave exactly as before', async () => {
  const get = workerGet;
  const g = await signParams({ s: 12437, k: 9, d: 2, m: 'g' });
  const signed = await get(`s=12437&k=9&d=2&m=g&g=${g}`);
  assert.match(signed, /i got 12437 WOW in SUCH BLAST/);
  assert.match(signed, /card-10\.png/);              // tier card, not the hero

  const generic = GENERIC;
  const tampered = await get(`s=9999999&k=9&d=2&m=g&g=${g}`);   // score edited
  assert.match(tampered, new RegExp(generic));
  assert.ok(!tampered.includes('9999999'), 'tampered score must not be claimed');
  assert.match(tampered, /hero\.png/);

  const unsigned = await get('s=12437&k=9&d=2&m=g');            // pre-sig link
  assert.match(unsigned, new RegExp(generic));
  assert.match(unsigned, /hero\.png/);

  // CAPS-only manual retype: keys and hex both uppercased must still verify.
  const shouted = await get(`S=12437&K=9&D=2&M=G&G=${g.toUpperCase()}`);
  assert.match(shouted, /i got 12437 WOW in SUCH BLAST/);
});

test('the static og:image points at a card that exists', () => {
  const html = readFileSync(new URL('web/index.html', ROOT), 'utf8');
  const m = /<meta property="og:image" content="([^"]+)">/.exec(html);
  assert.ok(m, 'no og:image');
  assert.ok(m[1].startsWith('https://'), 'og:image must be absolute');
  // Pathname, not the raw string: the URL carries a ?v= cache-bust for the
  // scrapers, and the probe is about WHICH file it points at, not the query.
  assert.ok(new URL(m[1]).pathname.endsWith('/share/hero.png'));
  assert.match(html, /twitter:card" content="summary_large_image"/);
});

// --- clipboard --------------------------------------------------------------

test('copyShare writes the bare link, and only the link', async () => {
  // User bug report: a ClipboardItem carrying image/png alongside the text made
  // chat apps paste the picture and drop the link. The write is now writeText
  // of the URL alone — the card reaches readers via the link's unfurl.
  const writes = [];
  const clipboard = { writeText: async (t) => writes.push(t) };
  const res = await copyShare({ score: 500, kills: 1, deaths: 0 }, { clipboard });
  const url = await signedShareUrl({ score: 500, kills: 1, deaths: 0 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0], url);             // the (signed) link, nothing else
  assert.match(url, /\?r=[A-Za-z0-9_-]+$/); // the opaque token, nothing readable
  assert.equal(res.url, url);
  assert.equal(res.text, url);
});

test('copyShare never touches ClipboardItem, even where one exists', async () => {
  const writes = [];
  const clipboard = {
    writeText: async (t) => writes.push(t),
    write: async () => { throw new Error('image write must not be reached'); },
  };
  globalThis.ClipboardItem = function ClipboardItem() {};
  try {
    const res = await copyShare({ score: 7 }, { clipboard });
    assert.equal(writes.length, 1);
    assert.equal(res.url, await signedShareUrl({ score: 7 }));
  } finally {
    delete globalThis.ClipboardItem;
  }
});

test('copyShare rejects when there is no clipboard at all', async () => {
  await assert.rejects(() => copyShare({ score: 1 }, { clipboard: undefined }));
  await assert.rejects(() => copyShare({ score: 1 }, { clipboard: {} }));
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
