import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlayer } from '../../web/game/player.js';
import { parseChunk } from '../../web/game/chunks.js';
import { P } from '../../web/game/physics.js';

const FLAT = parseChunk([
  '............................',
  '............................',
  '............................',
  '............................',
  '............................',
  '..P.........................',
  '############################',
]);
const DT = 1 / 60;
const IDLE = { left: false, right: false, down: false, fire: false };

function drive(pl, level, frames, actions) {
  const fired = [];
  for (let i = 0; i < frames; i++)
    pl.update(DT, { ...IDLE, ...actions(i) }, level, { spawn: (...a) => fired.push(a) });
  return fired;
}

test('spawns in SPAWN state then reaches idle', () => {
  const pl = makePlayer(FLAT.spawn);
  assert.equal(pl.state, 'spawn');
  drive(pl, FLAT, 150, () => ({}));
  assert.equal(pl.state, 'idle');
});

test('runs right and fires forward', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  const x0 = pl.body.x;
  const fired = drive(pl, FLAT, 60, i => ({ right: true, fire: i === 30 }));
  assert.ok(pl.body.x > x0 + 60);
  assert.equal(fired.length, 1);
  assert.equal(fired[0][2], 1);                    // dx = +1 (facing right)
});

test('grounded down-shot hops', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  drive(pl, FLAT, 2, i => ({ down: true, fire: i === 0 }));
  assert.ok(pl.body.vy <= P.HOP_VY + 2 * P.GRAV * DT + 1);
});

test('air charges: 3 boosts then dry, refill on landing', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  drive(pl, FLAT, 2, i => ({ down: true, fire: i === 0 }));          // hop up
  drive(pl, FLAT, 3, () => ({}));                                     // airborne
  for (let k = 0; k < 4; k++)
    drive(pl, FLAT, 10, i => ({ down: true, fire: i === 0 }));        // 4 boost tries
  assert.equal(pl.airCharges, 0);
  drive(pl, FLAT, 300, () => ({}));                                   // fall + land
  assert.equal(pl.state === 'idle' || pl.state === 'walk', true);
  assert.equal(pl.airCharges, P.AIR_CHARGES);
});

test('slide under low ceiling; slide-fire bursts forward and shoots backward', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  drive(pl, FLAT, 30, () => ({ right: true }));
  const fired = drive(pl, FLAT, 8, i => ({ right: true, down: true, fire: i === 4 }));
  assert.equal(pl.state, 'slide');
  assert.equal(pl.body.h, 24);
  assert.equal(fired.at(-1)[2], -1);               // bolt went backward
  assert.ok(pl.body.vx > P.SLIDE_SPEED);           // burst added speed
});

test('slide-fire speed is capped at BURST_MAX', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  drive(pl, FLAT, 30, () => ({ right: true }));
  drive(pl, FLAT, 90, i => ({ right: true, down: true, fire: i % 9 === 0 }));  // burst spam
  assert.ok(Math.abs(pl.body.vx) <= P.BURST_MAX);
});

test('slide off a ledge goes airborne and restores height when clear', () => {
  const LEDGE = parseChunk([
    '............',
    '............',
    '............',
    '............',
    '..P.........',
    '#####.......',
  ]);
  const pl = makePlayer(LEDGE.spawn); drive(pl, LEDGE, 150, () => ({}));
  drive(pl, LEDGE, 10, () => ({ right: true }));                 // short run-up
  drive(pl, LEDGE, 20, () => ({ right: true, down: true }));     // slide off the edge
  assert.equal(pl.state, 'air');
  assert.equal(pl.body.h, 44);                                   // restored in open air
});

test('pit fall respawns at checkpoint in spawn state', () => {
  const PIT = parseChunk(['.......', '.......', '.......', '..P....', '###....']);
  const pl = makePlayer(PIT.spawn); drive(pl, PIT, 150, () => ({}));
  drive(pl, PIT, 400, () => ({ right: true }));
  assert.equal(pl.state, 'spawn');
  assert.equal(pl.body.x, PIT.spawn.x);
  assert.ok(pl.deaths >= 1);
});

test('duck applies friction, no infinite glide', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  drive(pl, FLAT, 30, () => ({ right: true }));
  drive(pl, FLAT, 12, () => ({ down: true }));
  assert.equal(pl.state, 'duck');
  assert.equal(pl.body.vx, 0);
});

test('down-fire on the first playable frame hops, not boosts', () => {
  const pl = makePlayer(FLAT.spawn);
  drive(pl, FLAT, 118, () => ({}));                            // beam ends
  assert.equal(pl.state, 'idle');
  drive(pl, FLAT, 1, () => ({ down: true, fire: true }));
  assert.equal(pl.airCharges, P.AIR_CHARGES);                  // hop is free
  assert.ok(pl.body.vy < -200);
});

test('airborne momentum above RUN persists while holding direction', () => {
  const L2 = parseChunk([
    '............', '............', '............',
    '..P.........',
    '#####.......',
  ]);
  const pl = makePlayer(L2.spawn); drive(pl, L2, 150, () => ({}));
  drive(pl, L2, 8, () => ({ right: true }));
  drive(pl, L2, 16, i => ({ right: true, down: true, fire: i === 2 }));  // slide + burst off the edge
  assert.equal(pl.state, 'air');
  assert.ok(Math.abs(pl.body.vx) > P.RUN + 50);                // launched fast, not clamped
  drive(pl, L2, 6, () => ({ right: true }));
  assert.ok(Math.abs(pl.body.vx) > P.RUN + 20);                // still above RUN under AIR_DRAG
});

test('landing pinned under a ceiling keeps pose matching the hitbox', () => {
  const TUN = parseChunk([
    '..............',
    '..............',
    '......########',
    '..P...........',
    '######........',
    '......########',
  ]);
  const pl = makePlayer(TUN.spawn); drive(pl, TUN, 150, () => ({}));
  drive(pl, TUN, 6, () => ({ right: true }));
  drive(pl, TUN, 40, () => ({ right: true, down: true }));     // slide off the step into the low passage
  assert.ok(pl.body.h < 44);
  assert.ok(pl.state === 'slide' || pl.state === 'duck');
});

test('muzzle origin recorded; cleared by pit respawn', () => {
  const PIT = parseChunk(['.......', '.......', '.......', '..P....', '###....']);
  const pl = makePlayer(PIT.spawn); drive(pl, PIT, 150, () => ({}));
  drive(pl, PIT, 1, () => ({ fire: true }));
  assert.equal(pl.muzzle.x, pl.body.x + pl.facing * 26);
  assert.equal(pl.muzzle.y, pl.body.y - 30);
  drive(pl, PIT, 400, i => ({ right: true, fire: i % 8 === 0 }));
  assert.equal(pl.state, 'spawn');
  assert.equal(pl.muzzle, null);
});
