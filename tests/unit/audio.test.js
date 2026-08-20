import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFirst, nextIndex } from '../../web/engine/audio.js';
import { makeSave } from '../../web/engine/save.js';

function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m };
}

test('pickFirst never returns lastFirst, and covers the rest of the pool', () => {
  // A stubbed rnd walks every slot in turn: the one that WOULD land on
  // lastFirst must be re-rolled away, and every other slot must be reachable.
  const seen = new Set();
  for (const roll of [0, 0.26, 0.5, 0.76]) {
    const i = pickFirst(4, 2, () => roll);
    assert.notEqual(i, 2, `roll ${roll} returned the forbidden index`);
    seen.add(i);
  }
  assert.deepEqual([...seen].sort(), [0, 1, 3]);

  // Exhaustive over a real Math.random, both pool sizes the manifest ships.
  for (const len of [2, 4]) {
    for (let last = 0; last < len; last++)
      for (let k = 0; k < 200; k++) assert.notEqual(pickFirst(len, last, Math.random), last);
  }
  // Degenerate inputs must not hang or go out of bounds.
  assert.equal(pickFirst(1, 0), 0);
  assert.equal(pickFirst(0, 0), 0);
  assert.ok(pickFirst(2, undefined) < 2);                 // no previous session
  assert.notEqual(pickFirst(2, 1, () => 0.99), 1);        // rnd that always lands on the forbidden one
});

test('nextIndex cycles in order and wraps', () => {
  assert.deepEqual([0, 1, 2, 3].map(i => nextIndex(i, 4)), [1, 2, 3, 0]);
  assert.equal(nextIndex(1, 2), 0);
  assert.equal(nextIndex(0, 0), 0);
});

test('audio.lastFirst round-trips through save, and a new session avoids it', () => {
  const store = fakeStorage();
  const s1 = makeSave(store);
  assert.deepEqual(s1.data.audio, { lastFirst: {}, muted: false });

  const first = pickFirst(4, s1.data.audio.lastFirst.title);
  s1.patch({ audio: { lastFirst: { title: first }, muted: true } });

  const s2 = makeSave(store);                             // "next session"
  assert.deepEqual(s2.data.audio.lastFirst, { title: first });
  assert.equal(s2.data.audio.muted, true);
  assert.notEqual(pickFirst(4, s2.data.audio.lastFirst.title), first);

  // A pre-music v1 save (no audio key) must upgrade instead of yielding undefined.
  const old = makeSave(fakeStorage({ suchblast_v1: JSON.stringify({ v: 1, best: { gauntlet: 9 } }) }));
  assert.deepEqual(old.data.audio, { lastFirst: {}, muted: false });
  assert.equal(old.data.best.gauntlet, 9);
});
