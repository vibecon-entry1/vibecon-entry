// Animated brand stickers: official Dogelon art, shipped as VP9-with-alpha
// .webm and drawn straight onto the game canvas with ctx.drawImage(video, ...).
//
// Why video and not a sprite sheet: these are 24fps 512px cartoons. Baked into
// the atlas they'd be megabytes of PNG; as alpha-VP9 all three cost 340KB and
// the browser's own media pipeline does the decoding and the looping for us.
//
// Three rules this module exists to enforce:
//   1. never in the DOM  — the <video> is created detached and stays detached.
//                          It is a decode source, not a page element, so no
//                          amount of CSS/layout can put a black rectangle over
//                          the pixel art.
//   2. muted + autoplay  — a MUTED video is gesture-free under every autoplay
//                          policy, so stickers animate on a cold load with no
//                          click. (Contrast the jukebox, which must wait.)
//   3. silent failure    — no codec, no file, a rejected play(), a decode that
//                          never produces a frame: draw() no-ops. A sticker is
//                          decoration; it must never draw a black box, throw,
//                          or put anything in the console (the e2e suite
//                          asserts an empty console).
//
// NOT UNIT TESTED, on purpose — same call as engine/input.js. Everything here
// is HTMLVideoElement + CanvasRenderingContext2D behaviour (canPlayType, the
// readyState ladder, drawImage-from-video, the play() promise). A node test
// would be asserting against a hand-written fake of exactly the browser
// behaviour under test, which proves the fake works and nothing else. The real
// coverage is tests/e2e/brand.spec.js, which boots the actual page in Chromium
// and checks the console stays clean and the elements get created.

import { stamp } from './version.js';

// The alpha-VP9 profile our assets are encoded in (profile 0, 8-bit, 4:2:0).
// canPlayType() with a full codecs= string is the only honest capability check;
// a bare 'video/webm' answers 'maybe' on builds with no VP9 decoder at all.
const VP9A = 'video/webm; codecs="vp09.00.10.08"';

/** Can this browser decode our stickers at all? Cheap, cached, never throws. */
let _supported = null;
export function supported() {
  if (_supported !== null) return _supported;
  try {
    const probe = document.createElement('video');
    _supported = probe.canPlayType(VP9A) !== '';
  } catch {
    _supported = false;
  }
  return _supported;
}

/**
 * makeSticker(url) → { draw(ctx, x, y, size), ready(), el }
 *
 * `size` is the drawn WIDTH in virtual pixels; height follows the video's own
 * aspect (our art is square, but nothing here assumes that).
 */
export function makeSticker(url) {
  let dead = !supported();
  let el = null;

  if (!dead) {
    try {
      el = document.createElement('video');
      el.muted = true;                 // rule 2: set BEFORE src, or the
      el.defaultMuted = true;          // autoplay gate can latch on unmuted
      el.loop = true;
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      // A media error is terminal for this sticker: mark it dead so draw()
      // stops even asking, rather than probing a broken element every frame.
      el.addEventListener('error', () => { dead = true; });
      el.src = stamp(url);   // build-stamped: see engine/version.js
      const p = el.play();
      // Rejected play() is EXPECTED on some paths (a policy we didn't predict,
      // a tab that starts hidden). Swallow it — the element keeps autoplay set,
      // so it starts on its own the moment the browser allows it, and until
      // then draw() simply finds readyState < 2 and skips.
      if (p && typeof p.catch === 'function') p.catch(() => { /* decoration */ });
    } catch {
      dead = true; el = null;
    }
  }

  // HAVE_CURRENT_DATA: there is a frame at the current position. Anything less
  // and drawImage() would either throw or paint nothing — checking this is what
  // makes "no black box" true rather than hopeful.
  const ready = () => !dead && !!el && el.readyState >= 2 && el.videoWidth > 0;

  return {
    el,
    ready,
    draw(ctx, x, y, size) {
      if (!ready()) return;
      const h = Math.round(size * (el.videoHeight / el.videoWidth));
      // The world canvas runs imageSmoothingEnabled=false so the 16px tiles and
      // sprites stay crisp. These stickers are 512px cartoon art landing at
      // ~100px, and nearest-neighbour on a 5:1 downscale shreds the linework
      // into aliased confetti. Smoothing is enabled for THIS draw only and the
      // pixel-perfect world state is restored immediately after.
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      try {
        ctx.drawImage(el, Math.round(x), Math.round(y), Math.round(size), h);
      } catch {
        // A frame can go un-decodable between the readyState check and the
        // draw (seek, source change, GPU reset). One bad frame is not a reason
        // to blank the sticker forever, so this does NOT set dead.
      }
      ctx.imageSmoothingEnabled = prev;
    },
    // Device-resolution counterpart to draw(): same virtual-space (x, y, size)
    // args, but the caller passes S (device pixels per virtual pixel) and this
    // draws straight onto the FINAL screen canvas at x*S/y*S/size*S. This is
    // what keeps the 512px source crisp instead of being squashed into the
    // 640x360 buffer and re-stretched by the integer blit — the soft-sticker
    // bug this method exists to fix.
    //
    // Smoothing is handled IN-METHOD, same as draw(): the caller (main.js)
    // still flips imageSmoothingEnabled around the whole overlay pass (so a
    // scene that draws several stickers only pays the state-flip cost once),
    // but drawScaled sets/restores it itself too, so it is also safe to call
    // standalone or interleaved with non-smoothed overlay drawing.
    drawScaled(sctx, S, x, y, size) {
      if (!ready()) return;
      const w = size * S;
      const h = w * (el.videoHeight / el.videoWidth);
      const prev = sctx.imageSmoothingEnabled;
      sctx.imageSmoothingEnabled = true;
      try {
        sctx.drawImage(el, Math.round(x * S), Math.round(y * S), Math.round(w), Math.round(h));
      } catch {
        // see draw(): a bad frame here is not fatal, same non-dead policy.
      }
      sctx.imageSmoothingEnabled = prev;
    },
  };
}

// --- brand registry ---------------------------------------------------------
// The three official stickers, and a cache so the whole page ever builds at
// most three <video> elements. Without this, every replay of the win screen
// would spin up a fresh decoder for art the browser already has resident —
// three scenes deep into a session that's a dozen live 512px video pipelines
// for three pictures.
export const BRAND = {
  wagmi: 'assets/brand/wagmi.webm',
  popper: 'assets/brand/popper.webm',
  rocketride: 'assets/brand/rocketride.webm',
};

const cache = new Map();

/** Cached makeSticker(). Same url in, same sticker out, for the page's life. */
export function getSticker(url) {
  let s = cache.get(url);
  if (!s) { s = makeSticker(url); cache.set(url, s); }
  return s;
}

/**
 * Test probe. The <video> elements are deliberately never in the DOM (rule 1),
 * so document.querySelectorAll('video') finds nothing and an e2e spec has no
 * other way to see how many decoders this page actually opened.
 */
export function stickerStats() {
  return {
    supported: supported(),
    count: cache.size,
    urls: [...cache.keys()],
    ready: [...cache.values()].filter(s => s.ready()).length,
  };
}
