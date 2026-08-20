// SUCH BLAST unfurl worker.  https://sb-share.vibecon-entry.workers.dev/
//
// One job: a link to a RUN has to unfurl into that run's score. Static meta in
// web/index.html can't do that — a scraper reads one fixed set of tags off the
// page and never runs the game's JS — so a run link points here instead, and
// this hands the scraper tags built from the query string.
//
// GET /?s=SCORE&k=KILLS&d=DEATHS&m=g|w  →  200 text/html with the tags
// anything else                          →  405
//
// It stores nothing and logs nothing: the whole state of a share is in the URL
// the player copied, which is why this can be a single stateless file with no
// bindings, no KV, and no npm dependency. Deployed straight through the
// Cloudflare REST API (see DEPLOY.md) — there is no wrangler in this repo.
//
// NO SECRETS IN THIS FILE. It is public source and the deployed script is
// world-readable at its own URL.

// Where the committed cards live. Must match web/index.html's og:image host —
// if the Pages URL moves, both change together.
const PAGES = 'https://vibecon-entry1.github.io/vibecon-entry';
const GAME = `${PAGES}/`;

// Same ladder as web/game/share.js TIERS and tools/gencards.py TIERS. Kept as
// a literal because this file has no imports by design: it is uploaded whole
// to an edge runtime with no bundler in front of it.
const TIERS = [0, 1, 2, 5, 10, 15, 20, 30, 50];

// Same clamps as the game. The score is allowed to be NEGATIVE — the respawn
// economy docks 100 WOW a death and a bad run really does end below zero — so
// the low bound is a floor rather than 0.
const S_MIN = -100000, S_MAX = 9999999;

function clampInt(raw, lo, hi) {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}

function tierFor(score) {
  const k = score / 1000;
  let t = TIERS[0];
  for (const n of TIERS) if (k >= n) t = n;
  return t;
}

// Everything interpolated into the page goes through this. The numbers are
// already clamped integers so they cannot carry markup, and the mode is one of
// two fixed strings — but the escape is unconditional so that stays true the
// day someone adds a field that isn't.
const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function page({ s, k, d, m }) {
  const title = `i got ${s} WOW in SUCH BLAST`;
  const desc = `${k} kills · ${d} deaths · ${m === 'w' ? 'WOW ZONE' : 'gauntlet'} · ` +
               `the gun is your legs.`;
  const img = `${PAGES}/share/card-${tierFor(s)}.png`;
  const self = `${PAGES}/`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(self)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="description" content="${esc(desc)}">
<!-- A human who clicks the link wants the GAME, not this page. Scrapers do not
     follow refreshes, so the tags above are still what unfurls. The link is
     there for the handful of clients that strip meta-refresh. -->
<meta http-equiv="refresh" content="0; url=${esc(GAME)}">
<link rel="canonical" href="${esc(GAME)}">
<style>html,body{margin:0;height:100%;background:#0b0b12;color:#e8e0d0;
font:16px system-ui,sans-serif;display:grid;place-items:center}
a{color:#eec548}</style>
</head>
<body>
<p>${esc(title)}. <a href="${esc(GAME)}">much play →</a></p>
</body>
</html>`;
}

export default {
  fetch(request) {
    if (request.method !== 'GET') {
      return new Response('wow. very method not allowed.', {
        status: 405,
        headers: { 'allow': 'GET', 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    // Query keys are read case-insensitively. The game's manual-copy fallback
    // prints the URL in its CAPS-only bitmap font, so a player who retypes it
    // sends ?S=..&K=.. — and that has to resolve to their run, not to zero.
    const q = new Map();
    for (const [k, v] of new URL(request.url).searchParams) q.set(k.toLowerCase(), v);
    const m = (q.get('m') || '').toLowerCase();
    const run = {
      s: clampInt(q.get('s'), S_MIN, S_MAX),
      k: clampInt(q.get('k'), 0, S_MAX),
      d: clampInt(q.get('d'), 0, S_MAX),
      m: m === 'w' ? 'w' : 'g',
    };
    return new Response(page(run), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Scrapers re-fetch a link every time it is posted; an hour of edge
        // cache keeps a viral link from being a thousand cold starts.
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      },
    });
  },
};
