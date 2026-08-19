import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCamera } from '../../web/engine/camera.js';

test('converges toward target with lookahead and clamps to bounds', () => {
  const c = makeCamera({ vw: 640, vh: 360 });
  c.snap(0, 0);
  for (let i = 0; i < 300; i++) c.follow(300, 200, 1, 1 / 60, { w: 1600, h: 360 });
  assert.ok(Math.abs(c.x - (300 + 40 - 320)) < 2);   // target + lookahead - vw/2
  assert.equal(c.y, 0);                               // level height == vh → clamped
});

test('never shows outside level', () => {
  const c = makeCamera({ vw: 640, vh: 360 });
  c.snap(-500, -500);
  c.follow(0, 0, -1, 1 / 60, { w: 800, h: 360 });
  assert.ok(c.x >= 0 && c.y >= 0);
});
