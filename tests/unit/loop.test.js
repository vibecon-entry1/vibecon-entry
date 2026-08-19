import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepAccumulator, createLoop } from '../../web/engine/loop.js';

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

test('exact-boundary delta produces one step, zero remainder', () => {
  let s = { acc: 0 };
  assert.equal(stepAccumulator(s, 1 / 60, 1 / 60), 1);
  assert.equal(s.acc, 0);
});

test('createLoop: start is idempotent, frames monotonic under fake rAF', () => {
  const cbs = new Map(); let nextId = 1;
  global.requestAnimationFrame = cb => { const id = nextId++; cbs.set(id, cb); return id; };
  global.cancelAnimationFrame = id => { cbs.delete(id); };
  const fire = t => { const pending = [...cbs.values()]; cbs.clear(); pending.forEach(cb => cb(t)); };

  const frames = []; let renders = 0;
  const loop = createLoop({ update: (dt, f) => frames.push(f), render: () => renders++ });
  loop.start();
  loop.start();                       // must not double-register
  assert.equal(cbs.size, 1);
  fire(1000); fire(1020);             // two ticks, 20ms apart
  assert.equal(renders, 2);           // one render per tick, not two
  assert.deepEqual(frames, [0, 1]);   // first tick seeds one dt step, second steps once
  loop.stop();
  fire(2000);
  assert.equal(cbs.size, 0);          // stopped: nothing rescheduled
  delete global.requestAnimationFrame; delete global.cancelAnimationFrame;
});
