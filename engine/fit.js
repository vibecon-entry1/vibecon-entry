// Device-pixel scale for the fixed-resolution game inside a window. Pure math,
// split out of main.js so the sub-640 branch has an offline test surface.
//
// raw >= 1: crisp floors to a whole device-pixel multiple (every game pixel a
// whole count of hardware pixels), fill keeps the fraction. raw < 1 — a
// viewport with fewer device pixels than the game has game pixels (small
// phones, split screens) — BOTH modes keep the fraction: the old clamp to 1
// overflowed the screen, and a canvas hanging off the glass is worse than a
// fractionally-sampled one in either mode.
export function fitScale({ winW, winH, dpr, mode, vw = 640, vh = 360 }) {
  const raw = Math.min(winW * dpr / vw, winH * dpr / vh);
  if (raw < 1) return raw;
  return mode === 'fill' ? raw : Math.floor(raw);
}
