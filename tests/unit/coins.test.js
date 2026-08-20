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

test('total() reports the authored coin count, so collected = total - remaining', () => {
  const defs = [{ type: 'coin', x: 10, y: 20 }, { type: 'coin', x: 40, y: 20 },
                { type: 'hopper', x: 70, y: 20 }];
  const C = makeCoins(defs);
  assert.equal(C.total(), 2);
  assert.equal(C.remaining(), 2);
  C.update(1 / 60, { x: 10, y: 42, w: 20, h: 44 }, () => {});
  assert.equal(C.total(), 2);                 // total never moves
  assert.equal(C.total() - C.remaining(), 1); // one collected
});
