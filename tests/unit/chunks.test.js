import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChunk, TILE } from '../../web/game/chunks.js';

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
