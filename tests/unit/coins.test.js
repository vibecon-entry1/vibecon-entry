import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCoins } from '../../web/game/coins.js';

test('magnet pulls near coins; collect fires once inside 14px', () => {
  const C = makeCoins([{ type: 'coin', x: 100, y: 100 }, { type: 'coin', x: 400, y: 100 }]);
  const got = [];
  for (let i = 0; i < 120; i++) C.update(1 / 60, { x: 130, y: 100 }, c => got.push(c));
  assert.equal(got.length, 1);                      // near coin magnetized + collected
  assert.equal(C.remaining(), 1);                   // far coin untouched
});
