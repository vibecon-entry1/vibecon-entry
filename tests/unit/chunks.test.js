import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChunk, stitchChunks, TILE, GAUNTLET } from '../../web/game/chunks.js';

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
  assert.equal(GAUNTLET.wTiles, 10 * 48);
  assert.equal(GAUNTLET.signs.length, 5);
  assert.ok(GAUNTLET.signs.every(s => s.text.length > 0));
  const byType = {};
  for (const e of GAUNTLET.entities) byType[e.type] = (byType[e.type] ?? 0) + 1;
  assert.equal(byType.hopper, 4);
  assert.equal(byType.redhopper, 2);
  assert.equal(byType.saucer, 4);
  assert.equal(byType.coin, 50);
  assert.ok(byType.coin >= 15);
  assert.equal(GAUNTLET.checkpoints.length, 4);
  // checkpoints open chunks 3, 5, 7 and 9
  assert.deepEqual(GAUNTLET.checkpoints.map(c => Math.floor(c.x / TILE)), [98, 194, 290, 386]);
});

test('carve opens a solid tile', () => {
  const L = parseChunk(['..P.', '####']);
  assert.equal(L.solidAt(3, 1), true);
  L.carve(3, 1);
  assert.equal(L.solidAt(3, 1), false);
});

test('GAUNTLET has boss arena, victory stretch, ship pad', () => {
  assert.equal(GAUNTLET.wTiles, 10 * 48);
  // gate: solid column pair at the arena's right edge, sky-height 3 rows above floor
  assert.ok(GAUNTLET.gate.length >= 6);
  for (const [tx, ty] of GAUNTLET.gate) assert.equal(GAUNTLET.solidAt(tx, ty), true);
  assert.ok(GAUNTLET.bossTrigger > 7 * 48 * 16 && GAUNTLET.bossTrigger < 8 * 48 * 16);
  assert.ok(GAUNTLET.shipPad.x > 9 * 48 * 16);
  assert.equal(GAUNTLET.checkpoints.length, 4);   // + one at C9 start
});

test('GAUNTLET geometry holds the authoring invariants', () => {
  const L = GAUNTLET, FLOOR = 26;                  // floor surface row
  // every pit runs to the level bottom
  for (let tx = 0; tx < L.wTiles; tx++)
    assert.equal(L.solidAt(tx, FLOOR), L.solidAt(tx, L.hTiles - 1),
      `column ${tx}: pit must run to the level bottom`);
  // >= 3 empty rows above every standing surface, except the C5 slide corridor
  const CORR = { x0: 4 * 48 + 18, x1: 4 * 48 + 31 };
  for (let ty = 0; ty < L.hTiles; ty++)
    for (let tx = 0; tx < L.wTiles; tx++) {
      if (!L.solidAt(tx, ty) || L.solidAt(tx, ty - 1)) continue;
      const corridor = ty === FLOOR && tx >= CORR.x0 && tx <= CORR.x1;
      const clear = !L.solidAt(tx, ty - 1) && !L.solidAt(tx, ty - 2) && !L.solidAt(tx, ty - 3);
      assert.ok(corridor || clear, `surface ${tx},${ty} needs 3 empty rows overhead`);
    }
  // the corridor opening is exactly 32px: slab bottom row 23, floor top row 26
  for (let tx = CORR.x0; tx <= CORR.x1; tx++) {
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
