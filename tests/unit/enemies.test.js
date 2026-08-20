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
