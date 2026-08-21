// SUCH BLAST unfurl worker.  https://sb-share.vibecon-entry.workers.dev/
//
// One job: a link to a RUN has to unfurl into that run's score. Static meta in
// web/index.html can't do that — a scraper reads one fixed set of tags off the
// page and never runs the game's JS — so a run link points here instead, and
// this hands the scraper tags built from the query string.
//
// GET /?r=TOKEN                                →  200, the run's tags if the
//                                                  token verifies, generic if not
// GET /?s=SCORE&k=KILLS&d=DEATHS&m=g|w&g=SIG  →  200 text/html, the run's tags
// ...with g missing or wrong                   →  200, the generic no-score tags
// anything but GET                             →  405
//
// Both query shapes live forever: ?r= is what the game emits now, and the
// readable ?s=&k=&d=&m=&g= form is every link already pasted somewhere — those
// must keep unfurling exactly as they did.
//
// It stores nothing and logs nothing: the whole state of a share is in the URL
// the player copied, which is why this can be a single stateless file with no
// bindings, no KV, and no npm dependency. Deployed straight through the
// Cloudflare REST API (see DEPLOY.md) — there is no wrangler in this repo.
//
// NO SECRETS IN THIS FILE. It is public source and the deployed script is
// world-readable at its own URL. The HMAC key below is deliberately not a
// secret — see THE SIGNATURE.

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

// THE SIGNATURE. The sig is the first 10 hex chars of HMAC-SHA256 over
// "s.k.d.m" (the params, that order, dot-joined) — same construction, same
// split-assembled key as web/game/share.js. It arrives either inside an ?r=
// token (base64url of "s.k.d.m.SIG") or as the legacy bare &g= param.
// SPEED BUMP, NOT A LOCK: both files are public, so anyone can read the key
// and forge a link; the point is only that editing a score out of a URL stops
// working without doing that. A bad or missing sig is NOT an error — the link
// still unfurls, just into the generic no-score page — so old and mangled
// links degrade gracefully.
const KEY = ['much-', 'auth-', 'very-', 'wow'].join('');

const canonical = (p) => `${p.s}.${p.k}.${p.d}.${p.m}`;

async function signRaw(str) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(KEY),
                                            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(str)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}

const signParams = (p) => signRaw(canonical(p));

// Decode an ?r= token: base64url("s.k.d.m.SIG"). Returns {canon, sig, run} or
// null when it isn't one — a null, like a bad sig, means the generic page, not
// an error. The sig is verified over the DECODED canon bytes (exactly what the
// game signed); the run values are re-clamped anyway, out of habit.
function decodeToken(r) {
  try {
    const raw = atob(String(r).replaceAll('-', '+').replaceAll('_', '/'));
    const parts = raw.split('.');
    if (parts.length !== 5) return null;
    return {
      canon: parts.slice(0, 4).join('.'),
      sig: parts[4],
      run: {
        s: clampInt(parts[0], S_MIN, S_MAX),
        k: clampInt(parts[1], 0, S_MAX),
        d: clampInt(parts[2], 0, S_MAX),
        m: parts[3] === 'w' ? 'w' : 'g',
      },
    };
  } catch {
    return null;
  }
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

// The two shapes a link can unfurl into. A run whose signature checks out gets
// its score; anything else — no g, wrong g, or a pre-signature link — gets the
// same tags the static page carries: game title, hero card, no score claim.
function scorePage({ s, k, d, m }) {
  return page({
    title: `i got ${s} WOW in SUCH BLAST`,
    desc: `${k} kills · ${d} deaths · ${m === 'w' ? 'WOW ZONE' : 'gauntlet'} · ` +
          `the gun is your legs.`,
    img: `${PAGES}/share/card-${tierFor(s)}.png?v=2`,  // bump to bust scraper og caches on art changes
  });
}

function genericPage() {
  return page({
    title: 'SUCH BLAST — much game. very mars.',
    desc: 'the gun is your legs. much blast. a VibeCon 2026 game.',
    img: `${PAGES}/share/hero.png?v=2`,
  });
}

function page({ title, desc, img }) {
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
  async fetch(request) {
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

    let run = null;   // stays null → generic page
    const r = q.get('r');
    if (r != null) {
      // The token path. The value is case-SENSITIVE (base64url) — only the
      // query KEY is case-folded above. sig "0" is the game's explicit
      // couldn't-sign marker; it can never equal a 10-hex HMAC.
      const t = decodeToken(r);
      if (t && t.sig === await signRaw(t.canon)) run = t.run;
    } else {
      // The legacy readable path, kept byte-for-byte: every ?s=&k=&d=&m=&g=
      // link already pasted somewhere must go on unfurling exactly as it did.
      const m = (q.get('m') || '').toLowerCase();
      const legacy = {
        s: clampInt(q.get('s'), S_MIN, S_MAX),
        k: clampInt(q.get('k'), 0, S_MAX),
        d: clampInt(q.get('d'), 0, S_MAX),
        m: m === 'w' ? 'w' : 'g',
      };
      // Lower-cased like every other value — the manual-copy path shouted the
      // URL in a CAPS-only font, and hex is case-insensitive to a human.
      const g = (q.get('g') || '').toLowerCase();
      if (g !== '' && g === await signParams(legacy)) run = legacy;
    }
    return new Response(run ? scorePage(run) : genericPage(), {
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
