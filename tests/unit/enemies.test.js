import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnemies } from '../../web/game/enemies.js';
import { parseChunk } from '../../web/game/chunks.js';

const L = parseChunk([
  '..............',
  '..............',
  '..............',
  '..P...h.....u.',
  '##############',
]);
const DT = 1 / 60;
const stubBullets = () => ({ spawned: [], spawn(x, y, dx, dy) { this.spawned.push([x, y, dx, dy]); } });

test('spawns from level entities with hp and kinds', () => {
  const E = makeEnemies(L.entities, L);
  assert.equal(E.count(), 2);
  const kinds = [];
  E.forEach(e => kinds.push(e.type));
  assert.deepEqual(kinds.sort(), ['hopper', 'saucer']);
});

test('hopper patrols and turns at a ledge instead of walking off', () => {
  const E = makeEnemies(L.entities.filter(e => e.type === 'hopper'), L);
  let h; E.forEach(e => h = e);
  const x0 = h.x, dirs = new Set();
  for (let i = 0; i < 600; i++) { E.update(DT, { x: -999, y: 0 }, stubBullets(), () => {}); dirs.add(Math.sign(h.vx)); }
  assert.ok(dirs.has(1) && dirs.has(-1));            // reversed at least once
  assert.ok(h.y === L.entities[0].y);                 // never fell off
});

test('saucer bobs and fires at a near player on a cooldown', () => {
  const E = makeEnemies(L.entities.filter(e => e.type === 'saucer'), L);
  const B = stubBullets();
  for (let i = 0; i < 200; i++) E.update(DT, { x: 12 * 16 + 8, y: 4 * 16 }, B, () => {});
  assert.ok(B.spawned.length >= 1);
  assert.deepEqual(B.spawned[0].slice(2), [0, 1]);    // straight down bolt
  const far = stubBullets();
  const E2 = makeEnemies(L.entities.filter(e => e.type === 'saucer'), L);
  for (let i = 0; i < 200; i++) E2.update(DT, { x: -999, y: 0 }, far, () => {});
  assert.equal(far.spawned.length, 0);                // out of range: holds fire
});

test('hitTest top slop is 14px (airborne bolts clear the head), sides/bottom 4px', () => {
  const E = makeEnemies(L.entities.filter(e => e.type === 'hopper'), L);
  let h; E.forEach(e => h = e);
  assert.equal(E.hitTest({ x: h.x, y: h.y - h.h - 13 }), h);      // inside the top slop
  assert.equal(E.hitTest({ x: h.x, y: h.y - h.h - 14 }), null);   // exactly on it: out
  assert.equal(E.hitTest({ x: h.x, y: h.y + 3 }), h);             // bottom slop unchanged
  assert.equal(E.hitTest({ x: h.x, y: h.y + 4 }), null);
  assert.equal(E.hitTest({ x: h.x + h.w / 2 + 3, y: h.y - 10 }), h);
  assert.equal(E.hitTest({ x: h.x + h.w / 2 + 4, y: h.y - 10 }), null);
});

// The gun-origin regression guard. Moving the forward-bolt origin from
// body.y-22 to the true gun height body.y-30 raised every forward bolt by 8px,
// which on its own would have cost airborne shots their reach. The top slop
// went 4 -> 14 to pay for it. This pins the RESULT of that trade rather than
// either number: the hero must still be able to be at least as high off the
// ground as before and land a forward bolt on a grounded hopper.
test('gun-height bolts keep the pre-change airborne reach', () => {
  const E = makeEnemies(L.entities.filter(e => e.type === 'hopper'), L);
  let h; E.forEach(e => h = e);
  const GY = h.y;
  // Highest feet-clearance that still connects, measured through the real hitTest.
  let after = -1;
  for (let a = 0; a <= 80; a++) if (E.hitTest({ x: h.x, y: GY - a - 30 })) after = a;
  // Same sweep against the OLD geometry (origin -22, top slop 4), inlined
  // because that code no longer exists to call.
  let before = -1;
  for (let a = 0; a <= 80; a++) {
    const y = GY - a - 22;
    if (y > h.y - h.h - 4 && y < h.y + 4) before = a;
  }
  assert.ok(after >= before,
    `airborne reach regressed: ${after}px now vs ${before}px before`);
});

test('hitTest finds an overlapping bolt and kill removes with callback', () => {
  const E = makeEnemies(L.entities.filter(e => e.type === 'hopper'), L);
  let h; E.forEach(e => h = e);
  const hit = E.hitTest({ x: h.x, y: h.y - 10 });
  assert.equal(hit, h);
  assert.equal(E.hitTest({ x: h.x + 200, y: h.y }), null);
  let killed = null;
  E.kill(hit, e => killed = e);
  assert.equal(killed, h);
  assert.equal(E.count(), 0);
});

test('contact damage fires with enemy x on overlap; silent without', () => {
  const E = makeEnemies(L.entities.filter(e => e.type === 'hopper'), L);
  let h; E.forEach(e => h = e);
  let hitFrom = null;
  E.update(DT, { x: h.x, y: h.y, w: 20, h: 44 }, stubBullets(), x => hitFrom = x);
  assert.equal(hitFrom, h.x);
  hitFrom = null;
  E.update(DT, { x: h.x + 100, y: h.y, w: 20, h: 44 }, stubBullets(), x => hitFrom = x);
  assert.equal(hitFrom, null);
});

test('enemies beyond 1400px sleep (no patrol motion)', () => {
  const E = makeEnemies(L.entities.filter(e => e.type === 'hopper'), L);
  let h; E.forEach(e => h = e);
  const x0 = h.x;
  for (let i = 0; i < 60; i++) E.update(DT, { x: h.x + 1500, y: 0 }, stubBullets(), () => {});
  assert.equal(h.x, x0);
});

// Real death restores the whole roster: killed enemies come back, and the ones
// that merely drifted along their patrol go home too (spawn x/y + kind speed).
test('reviveAll restores killed and drifted enemies', () => {
  const E = makeEnemies(L.entities, L);
  const all = []; E.forEach(e => all.push(e));
  const home = all.map(e => ({ e, x: e.x, y: e.y, vx: e.vx, hp: e.hp }));
  const hopper = all.find(e => e.type === 'hopper');
  for (let i = 0; i < 120; i++) E.update(DT, { x: hopper.x, y: -9999, w: 0 }, stubBullets(), () => {});
  assert.notEqual(hopper.x, home.find(h => h.e === hopper).x);   // drifted off spawn
  hopper.hp = 0;
  E.kill(hopper, () => {});
  assert.equal(E.count(), 1);

  E.reviveAll();
  assert.equal(E.count(), 2);
  for (const h of home) {
    assert.equal(h.e.on, true);
    assert.equal(h.e.x, h.x);
    assert.equal(h.e.y, h.y);
    assert.equal(h.e.vx, h.vx);
    assert.equal(h.e.hp, h.hp);
    assert.equal(h.e.fireCd, 0);
  }
});

// --- boss summons ---------------------------------------------------------
// spawnDef() pushes a live minion into the roster mid-run. It must be a FULL
// roster member (patrols, hittable, killable, contact-damaging) so the scene
// needs zero extra wiring — but flagged `summoned` so reviveAll() deletes it.
test('spawnDef adds a live enemy that patrols, is hittable and killable', () => {
  const E = makeEnemies([], L);
  assert.equal(E.count(), 0);
  const m = E.spawnDef({ type: 'hopper', x: 6 * 16 + 8, y: 4 * 16 });
  assert.ok(m);
  assert.equal(m.summoned, true);
  assert.equal(E.count(), 1);

  const x0 = m.x;
  for (let i = 0; i < 60; i++) E.update(DT, { x: m.x, y: -9999, w: 0 }, stubBullets(), () => {});
  assert.notEqual(m.x, x0);                          // patrols like any hopper

  assert.equal(E.hitTest({ x: m.x, y: m.y - 10 }), m);
  let killed = null;
  E.kill(m, e => killed = e);
  assert.equal(killed, m);
  assert.equal(E.count(), 0);
});

test('spawnDef rejects an unknown kind', () => {
  const E = makeEnemies([], L);
  assert.equal(E.spawnDef({ type: 'nope', x: 0, y: 0 }), null);
  assert.equal(E.count(), 0);
});

test('a summoned saucer fires at a near player like an authored one', () => {
  const E = makeEnemies([], L);
  const m = E.spawnDef({ type: 'saucer', x: 6 * 16 + 8, y: 4 * 16 });
  const B = stubBullets();
  for (let i = 0; i < 200; i++) E.update(DT, { x: m.x, y: 4 * 16, w: 0 }, B, () => {});
  assert.ok(B.spawned.length >= 1);
  assert.deepEqual(B.spawned[0].slice(2), [0, 1]);
});

test('reviveAll DELETES summoned minions while restoring the authored roster', () => {
  const E = makeEnemies(L.entities, L);
  const m = E.spawnDef({ type: 'hopper', x: 6 * 16 + 8, y: 4 * 16 });
  assert.equal(E.count(), 3);
  E.reviveAll();
  assert.equal(E.count(), 2);                        // the two authored ones only
  const kinds = []; E.forEach(e => kinds.push(e));
  assert.equal(kinds.includes(m), false);
});

test('reviveAll drops summoned minions even after they were killed', () => {
  const E = makeEnemies([], L);
  const m = E.spawnDef({ type: 'hopper', x: 6 * 16 + 8, y: 4 * 16 });
  E.kill(m, () => {});
  E.reviveAll();
  assert.equal(E.count(), 0);                        // never comes back
});
