// BUILD STAMP — cache-busting for every mutable asset the game fetches.
//
// The problem this solves (user playtest, post-overhaul deploy): GitHub Pages
// serves everything with a ~10-minute max-age, so a returning player's browser
// happily mixed a cached old main.js with a freshly-fetched new atlas.png —
// stale frame offsets against new art = garbage render. There is no server to
// set cache headers on, so the fix is URL identity: every mutable asset URL
// carries the build stamp. An old cached page keeps hitting its OLD stamped
// URLs (which its cache still holds, consistently), and a fresh page's new
// stamp misses every stale cache entry at once.
//
// THE STAMP LIVES IN EXACTLY ONE PLACE: the `?v=` on the module entry in
// web/index.html. Bumping a deploy = editing that one value (see the comment
// there). This module reads it off the entry <script> tag at import time and
// every asset-fetching module (engine/assets.js, engine/audio.js,
// engine/sticker.js) routes its URLs through stamp(). No build step, no deps,
// works on any static host.
//
// Outside a document (node unit harnesses) BUILD falls back to 'dev', which
// keeps stamp() a pure string append either way.
const entry = typeof document !== 'undefined'
  ? document.querySelector('script[type="module"][src*="main.js"]')?.src
  : null;

export const BUILD = (entry && new URL(entry).searchParams.get('v')) || 'dev';

/** Append the build stamp to an asset URL (query-safe). */
export const stamp = url => `${url}${url.includes('?') ? '&' : '?'}v=${BUILD}`;
