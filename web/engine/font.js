// A 5x7 bitmap font, hand-authored, drawn as integer rects.
//
// WHY THIS EXISTS: every screen-space string in the game used to be canvas
// `Npx monospace`. The browser hints and anti-aliases those glyphs into the
// 640x360 offscreen buffer at whatever subpixel positions the metrics land on,
// and then the blit magnifies that grey fringe by the display scale. Even with
// the DPR fix in main.js the text stays the softest thing on screen, because
// the softness is baked into the buffer before any scaling happens.
//
// A bitmap font has no fringe to magnify: each glyph pixel is one filled
// integer rect in the 640x360 buffer, so it survives an integer upscale exactly
// as authored. That is the whole trick.
//
// Scope: CAPS, digits and the punctuation the UI actually uses. Lowercase maps
// to the caps glyph rather than 404-ing, so a stray lowercase string renders
// SHOUTED instead of blank — this is a doge game, that is not a regression.
// In-world text (signs, score popups) deliberately keeps the canvas font: it
// lives in the world at 8px and reads as set dressing, not as UI.

// Row strings, MSB-left, '#' = ink. Five wide, seven tall, no descenders —
// a glyph's box is its full cell, and spacing is added by the caller.
const G = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#..##', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  // Multiplication sign and the interpunct the legend/ledger already use.
  '×': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  '·': ['.....', '.....', '.....', '.##..', '.##..', '.....', '.....'],
  // Ampersand: only the share fallback needs it (it prints a query string on
  // screen for hand-copying), but a URL with a tofu box where its & should be
  // is a URL nobody can retype.
  '&': ['.##..', '#..#.', '#..#.', '.##..', '#.#.#', '#..##', '.##.#'],
  // Em dash, as used by 'MUST START — press X'. Wider than '-' on purpose.
  '—': ['.....', '.....', '.....', '.....', '#####', '.....', '.....'],
};

export const GLYPH_W = 5, GLYPH_H = 7;

/** True if `ch` has a glyph (after the lowercase→caps fold). */
export function hasGlyph(ch) {
  return Object.prototype.hasOwnProperty.call(G, ch.toUpperCase()) ||
         Object.prototype.hasOwnProperty.call(G, ch);
}

// Unknown characters fall back to a filled box, never to nothing: a missing
// glyph should be VISIBLE in a screenshot, not silently eat a character.
const TOFU = ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'];
const glyph = (ch) => G[ch] ?? G[ch.toUpperCase()] ?? TOFU;

/**
 * Pixel width of `text` at `scale`, INCLUDING the inter-glyph gaps but not any
 * trailing gap — so a right-aligned string ends exactly on its last ink column.
 */
export function measure(text, scale = 1, gap = 1) {
  if (!text.length) return 0;
  return (text.length * (GLYPH_W + gap) - gap) * scale;
}

/** Pixel height of one line at `scale`. */
export const lineHeight = (scale = 1) => GLYPH_H * scale;

/**
 * Draw `text` with the current fillStyle. x/y are the TOP-LEFT of the text box
 * (not a baseline — there are no descenders and a baseline would just be an
 * off-by-seven waiting to happen). `align` shifts x for 'center'/'right'.
 * Everything is rounded to whole buffer pixels before any rect is emitted,
 * which is the property that makes the result survive scaling.
 */
export function drawText(ctx, text, x, y, { scale = 1, gap = 1, align = 'left' } = {}) {
  const w = measure(text, scale, gap);
  let px = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  const py = Math.round(y);
  const step = (GLYPH_W + gap) * scale;
  for (const ch of text) {
    const rows = glyph(ch);
    for (let r = 0; r < GLYPH_H; r++) {
      const row = rows[r];
      // Run-length the row: a word of 'MUCH MARS. VERY HOME.' is ~90 rects at
      // one-per-pixel and ~40 when runs are merged, and the merged rects also
      // avoid hairline seams between adjacent fills at fractional scales.
      let c = 0;
      while (c < GLYPH_W) {
        if (row[c] !== '#') { c++; continue; }
        let e = c;
        while (e < GLYPH_W && row[e] === '#') e++;
        ctx.fillRect(px + c * scale, py + r * scale, (e - c) * scale, scale);
        c = e;
      }
    }
    px += step;
  }
  return w;
}

/**
 * drawText with a drop shadow underneath, in `shadow`.
 *
 * The offset is HALF the scale, not the full scale: at the scale-4 title
 * heading a 4px offset put a whole glyph-stroke of shadow beside every stroke
 * of the letter, which read as a doubled image rather than as depth (caught in
 * the DPR visual pass — the old 28px canvas heading had a 2px offset against
 * a 28px cap height, and this keeps that ratio at every scale).
 * `shadowOff` overrides it for a caller that wants something else.
 */
export function drawTextShadow(ctx, text, x, y, opts = {}, fill = '#fff', shadow = '#2a1c33') {
  const off = opts.shadowOff ?? Math.max(1, Math.round((opts.scale ?? 1) / 2));
  ctx.fillStyle = shadow; drawText(ctx, text, x + off, y + off, opts);
  ctx.fillStyle = fill;   return drawText(ctx, text, x, y, opts);
}
