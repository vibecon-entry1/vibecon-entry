import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlayer } from '../../web/game/player.js';
import { parseChunk } from '../../web/game/chunks.js';
import { P, bodyFits } from '../../web/game/physics.js';

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

// Fire precedence: a ground-shot (down held) beats slide-fire, so the burst is
// what you get with down RELEASED mid-slide — or with down held while pinned.
test('slide-fire with down released bursts forward and shoots backward', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  drive(pl, FLAT, 30, () => ({ right: true }));
  drive(pl, FLAT, 1, () => ({ right: true, down: true }));       // enter the slide
  assert.equal(pl.state, 'slide');
  assert.equal(pl.body.h, 24);
  // inside the SLIDE_MIN window the slide survives the release, so fire bursts
  const fired = drive(pl, FLAT, 1, () => ({ right: true, fire: true }));
  assert.equal(pl.state, 'slide');                 // did not hop out
  assert.equal(fired.at(-1)[2], -1);               // bolt went backward
  assert.ok(pl.body.vx > P.SLIDE_SPEED + 100);     // burst added speed (200 → ~326)
  assert.equal(pl.airCharges, P.AIR_CHARGES);      // grounded burst is free
});

test('two bursts inside the slide window cap at BURST_MAX', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  drive(pl, FLAT, 30, () => ({ right: true }));
  drive(pl, FLAT, 1, () => ({ right: true, down: true }));       // slide, vx = SLIDE_SPEED
  drive(pl, FLAT, 1, () => ({ right: true, fire: true }));       // burst 1
  drive(pl, FLAT, 7, () => ({ right: true }));                   // wait out FIRE_CD
  const before = pl.body.vx;
  drive(pl, FLAT, 1, () => ({ right: true, fire: true }));       // burst 2
  assert.equal(pl.state, 'slide');
  assert.ok(before + P.BURST_VX > P.BURST_MAX);                  // uncapped sum overshoots
  assert.equal(pl.body.vx, P.BURST_MAX);                         // clamped exactly
});

test('slide-hop: down+fire on a running slide hops out carrying slide speed', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  drive(pl, FLAT, 30, () => ({ right: true }));
  // the human gesture: direction never released across the down+fire tap
  const fired = drive(pl, FLAT, 1, () => ({ right: true, down: true, fire: true }));
  assert.equal(pl.state, 'air');                                 // hopped, did not slide-burst
  assert.deepEqual(fired.at(-1).slice(2), [0, 1]);               // shot straight down
  assert.ok(pl.body.vy <= P.HOP_VY + P.GRAV * DT + 1);           // full hop velocity
  assert.ok(pl.body.vx >= P.SLIDE_SPEED);                        // slide speed carried into the arc
  assert.equal(pl.airCharges, P.AIR_CHARGES);                    // grounded hop is free
  drive(pl, FLAT, 4, () => ({ right: true }));
  assert.equal(pl.state, 'air');
  assert.equal(pl.body.h, 44);                                   // stand box restored in open air
});

test('pinned under a ceiling: fire with down held bursts, never hops', () => {
  const TUNNEL = parseChunk([
    '..............................',
    '..............................',
    '........######################',   // 2-tile clearance from x=128 on
    '..............................',
    '..P...........................',
    '##############################',
  ]);
  const pl = makePlayer(TUNNEL.spawn); drive(pl, TUNNEL, 150, () => ({}));
  drive(pl, TUNNEL, 30, () => ({ right: true }));
  drive(pl, TUNNEL, 20, () => ({ right: true, down: true }));    // slide in under the ceiling
  assert.equal(pl.state, 'slide');
  assert.ok(!bodyFits(TUNNEL, pl.body.x, pl.body.y, pl.body.w, 44));   // genuinely pinned
  const before = pl.body.vx;
  const fired = drive(pl, TUNNEL, 1, () => ({ right: true, down: true, fire: true }));
  assert.equal(fired.at(-1)[2], -1);                             // backward bolt = burst
  assert.ok(pl.body.vx > before + 100);                          // burst added speed
  assert.ok(pl.body.vy >= 0);                                    // never left the floor
  assert.equal(pl.state, 'slide');
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
  // Stop at the FIRST respawn. The old flat 400-frame right-hold now runs three
  // pit falls (hp 3->2->1->0, the last one a real death that refills to 3), so a
  // fixed frame count can no longer see the single-pit heart cost.
  for (let i = 0; i < 400 && pl.state !== 'spawn'; i++) drive(pl, PIT, 1, () => ({ right: true }));
  assert.equal(pl.state, 'spawn');
  assert.equal(pl.body.x, PIT.spawn.x);
  assert.ok(pl.deaths >= 1);
  assert.equal(pl.hp, 2);                          // the pit cost a heart
});

// M3 gate economy: a pit that takes the LAST heart is a real death, not a soft
// respawn — pit check zeroes hp and hands off to 'ded', whose pit-out shortcut
// owns the single deaths++ and the full-hp respawn the next frame.
test('pit at 1 hp is a real death \u2014 full flow, single count', () => {
  const PIT = parseChunk(['.......', '.......', '.......', '..P....', '###....']);
  const pl = makePlayer(PIT.spawn); drive(pl, PIT, 150, () => ({}));
  pl.hp = 1;
  let sawDed = false;
  for (let i = 0; i < 200 && !sawDed; i++) {
    drive(pl, PIT, 1, () => ({ right: true }));
    if (pl.state === 'ded') sawDed = true;
  }
  assert.ok(sawDed, 'pit at 1 hp routed through the ded flow');
  assert.equal(pl.hp, 0);
  assert.equal(pl.deaths, 0);                      // ded transition does NOT count
  while (pl.state !== 'spawn') drive(pl, PIT, 1, () => ({}));
  assert.equal(pl.deaths, 1);                      // exactly one, from the ded pit-out
  assert.equal(pl.hp, P.HP_MAX);                   // hard respawn refills
  assert.equal(pl.body.x, PIT.spawn.x);
  drive(pl, PIT, 5, () => ({}));
  assert.equal(pl.deaths, 1);                      // no re-entry
});

test('respawn under a low ceiling never embeds, and the gun gets you out', () => {
  const PIN = parseChunk([                        // stalactite over the checkpoint:
    '..............................',             // a 44-stand does not fit at x=104,
    '..............................',             // a 24-slide does
    '......#.......................',
    '..............................',
    '..P...C.......................',
    '############..................',             // pit past x=192
  ]);
  const pl = makePlayer(PIN.spawn); drive(pl, PIN, 150, () => ({}));
  drive(pl, PIN, 14, () => ({ right: true }));
  drive(pl, PIN, 16, () => ({ right: true, down: true }));       // slide under, taking the checkpoint
  assert.deepEqual(pl.checkpoint, PIN.checkpoints[0]);
  drive(pl, PIN, 40, () => ({ right: true }));                   // stand up, run off the ledge
  while (pl.state !== 'spawn') drive(pl, PIN, 1, () => ({}));    // fall into the pit
  assert.equal(pl.deaths, 1);
  assert.equal(pl.body.x, PIN.checkpoints[0].x);
  assert.equal(pl.body.h, 24);                                   // shrunk to fit, not force-stood
  assert.ok(bodyFits(PIN, pl.body.x, pl.body.y, pl.body.w, pl.body.h));   // never embedded
  // worst case: beam out with no input at all, so the pinned pose stalls at vx 0
  while (pl.state === 'spawn') drive(pl, PIN, 1, () => ({}));
  drive(pl, PIN, 2, () => ({}));
  assert.equal(pl.body.vx, 0);
  const x0 = pl.body.x;
  drive(pl, PIN, 40, i => ({ right: true, fire: i % 8 === 0 }));  // pinned bursts = legs
  assert.ok(pl.body.x - x0 > 60, `moved ${pl.body.x - x0}px`);
  assert.equal(pl.body.h, 44);                                    // stood up once clear
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
  drive(pl, L2, 1, () => ({ right: true, down: true }));         // slide
  drive(pl, L2, 1, () => ({ right: true, fire: true }));         // burst (down released)
  drive(pl, L2, 14, () => ({ right: true }));                    // ride it off the edge
  assert.equal(pl.state, 'air');
  assert.ok(Math.abs(pl.body.vx) > P.RUN + 50);                // launched fast, not clamped
  drive(pl, L2, 6, () => ({ right: true }));
  assert.ok(Math.abs(pl.body.vx) > P.RUN + 20);                // still above RUN under AIR_DRAG
});

test('pose always matches a shrunken hitbox (no stand pose in a slide box)', () => {
  const LOW = parseChunk([
    '..............',
    '......########',   // ceiling y16..32: clears a 24-slide at feet 64, blocks a 44-stand
    '..............',
    '..P...........',
    '#####.........',   // step floor tx0..4; support lost at x >= 90
    '..............',
  ]);
  const pl = makePlayer(LOW.spawn); drive(pl, LOW, 150, () => ({}));
  drive(pl, LOW, 6, () => ({ right: true }));
  let shrunk = 0;
  for (let i = 0; i < 30; i++) {
    drive(pl, LOW, 1, () => ({ right: true, down: true }));
    if (pl.body.h < 44) { shrunk++; assert.ok(pl.state === 'slide' || pl.state === 'duck'); }
  }
  assert.ok(shrunk > 0);
});

test('muzzle origin recorded; cleared by pit respawn', () => {
  const PIT = parseChunk(['.......', '.......', '.......', '..P....', '###....']);
  const pl = makePlayer(PIT.spawn); drive(pl, PIT, 150, () => ({}));
  drive(pl, PIT, 1, () => ({ fire: true }));
  assert.equal(pl.muzzle.x, pl.body.x + pl.facing * 26);
  assert.equal(pl.muzzle.y, pl.body.y - 22);
  drive(pl, PIT, 400, i => ({ right: true, fire: i % 8 === 0 }));
  assert.equal(pl.state, 'spawn');
  assert.equal(pl.muzzle, null);
});

test('duck-hop under a low ceiling holds the duck pose airborne', () => {
  const SHORT = parseChunk([                      // 48px clearance: a stand box fits while
    '............................',               // grounded, but the hop lifts it into the
    '............................',               // out-of-bounds ceiling, so it never fits
    '..P.........................',               // mid-air (the 7-row FLAT is too roomy)
    '############################',
  ]);
  const pl = makePlayer(SHORT.spawn); drive(pl, SHORT, 150, () => ({}));
  drive(pl, SHORT, 1, () => ({ down: true }));                  // duck (h 32)
  drive(pl, SHORT, 2, i => ({ down: true, fire: i === 0 }));    // duck-hop
  let sawShrunkAirborne = false;
  for (let i = 0; i < 10; i++) {
    drive(pl, SHORT, 1, () => ({}));
    if (pl.body.h < 44) {
      sawShrunkAirborne = true;
      assert.ok(pl.state === 'duck' || pl.state === 'slide');
    }
  }
  assert.ok(sawShrunkAirborne);
  assert.ok(pl.stateT > 0.1);   // pose held continuously, not re-entered every frame
});

test('hurt: hp drops, knockback away from source, iframes block repeats', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  pl.hurt(pl.body.x + 30);                          // hit from the right
  assert.equal(pl.hp, 2);
  assert.equal(pl.state, 'hit');
  assert.ok(pl.body.vx < 0 && pl.body.vy < 0);      // knocked left+up
  pl.hurt(pl.body.x + 30);
  assert.equal(pl.hp, 2);                            // iframes swallowed it
  drive(pl, FLAT, 40, () => ({}));
  assert.ok(pl.state === 'idle' || pl.state === 'walk' || pl.state === 'air');
});

test('hp 0 → ded → beam respawn at checkpoint with full hp', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  pl.hurt(pl.body.x + 30);
  drive(pl, FLAT, 80, () => ({}));                   // iframes expire (1.2s = 72f)
  pl.hurt(pl.body.x + 30);
  drive(pl, FLAT, 80, () => ({}));
  pl.hurt(pl.body.x + 30);
  assert.equal(pl.state, 'ded');
  const before = pl.deaths;
  drive(pl, FLAT, 120, () => ({ right: true, fire: true }));   // input ignored while ded
  assert.equal(pl.state, 'spawn');                   // 1.5s corpse then beam
  assert.equal(pl.hp, 3);
  assert.equal(pl.deaths, before + 1);
});

test('hurt is a no-op during spawn beam', () => {
  const pl = makePlayer(FLAT.spawn);
  pl.hurt(0);
  assert.equal(pl.hp, 3);
  assert.equal(pl.state, 'spawn');
});

test('hit state itself blocks hurt even if iframes were zeroed', () => {
  const pl = makePlayer(FLAT.spawn); drive(pl, FLAT, 150, () => ({}));
  pl.hurt(pl.body.x + 30);
  pl.iframes = 0;                                    // simulate future tuning
  pl.hurt(pl.body.x + 30);
  assert.equal(pl.hp, 2);                            // state guard held
});

test('corpse falling into a pit respawns promptly, single death', () => {
  const PIT = parseChunk(['.......', '.......', '.......', '..P....', '###....']);
  const pl = makePlayer(PIT.spawn); drive(pl, PIT, 150, () => ({}));
  drive(pl, PIT, 20, () => ({ right: true }));
  pl.hp = 1; pl.hurt(pl.body.x - 30);                // knocked right, dies over the pit
  assert.equal(pl.state, 'ded');
  drive(pl, PIT, 60, () => ({}));                    // pit shortcut beats the 1.5s timer
  assert.equal(pl.state, 'spawn');
  assert.equal(pl.deaths, 1);
});
