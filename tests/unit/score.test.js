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

test('dock subtracts with no floor: score can go negative', () => {
  const s = makeScore();
  s.onKill(false);                                  // 100
  s.add('coin');                                    // 110
  s.dock(100);
  assert.equal(s.value(), 10);
  s.dock(100);
  assert.equal(s.value(), -90);                     // NOT floored — a death economy exploit guard
  s.dock(100);
  assert.equal(s.value(), -190);
});

test('a real death with nothing banked goes straight to -100', () => {
  const s = makeScore();
  s.dock(100);
  assert.equal(s.value(), -100);
});

test('killEarned accumulates kill points and the WOW+ bonus, never boss or coins', () => {
  const s = makeScore();
  s.add('coin');                                    // 10 — not a kill, not tracked
  s.onKill(false);                                  // +100 kill, killEarned 100
  s.onKill(true); s.onKill(true);                   // airborne double: +100 +100, then WOW+ (+50)
  assert.equal(s.value(), 10 + 100 + 100 + 100 + 50);
  s.add('boss');                                    // +500 — not tracked in killEarned either
  assert.equal(s.value(), 10 + 100 + 100 + 100 + 50 + 500);
  // refundKills only claws back the kill (and WOW+) points, leaving the coin
  // and the boss bonus untouched.
  s.refundKills();
  assert.equal(s.value(), 10 + 500);
});

test('refundKills zeroes killEarned: a second call is a no-op', () => {
  const s = makeScore();
  s.onKill(false);
  s.refundKills();
  assert.equal(s.value(), 0);
  s.refundKills();
  assert.equal(s.value(), 0);                       // nothing left to claw back
});

test('refundKills after dock: the flat penalty is not itself refunded', () => {
  const s = makeScore();
  s.onKill(false);                                  // 100
  s.dock(100);                                      // real death penalty: 0
  s.refundKills();                                   // claws back the 100 that was already docked
  assert.equal(s.value(), -100);
});
