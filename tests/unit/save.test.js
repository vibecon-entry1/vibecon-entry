import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSave, DEFAULTS, SFX_PICKS_V } from '../../web/engine/save.js';

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
  // Whole-object writes, like `audio`: the sound test always patches the map,
  // stamping the current generation (see SFX_PICKS_V) — that stamp is what
  // lets the picks survive the reload.
  s.patch({ sfxPicks: { v: SFX_PICKS_V, coin: 'b' } });
  s.patch({ sfxPicks: { v: SFX_PICKS_V, coin: 'b', hurt: 'b' } });
  s.patch({ best: { gauntlet: 100 } });           // unrelated patch must not clear it
  assert.deepEqual(makeSave(store).data.sfxPicks,
                   { v: SFX_PICKS_V, coin: 'b', hurt: 'b' });
});

test('picks from an older sound generation are discarded at load', () => {
  // SFX v2 renumbered what the candidate letters MEAN, so a pick banked
  // before the marker existed (or against a stale one) points at a different
  // sound than the player chose. Absent or wrong generation → all defaults.
  for (const picks of [{ coin: 'b' }, { v: 1, coin: 'b' }, { v: 99, coin: 'b' }]) {
    const s = makeSave(fakeStorage({ suchblast_v1: JSON.stringify({ v: 1, sfxPicks: picks }) }));
    assert.deepEqual(s.data.sfxPicks, {}, JSON.stringify(picks));
  }
  const ok = makeSave(fakeStorage({ suchblast_v1:
    JSON.stringify({ v: 1, sfxPicks: { v: SFX_PICKS_V, coin: 'b' } }) }));
  assert.deepEqual(ok.data.sfxPicks, { v: SFX_PICKS_V, coin: 'b' });
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
  const odd = makeSave(fakeStorage({ suchblast_v1:
    JSON.stringify({ v: 1, sfxPicks: { v: SFX_PICKS_V, coin: 42 } }) }));
  assert.deepEqual(odd.data.sfxPicks, { v: SFX_PICKS_V, coin: 42 });
});

test('partial best patches merge, not replace', () => {
  const store = fakeStorage();
  const s = makeSave(store);
  s.patch({ best: { gauntlet: 500 } });
  s.patch({ best: { wow: 77 } });
  assert.deepEqual(s.data.best, { gauntlet: 500, wow: 77 });
  assert.deepEqual(makeSave(store).data.best, { gauntlet: 500, wow: 77 });
});
