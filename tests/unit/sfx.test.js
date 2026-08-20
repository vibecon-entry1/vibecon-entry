import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, WAVES, MASTER, envelopeTimes, makeSfx } from '../../web/engine/sfx.js';

// The synthesis itself is browser-only (AudioContext), exactly like input.js's
// DOM half: what CAN be tested offline is the param table's integrity and the
// envelope math, which is where every audible bug in a patch actually lives.

// Every event play.js and the scenes can fire. If a name is added to a scene
// without a patch, play() silently no-ops — this list is the guard against that
// happening quietly.
const REQUIRED = ['pew', 'hop', 'boost', 'burst', 'coin', 'hurt', 'ded',
                  'killpop', 'bosshit', 'bossdown', 'minionpop', 'uiclick'];

test('the param table covers every wired event and nothing else', () => {
  assert.deepEqual(Object.keys(SOUNDS).sort(), [...REQUIRED].sort());
});

test('every patch is playable: valid wave, positive duration, positive freqs', () => {
  for (const [name, p] of Object.entries(SOUNDS)) {
    assert.ok(WAVES.includes(p.wave), `${name}: bad wave ${p.wave}`);
    assert.ok(p.duration > 0, `${name}: duration must be > 0`);
    // Sanity band, not a style rule: anything past a second is a music cue, and
    // anything under 20ms is a click nobody hears.
    assert.ok(p.duration >= 0.02 && p.duration <= 1.0, `${name}: duration ${p.duration} out of band`);
    assert.ok(p.f0 > 0 && p.f1 > 0, `${name}: freqs must be > 0`);
    // Audible band. An exponential ramp to <= 0 throws in WebAudio, and
    // anything above ~16k is inaudible on most hardware.
    for (const f of [p.f0, p.f1])
      assert.ok(f >= 20 && f <= 16000, `${name}: freq ${f} outside the audible band`);
    assert.ok(p.attack >= 0 && p.decay >= 0, `${name}: negative envelope segment`);
    assert.ok(p.volume > 0 && p.volume <= 1, `${name}: volume ${p.volume} out of range`);
    if ('noise' in p) assert.ok(p.noise > 0 && p.noise <= 1, `${name}: noise mix out of range`);
    if ('notes' in p) {
      assert.ok(Array.isArray(p.notes) && p.notes.length >= 2, `${name}: notes must step at least twice`);
      for (const hz of p.notes) assert.ok(hz >= 20 && hz <= 16000, `${name}: note ${hz} out of band`);
      // f0/f1 mirror the sequence so the table reads uniformly and the
      // validation above covers stepped patches too.
      assert.equal(p.f0, p.notes[0], `${name}: f0 must mirror notes[0]`);
      assert.equal(p.f1, p.notes[p.notes.length - 1], `${name}: f1 must mirror the last note`);
    }
  }
});

test('the loud/soft ordering of the mix is intentional', () => {
  // Not arbitrary: pew fires several times a second and must be the quietest
  // thing in the set, and the boss dying must be the loudest.
  const vols = Object.values(SOUNDS).map(p => p.volume);
  assert.equal(SOUNDS.pew.volume, Math.min(...vols));
  assert.equal(SOUNDS.bossdown.volume, Math.max(...vols));
  // SFX sit under the music by construction.
  assert.ok(MASTER > 0 && MASTER < 1);
});

test('envelopeTimes: attack + sustain + decay always tile the duration exactly', () => {
  for (const [name, p] of Object.entries(SOUNDS)) {
    const e = envelopeTimes(p);
    assert.equal(e.total, p.duration, `${name}: total must be the duration`);
    assert.ok(Math.abs(e.attack + e.sustain + e.decay - e.total) < 1e-12,
              `${name}: segments do not tile the duration`);
    assert.ok(e.peakAt <= e.releaseAt && e.releaseAt <= e.total, `${name}: schedule out of order`);
    assert.ok(e.attack >= 0 && e.sustain >= 0 && e.decay >= 0, `${name}: negative segment`);
  }
});

test('envelopeTimes: an over-long envelope is SCALED, not clipped', () => {
  // 0.3 + 0.9 = 1.2 in a 0.6s sound: both segments scale by 0.5, so the ratio
  // between attack and decay (the shape) survives and nothing is dropped.
  const e = envelopeTimes({ duration: 0.6, attack: 0.3, decay: 0.9 });
  assert.equal(e.attack, 0.15);
  assert.equal(e.decay, 0.45);
  assert.equal(e.sustain, 0);
  assert.equal(e.total, 0.6);
  assert.equal(e.attack / e.decay, 0.3 / 0.9);        // shape preserved
});

test('envelopeTimes: exact fit leaves no sustain, and degenerate input is safe', () => {
  const fit = envelopeTimes({ duration: 0.1, attack: 0.04, decay: 0.06 });
  assert.equal(fit.sustain, 0);
  assert.equal(fit.releaseAt, 0.04);

  const zero = envelopeTimes({ duration: 0, attack: 0.1, decay: 0.1 });
  assert.deepEqual(zero, { attack: 0, sustain: 0, decay: 0, peakAt: 0, releaseAt: 0, total: 0 });

  // Missing/negative fields must not produce NaN — play() schedules on these.
  const empty = envelopeTimes({});
  assert.deepEqual(empty, { attack: 0, sustain: 0, decay: 0, peakAt: 0, releaseAt: 0, total: 0 });
  const neg = envelopeTimes({ duration: 0.2, attack: -1, decay: -1 });
  assert.deepEqual(neg, { attack: 0, sustain: 0.2, decay: 0, peakAt: 0, releaseAt: 0.2, total: 0.2 });
});

test('the silent build never constructs a context and never throws', () => {
  let built = 0;
  class Boom { constructor() { built++; throw new Error('should never run'); } }
  const sfx = makeSfx({ enabled: false, CtxCtor: Boom });
  sfx.unlock();
  for (const n of REQUIRED) sfx.play(n);
  sfx.play('no-such-sound');
  assert.equal(built, 0);
  const st = sfx.current();
  assert.equal(st.inert, true);
  assert.equal(st.ready, false);
  assert.equal(st.master, null);
  // Intent is still logged: the live probe reads this to line plays up with
  // game events, and an unknown name must NOT count.
  assert.equal(st.plays, REQUIRED.length);
  assert.deepEqual(st.log, REQUIRED);
});

test('a missing AudioContext degrades to inert rather than exploding', () => {
  const sfx = makeSfx({ CtxCtor: null });
  sfx.unlock();
  sfx.play('pew');
  assert.equal(sfx.current().inert, true);
  assert.equal(sfx.current().ready, false);
});

test('mute reads from the save and reaches the master gain node', () => {
  // Minimal AudioContext stand-in: enough graph to prove setMuted() moves the
  // real gain value, which is what the live probe asserts in the browser.
  const nodes = [];
  class FakeCtx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.sampleRate = 48000; }
    createGain() { const g = { gain: { value: 1 }, connect() {}, disconnect() {} }; nodes.push(g); return g; }
    resume() { return Promise.resolve(); }
  }
  const save = { data: { audio: { muted: true } } };
  const sfx = makeSfx({ save, CtxCtor: FakeCtx });
  assert.equal(sfx.isMuted(), true);
  sfx.unlock();
  assert.equal(sfx.current().master, 0);              // muted: hard zero
  assert.equal(sfx.setMuted(false), false);
  assert.equal(sfx.current().master, MASTER);         // unmuted: under the music
  assert.equal(sfx.current().ready, true);
  assert.equal(sfx.current().state, 'running');
});

test('the play log is bounded so a long run cannot grow it forever', () => {
  const sfx = makeSfx({ enabled: false });
  for (let i = 0; i < 500; i++) sfx.play('pew');
  const st = sfx.current();
  assert.equal(st.plays, 500);
  assert.ok(st.log.length <= 64, `log grew to ${st.log.length}`);
  assert.equal(st.log[st.log.length - 1], 'pew');
});
