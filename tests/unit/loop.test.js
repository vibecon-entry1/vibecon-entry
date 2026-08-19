import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepAccumulator } from '../../web/engine/loop.js';

test('accumulates fixed steps at 60hz', () => {
  let s = { acc: 0 };
  assert.equal(stepAccumulator(s, 0.05, 1 / 60), 3);           // 50ms → 3 steps
  assert.ok(Math.abs(s.acc - (0.05 - 3 / 60)) < 1e-9);          // remainder kept
});

test('clamps runaway deltas to 100ms', () => {
  let s = { acc: 0 };
  assert.equal(stepAccumulator(s, 5.0, 1 / 60), 6);             // 100ms cap → 6 steps
});

test('no step until threshold', () => {
  let s = { acc: 0 };
  assert.equal(stepAccumulator(s, 0.01, 1 / 60), 0);
  assert.equal(stepAccumulator(s, 0.01, 1 / 60), 1);            // 20ms total → 1
});
