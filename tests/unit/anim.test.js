import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animFrame, animDone } from '../../web/engine/assets.js';

const loop = { frames: [10, 11, 12, 13], fps: 10, loop: true };
const once = { frames: [5, 6, 7], fps: 10, loop: false };

test('looping anim wraps', () => {
  assert.equal(animFrame(loop, 0), 10);
  assert.equal(animFrame(loop, 0.35), 13);
  assert.equal(animFrame(loop, 0.45), 10);       // wrapped
});

test('once anim clamps on last frame', () => {
  assert.equal(animFrame(once, 0.05), 5);
  assert.equal(animFrame(once, 99), 7);
});

test('animDone only for non-looping', () => {
  assert.equal(animDone(once, 0.31), true);
  assert.equal(animDone(once, 0.29), false);
  assert.equal(animDone(loop, 99), false);
});
