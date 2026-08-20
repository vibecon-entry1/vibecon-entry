import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBullets } from '../../web/game/bullets.js';
import { parseChunk } from '../../web/game/chunks.js';

const L = parseChunk(['..........', '..P.......', '####..####']);

test('pool caps at 32 and recycles', () => {
  const B = makeBullets();
  for (let i = 0; i < 40; i++) B.spawn(50, 20, 1, 0);
  assert.equal(B.count(), 32);
});

test('bolt dies on tile hit and spawns a pop that then decays', () => {
  const B = makeBullets();
  B.spawn(8, 24, -1, 0);                    // open air, fires left into x<0 wall
  for (let i = 0; i < 5; i++) B.update(1 / 60, L);
  assert.equal(B.count(), 0);               // died on the wall within 2 frames
  assert.ok(B.pops().length >= 1);          // pop is showing
  for (let i = 0; i < 25; i++) B.update(1 / 60, L);
  assert.equal(B.pops().length, 0);         // pop decayed after 0.3s
});

test('bolt expires after lifetime', () => {
  const B = makeBullets();
  B.spawn(80, 8, 1, 0);                     // open air to the right
  for (let i = 0; i < 40; i++) B.update(1 / 60, L);   // 0.66s > 0.6s life
  assert.equal(B.count(), 0);
});

test('kill() deactivates with a pop; external b.on writes are not the API', () => {
  const B = makeBullets();
  B.spawn(80, 8, 1, 0);
  let victim = null;
  B.forEachHittable(b => victim = b);
  B.kill(victim);
  assert.equal(B.count(), 0);
  assert.equal(B.pops().length, 1);
  B.kill(victim);                                  // idempotent
  assert.equal(B.pops().length, 1);
});

test('spawn bonus inherits shooter momentum (bolt outruns a fast shooter)', () => {
  const B = makeBullets();
  B.spawn(80, 8, 1, 0);            // baseline 380
  B.spawn(80, 8, 1, 0, 420);       // burst-speed shooter → 800
  const xs = [];
  B.update(1 / 60, L);
  B.forEachHittable(b => xs.push(b.x));
  assert.ok(Math.abs(xs[0] - (80 + 380 / 60)) < 0.01);
  assert.ok(Math.abs(xs[1] - (80 + 800 / 60)) < 0.01);
});
