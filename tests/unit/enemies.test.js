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
