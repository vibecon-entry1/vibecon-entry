// Sharing a run. Three things live here and nothing else does:
//
//   1. the TIER ladder — which committed card-{tier}.png a score unfurls into
//   2. the share URL + share text a player copies
//   3. a live 1200x630 card, drawn on an offscreen canvas with the EXACT score
//
// The game NEVER talks to the network. The URL is a string; the picture is a
// canvas. Everything that turns those into an unfurl happens on someone else's
// machine, in share-worker/worker.js, when a scraper follows the link.
import { drawText, drawTextShadow, measure, GLYPH_H } from '../engine/font.js';
import { mulberry32 } from '../engine/rng.js';

// The unfurl worker. Deployed from share-worker/ — see its header. Trailing
// slash included so the query is appended to a real path.
export const WORKER = 'https://sb-share.vibecon-entry.workers.dev/';

// Thousands of WOW. THIS LIST IS DUPLICATED THREE TIMES on purpose: here, in
// tools/gencards.py (which draws one PNG per entry) and in the worker (which
// has no imports at all — it is one file uploaded to an edge runtime). A unit
// test pins this copy and the worker's copy together, and the generator's
// output is a committed file, so a drift shows up as a missing card in review.
export const TIERS = [0, 1, 2, 5, 10, 15, 20, 30, 50];

// Clamps. The score can legitimately be NEGATIVE — a death docks 100 WOW and
// the respawn economy refunds kills, so a bad run genuinely ends below zero —
// so the low end is a floor, not a zero. Kills and deaths are counts.
export const S_MIN = -100000, S_MAX = 9999999;

const clampInt = (v, lo, hi) =>
  Math.max(lo, Math.min(hi, Math.trunc(Number(v) || 0)));

/** The tier card a score gets: the largest rung it clears. Negative → 0. */
export function tierFor(score) {
  const k = clampInt(score, S_MIN, S_MAX) / 1000;
  let t = TIERS[0];
  for (const n of TIERS) if (k >= n) t = n;
  return t;
}

/** Canonical query for a finished run. mode: 'gauntlet' | 'wow'. */
export function shareParams({ score, kills = 0, deaths = 0, mode = 'gauntlet' }) {
  return {
    s: clampInt(score, S_MIN, S_MAX),
    k: clampInt(kills, 0, S_MAX),
    d: clampInt(deaths, 0, S_MAX),
    m: mode === 'wow' ? 'w' : 'g',
  };
}

export function shareUrl(run) {
  const p = shareParams(run);
  return `${WORKER}?s=${p.s}&k=${p.k}&d=${p.d}&m=${p.m}`;
}

// --- the signature ----------------------------------------------------------
// A share URL is `?r=<token>`: base64url of "s.k.d.m.SIG" — the canonical
// string (the four params, that order, dot-joined) plus the first 10 hex chars
// of its HMAC-SHA256. The worker decodes, recomputes the HMAC, and serves the
// generic no-score page when it doesn't match — so the score isn't a visible
// number inviting an edit, and a decoded-and-edited token fails the check.
//
// SPEED BUMP, NOT A LOCK. This repo is public, so the key below is readable by
// anyone who cares to look; the split is only so the URL can't be forged by
// pattern-matching one string out of the source. The bar being raised is
// exactly "edit a number in the URL" → "read the source and compute an HMAC".
const KEY = ['much-', 'auth-', 'very-', 'wow'].join('');

/** The exact bytes the signature covers. One definition, pinned by tests. */
export function canonical(p) {
  return `${p.s}.${p.k}.${p.d}.${p.m}`;
}

/** 10-hex-char HMAC of the canonical string, or null where crypto.subtle
 *  doesn't exist (http:// off localhost) — the URL then goes out unsigned and
 *  unfurls generic, which beats crashing the share. */
export async function signParams(p, subtle = globalThis.crypto?.subtle) {
  if (!subtle) return null;
  try {
    const enc = new TextEncoder();
    const key = await subtle.importKey('raw', enc.encode(KEY),
                                       { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await subtle.sign('HMAC', key, enc.encode(canonical(p))));
    return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
  } catch {
    return null;
  }
}

/** base64url, no padding — the token has to survive a URL untouched. */
const b64url = (s) =>
  btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** The opaque token: base64url("s.k.d.m.SIG"). SIG is the 10-hex HMAC, or the
 *  literal "0" when signing wasn't possible — the worker treats that as
 *  unverified and unfurls generic, same as any bad signature. */
export function encodeToken(p, sig) {
  return b64url(`${canonical(p)}.${sig || '0'}`);
}

/** The share URL: `?r=<token>`. Always this shape — an unsigned token (no
 *  crypto.subtle, i.e. http:// off localhost) just unfurls generic. */
export async function signedShareUrl(run, subtle) {
  const p = shareParams(run);
  return `${WORKER}?r=${encodeToken(p, await signParams(p, subtle))}`;
}

/** What lands in the clipboard. The URL is last so every client links it.
 *  Pass the (signed) url when you have one; defaults to the unsigned shape. */
export function shareText(run, url = shareUrl(run)) {
  return `i got ${shareParams(run).s} WOW in SUCH BLAST. ${url}`;
}

// --- the live card ----------------------------------------------------------
// Same layout as tools/gencards.py's cards (see that file for why the score is
// the biggest thing on it), with one difference that is the whole reason this
// exists: the headline is the EXACT score, not the tier. The committed PNGs
// have to be a fixed set because a scraper fetches them by URL; the picture in
// your clipboard has no such constraint.

const CW = 1200, CH = 630;
const GOLD = '#eec548', SHADOW = '#2a1c33', NAVY = '#1e2f51';
const ROCK = '#532e6d', ROCK_DK = '#3a2049', ROCK_LT = '#7a4b96', DIRT = '#982c2c';
const GROUND = 96;

/** Largest scale whose line fits in maxW. */
function fitScale(text, maxW, want) {
  let s = want;
  while (s > 1 && measure(text, s) > maxW) s--;
  return s;
}

function bands(ctx, rnd) {
  // Far buttes, then near rocks: flat-topped polygons and triangles, the same
  // two shapes genart.py's parallax painters cut.
  const mesaTop = CH - GROUND + 18 - 200;
  for (let x = 0; x < CW;) {
    const w = 90 + Math.floor(rnd() * 126), h = 130 + Math.floor(rnd() * 130);
    const taper = 8 + Math.floor(rnd() * 20), top = mesaTop + 200 - h;
    ctx.fillStyle = NAVY;
    ctx.beginPath();
    ctx.moveTo(x, CH); ctx.lineTo(x, top + 12); ctx.lineTo(x + taper, top);
    ctx.lineTo(x + w - taper, top); ctx.lineTo(x + w, top + 12); ctx.lineTo(x + w, CH);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2c4370';
    ctx.fillRect(x + taper, top, w - 2 * taper, 5);
    x += w + 20 + Math.floor(rnd() * 100);
  }
  const rockBase = CH - GROUND + 14;
  for (let x = 0; x < CW;) {
    const w = 40 + Math.floor(rnd() * 80), h = 30 + Math.floor(rnd() * 80);
    const peak = x + w / 3 + rnd() * (w / 3);
    ctx.fillStyle = ROCK_DK;
    ctx.beginPath();
    ctx.moveTo(x, rockBase); ctx.lineTo(peak, rockBase - h); ctx.lineTo(x + w, rockBase);
    ctx.closePath(); ctx.fill();
    x += w + 10 + Math.floor(rnd() * 70);
  }
}

/**
 * Draw the share card into `ctx` (a 1200x630 2D context). Deterministic: the
 * starfield and the skyline come off a fixed seed, so the same run always
 * produces the same picture.
 */
export function drawShareCard(ctx, run) {
  const p = shareParams(run);
  const rnd = mulberry32(20260);

  const g = ctx.createLinearGradient(0, 0, 0, 340);
  g.addColorStop(0, '#3c2448'); g.addColorStop(1, '#0b0b12');
  ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, 340);

  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rnd() * CW), y = Math.floor(rnd() * 430);
    ctx.fillStyle = rnd() < 0.2 ? '#ffffff' : '#aee6ff';
    const s = rnd() < 0.16 ? 3 : 2;
    ctx.fillRect(x, y, s, s);
  }

  bands(ctx, rnd);

  ctx.fillStyle = ROCK; ctx.fillRect(0, CH - GROUND, CW, GROUND);
  ctx.fillStyle = ROCK_LT; ctx.fillRect(0, CH - GROUND, CW, 5);
  ctx.fillStyle = DIRT; ctx.fillRect(0, CH - GROUND + 6, CW, 3);
  ctx.fillStyle = ROCK_DK;
  for (let i = 0; i < 700; i++)
    ctx.fillRect(Math.floor(rnd() * CW), CH - GROUND + 10 + Math.floor(rnd() * (GROUND - 10)), 3, 3);

  drawTextShadow(ctx, 'SUCH BLAST', CW / 2, 62, { align: 'center', scale: 10 },
                 '#ffffff', SHADOW);
  const head = `${p.s} WOW`;
  const hs = fitScale(head, CW - 128, 20);
  drawTextShadow(ctx, head, CW / 2, 190, { align: 'center', scale: hs }, GOLD, SHADOW);
  const sub = `${p.k} kills · ${p.d} deaths · ${p.m === 'w' ? 'wow zone' : 'gauntlet'}`;
  const ss = fitScale(sub, CW - 320, 5);
  drawTextShadow(ctx, sub, CW / 2, 190 + GLYPH_H * hs + 46, { align: 'center', scale: ss },
                 '#c9bde8', SHADOW);
  return ctx;
}

// --- the copy itself --------------------------------------------------------

/**
 * Copy the run's LINK to the clipboard. The link, and nothing else.
 *
 * It used to be one ClipboardItem carrying text/plain AND image/png of the
 * card. User bug report: image-preferring paste targets (every chat app) take
 * the picture and drop the link — so a share pasted into Discord arrived as a
 * static screenshot with nothing to click, and the unfurl worker (whose whole
 * job is turning the link into that same card via OpenGraph) never got a look
 * in. The card still reaches the reader — through the LINK's unfurl, which is
 * the designed route. So: plain writeText of the bare URL, which every
 * clipboard-having browser supports, and every paste target treats as a link.
 *
 * Returns {text, url} (text === url). Rejects only when the write failed,
 * which is what the caller shows the manual-copy fallback for.
 */
export async function copyShare(run, { clipboard = navigator.clipboard } = {}) {
  const url = await signedShareUrl(run);
  if (!clipboard?.writeText) throw new Error('no clipboard');
  await clipboard.writeText(url);
  return { text: url, url };
}

/** An offscreen 1200x630 canvas with the card on it, or null without a DOM. */
export function renderShareCanvas(run, doc = globalThis.document) {
  if (!doc?.createElement) return null;
  const c = doc.createElement('canvas');
  c.width = CW; c.height = CH;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  drawShareCard(ctx, run);
  return c;
}

export const CARD_W = CW, CARD_H = CH;
