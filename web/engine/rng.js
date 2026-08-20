// Seeded PRNG. The sim is not allowed to call Math.random anywhere — a run has
// to be reproducible from its seed alone, so an e2e tape replayed against the
// same seed walks the same level, and a shared seed is a shared run.
//
// mulberry32: 32-bit state, one multiply-xorshift round per draw. Chosen over
// an LCG (title.js has one for its starfield) because the low bits of an LCG
// are famously non-random and buildWowZone's tier/chunk picks read exactly
// those bits through small modulos.
export function mulberry32(seed) {
  // >>> 0 pins the state to unsigned 32-bit up front, so a float, a negative
  // number or a Date.now() past 2^32 all seed something well-defined.
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, n). Sugar over the raw float, used by every pick in chunks.js. */
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}
