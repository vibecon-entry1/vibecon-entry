import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChunk, stitchChunks, TILE } from '../../web/game/chunks.js';

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
  const L = stitchChunks([A, B], ['first sign']);
  assert.equal(L.wTiles, 8);
  assert.equal(L.hTiles, 3);
  assert.equal(L.solidAt(7, 2), true);
  assert.equal(L.entities.find(e => e.type === 'coin').x, 5 * TILE + 8);
  assert.equal(L.checkpoints[0].x, 7 * TILE + 8);
});

test('stitchChunks rejects mismatched heights', () => {
  assert.throws(() => stitchChunks([['..', 'P.', '##'], ['..', '##']]), /height/);
});
