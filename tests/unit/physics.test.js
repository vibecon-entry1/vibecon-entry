import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveAndCollide, bodyFits, P } from '../../web/game/physics.js';
import { parseChunk } from '../../web/game/chunks.js';

const L = parseChunk([
  '..........',
  '..........',
  '..P.......',
  '####...###',
]);
const DT = 1 / 60;

function body(x, y, vx = 0, vy = 0) { return { x, y, w: 20, h: 44, vx, vy }; }

test('falls and lands exactly on tile top', () => {
  const b = body(24, 30, 0, 0);
  for (let i = 0; i < 120; i++) { b.vy = Math.min(b.vy + P.GRAV * DT, P.MAX_FALL); moveAndCollide(b, L, DT); }
  assert.equal(b.y, 48);                       // floor top = row 3 * 16
});

test('landing sets onGround, air does not', () => {
  const b = body(24, 48, 0, 10);
  assert.equal(moveAndCollide(b, L, DT).onGround, true);
  const a = body(24, 20, 0, -50);
  assert.equal(moveAndCollide(a, L, DT).onGround, false);
});

test('wall stops horizontal motion', () => {
  const b = body(24, 48, -500, 0);             // sprint into left wall (x<0 solid)
  for (let i = 0; i < 30; i++) moveAndCollide(b, L, DT);
  assert.equal(b.x, 10);                       // w/2 against x=0 wall
  assert.equal(b.vx, 0);
});

test('falls through the gap (pit)', () => {
  const b = body(88, 48, 0, 0);                // over the '...' gap at cols 4-6
  for (let i = 0; i < 90; i++) { b.vy = Math.min(b.vy + P.GRAV * DT, P.MAX_FALL); moveAndCollide(b, L, DT); }
  assert.ok(b.y > L.h);                        // exited the bottom
});

test('ceiling bonk zeroes vy', () => {
  const b = body(24, 40, 0, -400);
  let r; for (let i = 0; i < 10; i++) r = moveAndCollide(b, L, DT);
  assert.equal(b.vy >= 0, true);
});

test('right wall rests flush at exact position', () => {
  const b = body(130, 48, 500, 0);             // sprint into right OOB wall (x>=160 solid)
  for (let i = 0; i < 30; i++) moveAndCollide(b, L, DT);
  assert.equal(b.x, 150);                      // 160 - w/2, no EPS residue
  assert.equal(b.vx, 0);
});

test('ceiling bonk rests flush at exact position', () => {
  const b = body(24, 40, 0, -400);
  const r = moveAndCollide(b, L, DT);          // head crosses y=0 into ty=-1 (solid)
  assert.equal(r.hitCeil, true);
  assert.equal(b.y, 44);                       // head flush with level top: y = 0 + h
  assert.equal(b.vy, 0);
});

test('bodyFits: open space fits, embedded in floor does not', () => {
  assert.equal(bodyFits(L, 24, 48, 20, 44), true);
  assert.equal(bodyFits(L, 24, 60, 20, 44), false);   // feet below floor top
});

test('walking off a ledge transitions onGround false mid-run', () => {
  const b = body(40, 48, 150, 0);
  const grounded = [];
  for (let i = 0; i < 40; i++) {
    b.vy = Math.min(b.vy + P.GRAV * DT, P.MAX_FALL);
    grounded.push(moveAndCollide(b, L, DT).onGround);
  }
  assert.equal(grounded[0], true);
  assert.equal(grounded.at(-1), false);
  assert.ok(b.x > 64);                                // actually reached the gap
});

test('hitWall and hitCeil report on the colliding step', () => {
  const w = body(12, 48, -500, 0);
  assert.equal(moveAndCollide(w, L, DT).hitWall, true);
  const c = body(24, 40, 0, -400);
  assert.equal(moveAndCollide(c, L, DT).hitCeil, true);
});
