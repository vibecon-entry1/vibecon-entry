import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSave, DEFAULTS } from '../../web/engine/save.js';

function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m };
}

test('fresh storage → defaults', () => {
  const s = makeSave(fakeStorage());
  assert.deepEqual(s.data, DEFAULTS);
});

test('corrupt JSON → defaults, no throw', () => {
  const s = makeSave(fakeStorage({ suchblast_v1: '{oops' }));
  assert.deepEqual(s.data, DEFAULTS);
});

test('wrong version → defaults', () => {
  const s = makeSave(fakeStorage({ suchblast_v1: JSON.stringify({ v: 99 }) }));
  assert.deepEqual(s.data, DEFAULTS);
});

test('patch persists and round-trips', () => {
  const store = fakeStorage();
  makeSave(store).patch({ muted: true });
  assert.equal(makeSave(store).data.muted, true);
});

test('throwing storage is survived', () => {
  const s = makeSave({ getItem() { throw 1; }, setItem() { throw 1; } });
  s.patch({ muted: true });               // must not throw
  assert.equal(s.data.muted, true);       // in-memory still works
});

test('wowUnlocked is a flat top-level flag that survives a reload', () => {
  const store = fakeStorage();
  const s = makeSave(store);
  assert.equal(s.data.wowUnlocked, false);      // locked on a fresh save
  s.patch({ wowUnlocked: true });
  s.patch({ best: { gauntlet: 900 } });         // a later patch must not clear it
  assert.equal(s.data.wowUnlocked, true);
  const reloaded = makeSave(store);
  assert.equal(reloaded.data.wowUnlocked, true);
  assert.equal(reloaded.data.best.gauntlet, 900);
});

test('sfxPicks round-trips whole, and a picks-free save reads as no picks', () => {
  const store = fakeStorage();
  const s = makeSave(store);
  assert.deepEqual(s.data.sfxPicks, {});          // fresh save: all defaults
  // Whole-object writes, like `audio`: the sound test always patches the map.
  s.patch({ sfxPicks: { coin: 'b' } });
  s.patch({ sfxPicks: { coin: 'b', hurt: 'b' } });
  s.patch({ best: { gauntlet: 100 } });           // unrelated patch must not clear it
  assert.deepEqual(makeSave(store).data.sfxPicks, { coin: 'b', hurt: 'b' });
});

test('a v1 save written before the sound test existed loads with no picks', () => {
  const s = makeSave(fakeStorage({ suchblast_v1: JSON.stringify({ v: 1, wowUnlocked: true }) }));
  assert.deepEqual(s.data.sfxPicks, {});
  assert.equal(s.data.wowUnlocked, true);         // the old keys still land
});

test('a hand-mangled sfxPicks shape falls back to empty, values pass through', () => {
  // Shape is save.js's job; VALUES are sfx.js's (its resolver falls back
  // per-entry) — so a junk value survives the read and a junk shape does not.
  const bad = makeSave(fakeStorage({ suchblast_v1: JSON.stringify({ v: 1, sfxPicks: 'coin' }) }));
  assert.deepEqual(bad.data.sfxPicks, {});
  const odd = makeSave(fakeStorage({ suchblast_v1: JSON.stringify({ v: 1, sfxPicks: { coin: 42 } }) }));
  assert.deepEqual(odd.data.sfxPicks, { coin: 42 });
});

test('partial best patches merge, not replace', () => {
  const store = fakeStorage();
  const s = makeSave(store);
  s.patch({ best: { gauntlet: 500 } });
  s.patch({ best: { wow: 77 } });
  assert.deepEqual(s.data.best, { gauntlet: 500, wow: 77 });
  assert.deepEqual(makeSave(store).data.best, { gauntlet: 500, wow: 77 });
});
