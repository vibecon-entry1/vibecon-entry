import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeScore } from '../../web/game/score.js';

test('kills and coins score; airborne multi-kill pops WOW+', () => {
  const s = makeScore();
  s.add('coin');
  assert.equal(s.value(), 10);
  s.onKill(false);
  assert.equal(s.value(), 110);
  s.onKill(true); s.onKill(true);                   // two kills in one flight
  const ev = s.takeEvents();
  assert.ok(ev.includes('WOW+'));
  assert.equal(s.value(), 110 + 100 + 100 + 50);    // +50 WOW+ bonus
  s.onLand();
  s.onKill(true);
  assert.ok(!s.takeEvents().includes('WOW+'));      // flight reset
});

test('dock subtracts and floors at zero', () => {
  const s = makeScore();
  s.onKill(false);                                  // 100
  s.add('coin');                                    // 110
  s.dock(100);
  assert.equal(s.value(), 10);
  s.dock(100);
  assert.equal(s.value(), 0);                       // floored, never negative
  s.dock(100);
  assert.equal(s.value(), 0);
});
