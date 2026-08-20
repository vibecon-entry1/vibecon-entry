import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBoss } from '../../web/game/boss.js';

const DT = 1 / 60;
const FLOOR_Y = 400;
const SPAWN_X = 1000;
const HOME_Y = FLOOR_Y - 120;

const stubBullets = () => ({ spawned: [], spawn(x, y, dx, dy) { this.spawned.push([x, y, dx, dy]); } });
const farPlayer = { x: -9999, y: 0, w: 0, h: 0 };

test('spawn state: on, hp, position, phase', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  assert.equal(b.on, true);
  assert.equal(b.hp, 40);
  assert.equal(b.hpMax, 40);
  assert.equal(b.x, SPAWN_X);
  assert.equal(b.y, HOME_Y);
  assert.equal(b.phase, 'sweep');
});

test('sweep phase: x oscillates within ±140 of spawn x and returns through center', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  let sawAboveCenter = false, sawBelowCenter = false, sawNearCenter = false;
  for (let i = 0; i < Math.round(5 / DT) - 1; i++) {
    b.update(DT, farPlayer, B, () => {});
    assert.ok(b.x >= SPAWN_X - 140 - 1e-6 && b.x <= SPAWN_X + 140 + 1e-6, `x out of bounds: ${b.x}`);
    if (b.x > SPAWN_X) sawAboveCenter = true;
    if (b.x < SPAWN_X) sawBelowCenter = true;
    if (Math.abs(b.x - SPAWN_X) < 5) sawNearCenter = true;
  }
  assert.ok(sawAboveCenter && sawBelowCenter, 'oscillation did not cross both sides');
  assert.ok(sawNearCenter, 'never returned near center');
  assert.equal(b.phase, 'sweep');   // still in first sweep window (just under 5s)
});

test('phase machine cycles sweep(5s) -> spread(2s) -> sweep(5s) -> slam(~1.6s) -> repeat', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  const step = (secs) => { for (let i = 0; i < Math.round(secs / DT); i++) b.update(DT, farPlayer, B, () => {}); };

  assert.equal(b.phase, 'sweep');
  step(5.01);
  assert.equal(b.phase, 'spread');
  step(2.01);
  assert.equal(b.phase, 'sweep');
  step(5.01);
  assert.equal(b.phase, 'slam');
  step(1.61);
  assert.equal(b.phase, 'sweep');   // cycle repeats
});

test('spread phase: fires 3-bolt fans (-0.5,0,+0.5) every 1.2s, ceil(2/1.2)=2 volleys', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  const step = (secs) => { for (let i = 0; i < Math.round(secs / DT); i++) b.update(DT, farPlayer, B, () => {}); };
  step(5.01);   // enter spread
  assert.equal(b.phase, 'spread');
  step(2.01);   // through spread into next sweep
  assert.equal(b.phase, 'sweep');

  assert.equal(B.spawned.length, 6, `expected 2 volleys of 3 = 6 bolts, got ${B.spawned.length}`);
  for (let v = 0; v < 2; v++) {
    const volley = B.spawned.slice(v * 3, v * 3 + 3);
    const dxs = volley.map(s => s[2]).sort((a, c) => a - c);
    assert.deepEqual(dxs, [-0.5, 0, 0.5]);
    for (const s of volley) assert.equal(s[3], 1);
  }
});

test('slam phase: descends to floorY-40, contact-hurts overlapping player, then rises home', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  const step = (secs, player, cb) => { for (let i = 0; i < Math.round(secs / DT); i++) b.update(DT, player, B, cb); };

  step(5.01, farPlayer, () => {});     // sweep -> spread
  step(2.01, farPlayer, () => {});     // spread -> sweep
  step(5.01, farPlayer, () => {});     // sweep -> slam
  assert.equal(b.phase, 'slam');

  const overlapPlayer = { x: SPAWN_X, y: FLOOR_Y - 40, w: 20, h: 40 };
  let hitFromDuringSlam = null;
  let yAtSlamEnd = null;
  for (let i = 0; i < Math.round(1.61 / DT); i++) {
    const wasSlam = b.phase === 'slam';
    b.update(DT, overlapPlayer, B, x => { if (wasSlam) hitFromDuringSlam = x; });
    if (wasSlam && b.phase === 'sweep' && yAtSlamEnd === null) yAtSlamEnd = b.y;
  }

  assert.ok(hitFromDuringSlam !== null, 'contact damage never fired during slam');
  assert.equal(hitFromDuringSlam, SPAWN_X);
  assert.equal(b.phase, 'sweep');   // slam finished, cycle repeats
  assert.ok(Math.abs(yAtSlamEnd - HOME_Y) < 1, `boss did not rise back home: y=${yAtSlamEnd}`);
});

test('contact-hurts during sweep at hover height when player body overlaps', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  const overlapPlayer = { x: SPAWN_X, y: FLOOR_Y - 40, w: 20, h: 40 };
  let hitFrom = null;
  for (let i = 0; i < 60; i++) b.update(DT, overlapPlayer, B, x => hitFrom = x);
  assert.equal(b.phase, 'sweep');
  assert.ok(hitFrom !== null, 'contact damage never fired during sweep despite body overlap');
});

test('no contact-hurt during sweep for a far-away body', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  const farBody = { x: SPAWN_X - 9999, y: FLOOR_Y - 40, w: 20, h: 40 };
  let hitFrom = null;
  for (let i = 0; i < 60; i++) b.update(DT, farBody, B, x => hitFrom = x);
  assert.equal(b.phase, 'sweep');
  assert.equal(hitFrom, null);
});

test('no contact-hurt during sweep for a w:0 dummy body even when co-located', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  const dummy = { x: SPAWN_X, y: FLOOR_Y - 40, w: 0, h: 40 };
  let hitFrom = null;
  for (let i = 0; i < 60; i++) b.update(DT, dummy, B, x => hitFrom = x);
  assert.equal(b.phase, 'sweep');
  assert.equal(hitFrom, null);
});

test('slam reaches floorY-40 at its lowest point', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  const step = (secs) => { for (let i = 0; i < Math.round(secs / DT); i++) b.update(DT, farPlayer, B, () => {}); };
  step(5.01); step(2.01); step(5.01);
  assert.equal(b.phase, 'slam');
  let minDistToTarget = Infinity;
  for (let i = 0; i < Math.round(1.61 / DT); i++) {
    b.update(DT, farPlayer, B, () => {});
    minDistToTarget = Math.min(minDistToTarget, Math.abs(b.y - (FLOOR_Y - 40)));
  }
  assert.ok(minDistToTarget < 1, `never reached floorY-40, closest was ${minDistToTarget}`);
});

test('hurt: hp decrements, on false only after 40th hit, true returned only on that hit', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  for (let i = 0; i < 39; i++) {
    const dead = b.hurt();
    assert.equal(dead, false);
    assert.equal(b.hp, 39 - i);
    assert.equal(b.on, true);
  }
  const dead = b.hurt();
  assert.equal(dead, true);
  assert.equal(b.hp, 0);
  assert.equal(b.on, false);
});

test('hitTest: generous box |dx|<100 and |dy|<70', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  assert.equal(b.hitTest({ x: SPAWN_X, y: HOME_Y }), true);
  assert.equal(b.hitTest({ x: SPAWN_X + 99, y: HOME_Y + 69 }), true);
  assert.equal(b.hitTest({ x: SPAWN_X + 101, y: HOME_Y }), false);
  assert.equal(b.hitTest({ x: SPAWN_X, y: HOME_Y + 71 }), false);
});

test('update is a no-op once dead (dead boss does not move or fire)', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  for (let i = 0; i < 40; i++) b.hurt();
  assert.equal(b.on, false);
  const x0 = b.x, y0 = b.y, phase0 = b.phase;
  const B = stubBullets();
  let hitFrom = null;
  const overlapPlayer = { x: SPAWN_X, y: HOME_Y, w: 200, h: 200 };
  for (let i = 0; i < 600; i++) b.update(DT, overlapPlayer, B, x => hitFrom = x);
  assert.equal(b.x, x0);
  assert.equal(b.y, y0);
  assert.equal(b.phase, phase0);
  assert.equal(B.spawned.length, 0);
  assert.equal(hitFrom, null);
});

// --- summon phase ---------------------------------------------------------
// Cycle is now sweep -> spread -> sweep -> slam -> sweep -> summon -> repeat.
// The 5th update param, onSummon(defs), fires EXACTLY ONCE per summon phase
// (not once per frame) and hands the scene two floor-level minion defs.
const cycleTo = (b, B, secs, onSummon) => {
  for (let i = 0; i < Math.round(secs / DT); i++) b.update(DT, farPlayer, B, () => {}, onSummon);
};

test('full cycle: sweep -> spread -> sweep -> slam -> sweep -> summon -> sweep', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  assert.equal(b.phase, 'sweep');
  cycleTo(b, B, 5.01); assert.equal(b.phase, 'spread');
  cycleTo(b, B, 2.01); assert.equal(b.phase, 'sweep');
  cycleTo(b, B, 5.01); assert.equal(b.phase, 'slam');
  cycleTo(b, B, 1.61); assert.equal(b.phase, 'sweep');
  cycleTo(b, B, 5.01); assert.equal(b.phase, 'summon');
  cycleTo(b, B, 1.01); assert.equal(b.phase, 'sweep');
  // and the cycle genuinely repeats from the top
  cycleTo(b, B, 5.01); assert.equal(b.phase, 'spread');
});

test('summon calls onSummon exactly once per phase with two floor-level defs', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  const calls = [];
  const on = defs => calls.push(defs);
  cycleTo(b, B, 5.01 + 2.01 + 5.01 + 1.61, on);   // through the first slam
  assert.equal(calls.length, 0, 'summoned before reaching the summon phase');
  cycleTo(b, B, 5.01, on);
  assert.equal(b.phase, 'summon');
  assert.equal(calls.length, 1, `expected one summon call, got ${calls.length}`);
  const defs = calls[0];
  assert.equal(defs.length, 2);
  assert.deepEqual(defs.map(d => d.type).sort(), ['hopper', 'saucer']);
  for (const d of defs) assert.equal(d.y, FLOOR_Y);
  const hop = defs.find(d => d.type === 'hopper'), sau = defs.find(d => d.type === 'saucer');
  assert.equal(hop.x, b.x - 80);
  assert.equal(sau.x, b.x + 80);
  // ...and still exactly one after riding out the rest of the phase
  cycleTo(b, B, 1.01, on);
  assert.equal(b.phase, 'sweep');
  assert.equal(calls.length, 1);
});

test('summon fires again on the NEXT cycle (once more, not twice)', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  const calls = [];
  const on = defs => calls.push(defs);
  cycleTo(b, B, 2 * (5.01 + 2.01 + 5.01 + 1.61 + 5.01 + 1.01), on);
  assert.equal(calls.length, 2, `expected 2 summons over 2 cycles, got ${calls.length}`);
});

test('summon holds x steady (no sweep drift) and fires no bolts', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  // step-until rather than a summed clock: slam is distance-timed (~0.97s, not
  // the 1.6s budget), so a fixed sum lands mid-phase.
  for (let i = 0; i < 3000 && b.phase !== 'summon'; i++) b.update(DT, farPlayer, B, () => {});
  assert.equal(b.phase, 'summon');
  b.update(DT, farPlayer, B, () => {});   // first summon frame parks x at home
  const x0 = b.x;
  assert.equal(x0, SPAWN_X, 'summon did not park the boss at its hover home x');
  const n = B.spawned.length;
  cycleTo(b, B, 0.8);
  assert.equal(b.phase, 'summon');   // 0.8s into a 1s phase
  assert.equal(b.x, x0);
  assert.equal(B.spawned.length, n);
});

test('a dead boss never summons', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  for (let i = 0; i < 40; i++) b.hurt();
  assert.equal(b.on, false);
  const B = stubBullets();
  let calls = 0;
  cycleTo(b, B, 60, () => calls++);
  assert.equal(calls, 0);
});

test('a missing onSummon callback does not throw (4-arg callers still work)', () => {
  const b = makeBoss(SPAWN_X, FLOOR_Y);
  const B = stubBullets();
  for (let i = 0; i < Math.round(25 / DT); i++) b.update(DT, farPlayer, B, () => {});
  assert.ok(['sweep', 'spread', 'slam', 'summon'].includes(b.phase));
});
