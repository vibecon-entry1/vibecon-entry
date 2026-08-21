import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTileFrame, floraIndexAt, hash2 } from '../../web/game/tiles.js';
import { parseChunk } from '../../web/game/chunks.js';

// Real level semantics via parseChunk (solid side walls, open bottom), so the
// frame picker is exercised against exactly the solidAt contract play.js
// hands it — not a hand-rolled mock that could drift.

// One grid that stages every SHAPED case: a floating platform (x2..4), a
// one-wide floating column (x7), and a walked floor slab with a pit at x3.
const SHAPES = parseChunk([
  '..P.......',
  '..###..#..',
  '..###..#..',
  '..........',
  '###.######',
  '###.######',
]);

// A wide flat floor (surface row ty=8, bottom row ty=9) for the hash-driven
// variant frames and the flora scatter.
const FLAT = parseChunk([
  ...Array.from({ length: 7 }, () => '.'.repeat(200)),
  'P' + '.'.repeat(199),
  '#'.repeat(200),
  '#'.repeat(200),
]);

test('hash2 is a stable uint32 of both inputs', () => {
  assert.equal(hash2(17, 91), hash2(17, 91));            // pure
  assert.notEqual(hash2(17, 91), hash2(91, 17));         // order matters
  for (const [x, y] of [[0, 0], [-3, 7], [1000, 4211]]) {
    const h = hash2(x, y);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  }
});

test('surface row: plain top + pit-edge L/R orientation', () => {
  // Platform top: pit opens LEFT of x2 → frame 2; RIGHT of x4 → frame 3.
  assert.equal(pickTileFrame(SHAPES, 2, 1), 2);
  assert.equal(pickTileFrame(SHAPES, 4, 1), 3);
  // One-wide column: both sides open — the left check wins, by code order.
  assert.equal(pickTileFrame(SHAPES, 7, 1), 2);
  // Floor beside the pit at x3: x2 has the pit on its RIGHT, x4 on its LEFT.
  assert.equal(pickTileFrame(SHAPES, 2, 4), 3);
  assert.equal(pickTileFrame(SHAPES, 4, 4), 2);
  // Interior platform top is a surface frame (0 or a worn variant).
  assert.ok([0, 5, 6].includes(pickTileFrame(SHAPES, 3, 1)));
});

test('surface variants 0/5/6 all appear on a long flat top, ~25% worn', () => {
  const seen = new Set();
  let worn = 0;
  for (let tx = 1; tx < 199; tx++) {                     // skip the wall-adjacent ends
    const f = pickTileFrame(FLAT, tx, 8);
    assert.ok([0, 5, 6].includes(f), `unexpected surface frame ${f} at ${tx}`);
    if (f !== 0) { seen.add(f); worn++; }
  }
  assert.ok(seen.has(5) && seen.has(6));
  assert.ok(worn > 198 * 0.15 && worn < 198 * 0.35, `worn ratio off: ${worn}/198`);
});

test('underside lip under floating platforms, bounds-guarded on the last row', () => {
  // Bottom row of the floating platform + column: open below → frame 4.
  for (const tx of [2, 3, 4, 7]) assert.equal(pickTileFrame(SHAPES, tx, 2), 4);
  // LAST slab row: below reads open too (pits kill), but the ty+1 bounds
  // guard must keep the whole row from wearing the lip.
  for (let tx = 1; tx < 199; tx++)
    assert.ok([1, 7].includes(pickTileFrame(FLAT, tx, 9)),
              `last row wore a lip at ${tx}`);
});

test('fill rows: ember-fleck variant ~14%, pit walls oriented L/R', () => {
  let flecks = 0;
  for (let tx = 1; tx < 199; tx++) if (pickTileFrame(FLAT, tx, 9) === 7) flecks++;
  assert.ok(flecks > 198 * 0.07 && flecks < 198 * 0.25, `fleck ratio off: ${flecks}/198`);
  // Pit flank rows in SHAPES: x2 row 5 has the pit on its RIGHT → 9; x4 → 8.
  assert.equal(pickTileFrame(SHAPES, 2, 5), 9);
  assert.equal(pickTileFrame(SHAPES, 4, 5), 8);
});

test('variant determinism: same coords always answer the same frame', () => {
  for (let tx = 0; tx < 200; tx += 7) {
    assert.equal(pickTileFrame(FLAT, tx, 8), pickTileFrame(FLAT, tx, 8));
    assert.equal(pickTileFrame(FLAT, tx, 9), pickTileFrame(FLAT, tx, 9));
  }
  assert.equal(pickTileFrame(SHAPES, 3, 1), pickTileFrame(SHAPES, 3, 1));
});

test('floraIndexAt: deterministic sparse scatter, valid indices, intact floor only', () => {
  const floorTy = 8;
  let planted = 0;
  for (let tx = 0; tx < 200; tx++) {
    const fi = floraIndexAt(FLAT, tx, floorTy);
    assert.equal(fi, floraIndexAt(FLAT, tx, floorTy));   // deterministic
    if (fi < 0) continue;
    assert.ok(fi >= 0 && fi <= 7, `flora index out of family: ${fi}`);
    planted++;
  }
  // Density ≈ 1 in 8 columns (hash-gated), loose band so the assert survives
  // any future FLORA_PICK reweighting but still catches a broken gate.
  assert.ok(planted > 10 && planted < 60, `density off: ${planted}/200`);
});

test('floraIndexAt refuses broken floor and blocked headroom', () => {
  // Find a column that DOES plant on the flat floor, then show the same
  // column refuses when the floor opens or the headroom fills in.
  let tx = -1;
  for (let i = 0; i < 200; i++) if (floraIndexAt(FLAT, i, 8) >= 0) { tx = i; break; }
  assert.ok(tx >= 0, 'no planted column found on 200 tiles of flat floor');
  const mask = (blockTy, openTy) => ({
    hTiles: FLAT.hTiles,
    solidAt: (x, y) => (x === tx && y === openTy) ? false
                     : (x === tx && y === blockTy) ? true
                     : FLAT.solidAt(x, y),
  });
  assert.equal(floraIndexAt(mask(null, 8), tx, 8), -1);  // floor gone → no plant
  assert.equal(floraIndexAt(mask(7, null), tx, 8), -1);  // headroom -1 blocked
  assert.equal(floraIndexAt(mask(6, null), tx, 8), -1);  // headroom -2 blocked
});
