import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChunk, stitchChunks, TILE, buildGauntlet } from '../../web/game/chunks.js';

const GAUNTLET = buildGauntlet();   // read-only in this file; one shared instance is fine

const MINI = [
  '..........',
  '..P...C...',
  '####..####',
];

test('parses dimensions and tiles', () => {
  const L = parseChunk(MINI);
  assert.equal(L.wTiles, 10);
  assert.equal(L.hTiles, 3);
  assert.equal(L.solidAt(0, 2), true);
  assert.equal(L.solidAt(4, 2), false);          // the gap
  assert.equal(L.solidAt(-1, 2), true);           // out of bounds = solid walls
  assert.equal(L.solidAt(3, 99), false);          // below level = open (pit)
});

test('spawn and checkpoints are feet positions on tile centers', () => {
  const L = parseChunk(MINI);
  assert.deepEqual(L.spawn, { x: 2 * TILE + TILE / 2, y: 2 * TILE });
  assert.deepEqual(L.checkpoints, [{ x: 6 * TILE + TILE / 2, y: 2 * TILE }]);
});

test('ragged rows throw', () => {
  assert.throws(() => parseChunk(['....', '..P', '####']), /width/);
});

test('missing P throws', () => {
  assert.throws(() => parseChunk(['....', '####']), /no P/);
});

test('duplicate P throws', () => {
  assert.throws(() => parseChunk(['P..P', '####']), /multiple P/);
});

test('entity and sign legends parse to feet positions', () => {
  const L = parseChunk([
    '..P.......',
    '.h..u..$.S',
    '##########',
  ]);
  assert.deepEqual(L.entities, [
    { type: 'hopper', x: 1 * TILE + 8, y: 2 * TILE },
    { type: 'saucer', x: 4 * TILE + 8, y: 2 * TILE },
    { type: 'coin', x: 7 * TILE + 8, y: 2 * TILE },
  ]);
  assert.deepEqual(L.signs, [{ x: 9 * TILE + 8, y: 2 * TILE, text: '' }]);
});

test('stitchChunks concatenates horizontally and offsets entities/signs', () => {
  const A = ['....', 'P.h.', '####'];
  const B = ['....', '.$.C', '####'];
  const L = stitchChunks([A, B]);
  assert.equal(L.wTiles, 8);
  assert.equal(L.hTiles, 3);
  assert.equal(L.solidAt(7, 2), true);
  assert.equal(L.entities.find(e => e.type === 'coin').x, 5 * TILE + 8);
  assert.equal(L.checkpoints[0].x, 7 * TILE + 8);
});

test('stitchChunks rejects mismatched heights', () => {
  assert.throws(() => stitchChunks([['..', 'P.', '##'], ['..', '##']]), /height/);
});

test('stitchChunks demands exact signTexts count', () => {
  assert.throws(() => stitchChunks([['..', 'PS', '##']]), /signTexts/);
  assert.throws(() => stitchChunks([['..', 'PS', '##']], ['a', 'b']), /signTexts/);
});

test('GAUNTLET stitches clean with expected population', () => {
  assert.equal(GAUNTLET.hTiles, 34);
  assert.equal(GAUNTLET.wTiles, 31 * 48);          // C1-C7 + E1-E21 + C8/C9/C10 = 1488 tiles
  assert.equal(GAUNTLET.signs.length, 6);          // 5 tutorial + E1's 'much danger ahead'
  assert.ok(GAUNTLET.signs.every(s => s.text.length > 0));
  // Counted off the authored ASCII, not a target: 13 hoppers / 6 red hoppers /
  // 10 saucers / 101 coins were added across E1-E21 on top of the originals.
  const byType = {};
  for (const e of GAUNTLET.entities) byType[e.type] = (byType[e.type] ?? 0) + 1;
  assert.equal(byType.hopper, 17);                 // 4 original + 13 escalation
  assert.equal(byType.redhopper, 8);               // 2 original + 6 escalation
  assert.equal(byType.saucer, 14);                 // 4 original + 10 escalation
  assert.equal(byType.coin, 151);                  // 50 original + 101 escalation
  assert.ok(byType.coin >= 15);
  assert.equal(GAUNTLET.checkpoints.length, 11);
  // checkpoints open C3, C5, C7 (chunks 2/4/6), then E2, E5, E8, E11, E14, E17,
  // E20 (chunks 8/11/14/17/20/23/26), then C9 (chunk 29). All at chunk col 2.
  assert.deepEqual(GAUNTLET.checkpoints.map(c => Math.floor(c.x / TILE)),
    [98, 194, 290, 386, 530, 674, 818, 962, 1106, 1250, 1394]);
  assert.deepEqual(GAUNTLET.checkpoints.map(c => Math.floor(c.x / TILE)),
    [2, 4, 6, 8, 11, 14, 17, 20, 23, 26, 29].map(i => i * 48 + 2));
});

test('carve opens a solid tile', () => {
  const L = parseChunk(['..P.', '####']);
  assert.equal(L.solidAt(3, 1), true);
  L.carve(3, 1);
  assert.equal(L.solidAt(3, 1), false);
});

test('GAUNTLET has boss arena, victory stretch, ship pad', () => {
  assert.equal(GAUNTLET.wTiles, 31 * 48);
  // gate: solid column pair at the arena's right edge, running the FULL height
  // of C8's authored block (14 rows x 2 cols = 28 tiles). Three rows was
  // hoppable — a hop + 3-boost chain lifts the feet ~217px, over a 48px wall.
  assert.equal(GAUNTLET.gate.length, 28);
  const gcols = [...new Set(GAUNTLET.gate.map(([tx]) => tx))].sort((a, b) => a - b);
  assert.deepEqual(gcols, [1390, 1391]);           // C8 is chunk 28 now: 28*48 + 46/47
  const grows = [...new Set(GAUNTLET.gate.map(([, ty]) => ty))].sort((a, b) => a - b);
  assert.equal(grows[0], 12);                       // top = first authored row (12 sky rows above)
  assert.equal(grows.at(-1), 25);                   // bottom = the row on the floor
  assert.equal(grows.length, 14);
  // gate is recorded row-major, so at(-1) is the BOTTOM tile — what play.js
  // anchors the 'gate very open.' popup to.
  assert.deepEqual(GAUNTLET.gate.at(-1), [1391, 25]);
  // the wall out-tops any boost chain: 26 - 12 = 14 rows = 224px of solid
  // above the floor, vs a ~217px ceiling on hop + 3 boosts.
  assert.ok((26 - grows[0]) * TILE > 217);
  for (const [tx, ty] of GAUNTLET.gate) assert.equal(GAUNTLET.solidAt(tx, ty), true);
  assert.ok(GAUNTLET.bossTrigger > 28 * 48 * 16 && GAUNTLET.bossTrigger < 29 * 48 * 16);
  assert.equal(GAUNTLET.bossTrigger, (28 * 48 + 8) * TILE);
  assert.ok(GAUNTLET.shipPad.x > 30 * 48 * 16);
  assert.equal(GAUNTLET.checkpoints.length, 11);  // 10 + one at C9 start
});

test('GAUNTLET geometry holds the authoring invariants', () => {
  const L = GAUNTLET, FLOOR = 26;                  // floor surface row
  // every pit runs to the level bottom
  for (let tx = 0; tx < L.wTiles; tx++)
    assert.equal(L.solidAt(tx, FLOOR), L.solidAt(tx, L.hTiles - 1),
      `column ${tx}: pit must run to the level bottom`);
  // >= 3 empty rows above every standing surface, except the slide corridors.
  // FOUR of them now: C5's original plus E5, E13 and E17. Each entry is the
  // chunk-local column span of that chunk's authored-row-11 slab; extending
  // this list is the honest price of authoring a new corridor, and the 32px
  // assertion below is what keeps the exception from being a blank cheque.
  const CORRIDORS = [
    { chunk: 4,  x0: 18, x1: 31 },   // C5  — the teaching corridor
    { chunk: 11, x0: 20, x1: 33 },   // E5  — tier 2, longer
    { chunk: 19, x0: 6,  x1: 17 },   // E13 — corridor into a 10-wide canyon
    { chunk: 23, x0: 8,  x1: 21 },   // E17 — corridor into an 11-wide canyon
  ].map(c => ({ x0: c.chunk * 48 + c.x0, x1: c.chunk * 48 + c.x1 }));
  const inCorridor = tx => CORRIDORS.some(c => tx >= c.x0 && tx <= c.x1);
  for (let ty = 0; ty < L.hTiles; ty++)
    for (let tx = 0; tx < L.wTiles; tx++) {
      if (!L.solidAt(tx, ty) || L.solidAt(tx, ty - 1)) continue;
      const corridor = ty === FLOOR && inCorridor(tx);
      const clear = !L.solidAt(tx, ty - 1) && !L.solidAt(tx, ty - 2) && !L.solidAt(tx, ty - 3);
      assert.ok(corridor || clear, `surface ${tx},${ty} needs 3 empty rows overhead`);
    }
  // every corridor opening is exactly 32px: slab bottom row 23, floor top row 26
  for (const c of CORRIDORS)
    for (let tx = c.x0; tx <= c.x1; tx++) {
      assert.ok(L.solidAt(tx, 23), `corridor slab missing at ${tx}`);
      assert.ok(!L.solidAt(tx, 24) && !L.solidAt(tx, 25), `corridor must be open at ${tx}`);
    }
  assert.equal((FLOOR - 24) * TILE, 32);
  // hoppers stand ON a floor; saucers are allowed to float
  for (const e of GAUNTLET.entities) {
    if (e.type === 'saucer' || e.type === 'coin') continue;
    assert.ok(L.solidAt(Math.floor(e.x / TILE), Math.floor(e.y / TILE)),
      `${e.type} at ${e.x},${e.y} is not floor-aligned`);
  }
});

test('buildGauntlet returns independent instances (carve does not leak)', () => {
  const a = buildGauntlet();
  const [tx, ty] = a.gate[0];
  a.carve(tx, ty);
  assert.equal(a.solidAt(tx, ty), false);
  const b = buildGauntlet();
  assert.equal(b.solidAt(tx, ty), true);
});
