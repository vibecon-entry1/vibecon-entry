import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, randInt } from '../../web/engine/rng.js';

test('same seed produces the same stream', () => {
  const a = mulberry32(12345), b = mulberry32(12345);
  const A = Array.from({ length: 200 }, a);
  const B = Array.from({ length: 200 }, b);
  assert.deepEqual(A, B);
});

test('different seeds diverge', () => {
  const a = Array.from({ length: 50 }, mulberry32(1));
  const b = Array.from({ length: 50 }, mulberry32(2));
  assert.notDeepEqual(a, b);
});

test('every draw is in [0, 1)', () => {
  const r = mulberry32(0xC0FFEE);
  for (let i = 0; i < 5000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('distribution is roughly flat across ten buckets', () => {
  // 100k draws into 10 buckets: a flat generator lands ~10000 each. The band is
  // deliberately wide (±5%) — this is a smoke test for a broken generator (all
  // zeros, a stuck bit, a tiny period), not a statistical certification.
  const r = mulberry32(99);
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 100000; i++) buckets[Math.floor(r() * 10)]++;
  for (const b of buckets) assert.ok(b > 9500 && b < 10500, `skewed bucket: ${b}`);
});

test('seeding is well defined for floats, negatives and >2^32', () => {
  // All three go through >>> 0, so none of them can produce NaN draws.
  for (const seed of [1.7, -5, 2 ** 40 + 7, Date.now()]) {
    const v = mulberry32(seed)();
    assert.ok(Number.isFinite(v) && v >= 0 && v < 1, `bad draw for seed ${seed}`);
  }
});

test('randInt stays inside [0, n)', () => {
  const r = mulberry32(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = randInt(r, 6);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 6);
    seen.add(v);
  }
  assert.equal(seen.size, 6);      // all six faces turn up
});
