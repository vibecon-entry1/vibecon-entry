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

test('y deadzone: rests at band edge, ignores wiggle inside band', () => {
  const c = makeCamera({ vw: 640, vh: 360 });
  c.snap(0, 88);
  for (let i = 0; i < 300; i++) c.follow(320, 230, 1, 1 / 60, { w: 1600, h: 448 });
  assert.ok(Math.abs(c.y - 74) < 1);                   // gy=50 approached from above → rests at gy+deadY
  const y0 = c.y;
  for (let i = 0; i < 60; i++) c.follow(320, 230 + (i % 2) * 40, 1, 1 / 60, { w: 1600, h: 448 });
  assert.ok(Math.abs(c.y - y0) < 0.001);               // gy 50/90 → dy -24/+16, both inside band
});

test('shake peaks at mag and expires to exact translate', () => {
  const c = makeCamera({ vw: 640, vh: 360 });
  c.snap(100, 50);
  c.shake(6, 0.25);
  const calls = [];
  const ctx = { translate: (x, y) => calls.push([x, y]) };
  c.apply(ctx, () => 1);                               // rng()=1 → offset +mag/2 at peak
  assert.deepEqual(calls[0], [-103, -53]);
  for (let i = 0; i < 20; i++) c.follow(420, 230, 1, 1 / 60, { w: 1600, h: 448 });
  c.snap(100, 50);
  c.apply(ctx, () => 1);
  assert.deepEqual(calls[1], [-100, -50]);             // expired: exact
});
