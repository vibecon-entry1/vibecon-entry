import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTileFrame, floraIndexAt, hash2,
         TILE_PERIOD, FILL_DEPTH } from '../../web/game/tiles.js';
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

test('surface row: phased crust + pit-edge L/R orientation', () => {
  // Platform top: pit opens LEFT of x2 → frame 128; RIGHT of x4 → frame 129.
  assert.equal(pickTileFrame(SHAPES, 2, 1), 128);
  assert.equal(pickTileFrame(SHAPES, 4, 1), 129);
  // One-wide column: both sides open — the left check wins, by code order.
  assert.equal(pickTileFrame(SHAPES, 7, 1), 128);
  // Floor beside the pit at x3: x2 has the pit on its RIGHT, x4 on its LEFT.
  assert.equal(pickTileFrame(SHAPES, 2, 4), 129);
  assert.equal(pickTileFrame(SHAPES, 4, 4), 128);
  // Interior platform top wears its x-phase surface window.
  assert.equal(pickTileFrame(SHAPES, 3, 1), 3);
});

test('surface course meshes: frame = tx mod 16 along a long flat top', () => {
  for (let tx = 1; tx < 199; tx++) {                     // skip the wall-adjacent ends
    const f = pickTileFrame(FLAT, tx, 8);
    assert.equal(f, tx % TILE_PERIOD, `surface phase off at ${tx}: ${f}`);
  }
  // negative coordinates still answer a valid phase (pure modular math)
  const f = pickTileFrame({ hTiles: 4, solidAt: (x, y) => y >= 2 }, -3, 2);
  assert.ok(f >= 0 && f < TILE_PERIOD, `negative tx phase broke: ${f}`);
});

test('underside lip under floating platforms, bounds-guarded on the last row', () => {
  // Bottom row of the floating platform + column: open below → frame 130.
  for (const tx of [2, 3, 4, 7]) assert.equal(pickTileFrame(SHAPES, tx, 2), 130);
  // LAST slab row: below reads open too (pits kill), but the ty+1 bounds
  // guard must keep the whole row from wearing the lip.
  for (let tx = 1; tx < 199; tx++)
    assert.ok(pickTileFrame(FLAT, tx, 9) >= 16 && pickTileFrame(FLAT, tx, 9) < 128,
              `last row wore a non-fill frame at ${tx}`);
});

test('fill rows: depth-indexed courses, phase-meshed, pit walls oriented L/R', () => {
  // FLAT floor: surface ty=8, so ty=9 is depth 1 → frames 16..31 by phase.
  for (let tx = 1; tx < 199; tx++)
    assert.equal(pickTileFrame(FLAT, tx, 9), 16 + (tx % TILE_PERIOD),
                 `depth-1 fill off at ${tx}`);
  // A deep slab: surface at ty=2, fill to ty=12 — each row wears its own
  // course until the cap, then reuses the darkest (depth 7) course.
  const DEEP = { hTiles: 13, solidAt: (x, y) => y >= 2 && y < 13 };
  for (let d = 1; d <= 10; d++) {
    const f = pickTileFrame(DEEP, 37, 2 + d);
    const want = 16 + (Math.min(d, FILL_DEPTH) - 1) * 16 + (37 % TILE_PERIOD);
    assert.equal(f, want, `depth ${d} course off: ${f} != ${want}`);
  }
  // Pit flank rows in SHAPES: x2 row 5 has the pit on its RIGHT → 132; x4 → 131.
  assert.equal(pickTileFrame(SHAPES, 2, 5), 132);
  assert.equal(pickTileFrame(SHAPES, 4, 5), 131);
});

test('determinism: same coords always answer the same frame', () => {
  for (let tx = 0; tx < 200; tx += 7) {
    assert.equal(pickTileFrame(FLAT, tx, 8), pickTileFrame(FLAT, tx, 8));
    assert.equal(pickTileFrame(FLAT, tx, 9), pickTileFrame(FLAT, tx, 9));
  }
  assert.equal(pickTileFrame(SHAPES, 3, 1), pickTileFrame(SHAPES, 3, 1));
});

test('horizontal neighbours wear consecutive band windows (the mesh contract)', () => {
  // The super-pattern only reads as continuous stone if adjacent cells pull
  // adjacent 16px windows of the band, on the surface AND every fill course.
  for (let tx = 1; tx < 198; tx++) {
    const a = pickTileFrame(FLAT, tx, 8), b = pickTileFrame(FLAT, tx + 1, 8);
    assert.equal((a + 1) % TILE_PERIOD, b % TILE_PERIOD, `surface mesh broke at ${tx}`);
    const c = pickTileFrame(FLAT, tx, 9), e = pickTileFrame(FLAT, tx + 1, 9);
    assert.equal((c - 16 + 1) % TILE_PERIOD, (e - 16) % TILE_PERIOD,
                 `fill mesh broke at ${tx}`);
  }
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
