import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, CANDIDATES, WAVES, MASTER, envelopeTimes, makeSfx, resolvePatch,
         COMBO, comboAdvance, comboRate, SFX_BASE }
  from '../../web/engine/sfx.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The synthesis itself is browser-only (AudioContext), exactly like input.js's
// DOM half: what CAN be tested offline is the param table's integrity and the
// envelope math, which is where every audible bug in a patch actually lives.

// Every event play.js and the scenes can fire. If a name is added to a scene
// without a patch, play() silently no-ops — this list is the guard against that
// happening quietly.
const REQUIRED = ['pew', 'hop', 'boost', 'burst', 'coin', 'hurt', 'ded',
                  'killpop', 'bosshit', 'bossdown', 'minionpop', 'uiclick',
                  'takeoff', 'afktick'];        // the two SFX v2 additions

test('the param table covers every wired event and nothing else', () => {
  assert.deepEqual(Object.keys(SOUNDS).sort(), [...REQUIRED].sort());
});

// One rulebook for every patch the engine could ever be asked to schedule —
// the shipped table AND the sound test's candidates go through it.
function assertPlayable(name, p) {
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

test('every patch is playable: valid wave, positive duration, positive freqs', () => {
  for (const [name, p] of Object.entries(SOUNDS)) assertPlayable(name, p);
});

test('every audition candidate is a playable patch for a real sound', () => {
  for (const [name, alts] of Object.entries(CANDIDATES)) {
    assert.ok(SOUNDS[name], `${name}: candidate for a sound that does not exist`);
    for (const [v, p] of Object.entries(alts)) {
      assert.ok(v === 'b' || v === 'c', `${name}: variant id ${v} outside the b/c scheme`);
      assertPlayable(`${name}#${v}`, p);
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

test('resolvePatch: pick overrides default; everything else falls through', () => {
  // No picks at all — the pre-sound-test save shape — is the default.
  for (const picks of [undefined, null, {}]) {
    const r = resolvePatch('coin', picks);
    assert.equal(r.patch, SOUNDS.coin);
    assert.equal(r.variant, 'a');
  }
  // A real pick resolves to the candidate patch, tagged with its id.
  const b = resolvePatch('coin', { coin: 'b' });
  assert.equal(b.patch, CANDIDATES.coin.b);
  assert.equal(b.variant, 'b');
  // An explicit 'a' means the default, same as no pick.
  assert.equal(resolvePatch('coin', { coin: 'a' }).patch, SOUNDS.coin);
  // A pick for one sound never leaks onto another.
  assert.equal(resolvePatch('pew', { coin: 'b' }).patch, SOUNDS.pew);
});

test('resolvePatch: junk is tolerated, never trusted', () => {
  // Unknown sound: null, exactly like play()'s no-op contract for bad names.
  assert.equal(resolvePatch('no-such-sound', { 'no-such-sound': 'b' }), null);
  // Unknown/garbage variant values fall back to the default — a hand-edited
  // save must not be able to schedule a patch that does not exist.
  for (const junk of ['z', 'd', 42, {}, [], true]) {
    const r = resolvePatch('pew', { pew: junk });   // 'd': one past the b/c scheme
    assert.equal(r.patch, SOUNDS.pew, `pew pick ${JSON.stringify(junk)} must fall back`);
    assert.equal(r.variant, 'a');
  }
  // A picks field that is not an object at all is treated as absent.
  for (const junk of ['b', 42, true]) {
    assert.equal(resolvePatch('coin', junk).patch, SOUNDS.coin);
  }
});

test('play() resolves the persisted pick and tags the log with it', () => {
  const save = { data: { audio: {}, sfxPicks: { coin: 'b', pew: 'nope' } } };
  const sfx = makeSfx({ save, enabled: false });
  sfx.play('coin');                     // pick applies
  sfx.play('pew');                      // junk pick falls back to default
  sfx.play('hop');                      // no pick at all
  sfx.play('coin', 'a');                // explicit preview trumps the pick
  sfx.play('hop', 'c');                 // explicit candidate preview
  assert.deepEqual(sfx.current().log, ['coin#b', 'pew', 'hop', 'coin', 'hop#c']);
});

test('the play log is bounded so a long run cannot grow it forever', () => {
  const sfx = makeSfx({ enabled: false });
  for (let i = 0; i < 500; i++) sfx.play('pew');
  const st = sfx.current();
  assert.equal(st.plays, 500);
  assert.ok(st.log.length <= 64, `log grew to ${st.log.length}`);
  assert.equal(st.log[st.log.length - 1], 'pew');
});

// --- SFX v2: rendered files ---------------------------------------------------

test('every sound and every candidate names a rendered file, and every shipped file is named', () => {
  const referenced = [];
  for (const [name, p] of Object.entries(SOUNDS)) {
    assert.match(p.file ?? '', /^[a-z]+_[abc]\.m4a$/, `${name}: bad or missing file`);
    referenced.push(p.file);
  }
  for (const [name, vs] of Object.entries(CANDIDATES))
    for (const [v, p] of Object.entries(vs)) {
      assert.match(p.file ?? '', /^[a-z]+_[abc]\.m4a$/, `${name}#${v}: bad or missing file`);
      referenced.push(p.file);
    }
  // No two slots may share a file: engine a/b/c letters are remapped onto
  // render-candidate letters, and a duplicate would mean two auditions that
  // sound identical — exactly the drift this bijection check exists to catch.
  assert.equal(new Set(referenced).size, referenced.length, 'duplicate file reference');
  // ...and the references tile the shipped directory exactly (42 = 14 * 3).
  const dir = fileURLToPath(new URL(`../../web/${SFX_BASE}`, import.meta.url));
  const shipped = fs.readdirSync(dir).filter(f => f.endsWith('.m4a')).sort();
  assert.deepEqual([...referenced].sort(), shipped);
});

test('rendered winners match the review rankings', () => {
  // The frozen winner table (assets-wow sfx2 rankings). A typo'd remap would
  // silently ship a runner-up as the default — this pins each one.
  assert.deepEqual(Object.fromEntries(Object.entries(SOUNDS).map(([n, p]) => [n, p.file])), {
    pew: 'pew_c.m4a', hop: 'hop_b.m4a', boost: 'boost_b.m4a', burst: 'burst_a.m4a',
    coin: 'coin_a.m4a', hurt: 'hurt_a.m4a', ded: 'ded_a.m4a', killpop: 'killpop_b.m4a',
    bosshit: 'bosshit_a.m4a', bossdown: 'bossdown_c.m4a', minionpop: 'minionpop_a.m4a',
    uiclick: 'uiclick_a.m4a', takeoff: 'takeoff_b.m4a', afktick: 'afktick_a.m4a',
  });
});

// --- coin combo (S1) ----------------------------------------------------------

test('comboAdvance: streak climbs inside the window, caps, resets on a gap', () => {
  let s = comboAdvance(undefined, 10);              // first coin ever
  assert.equal(s.streak, 0);
  s = comboAdvance(s, 10.5);                        // inside 1.5s
  assert.equal(s.streak, 1);
  s = comboAdvance(s, 11.9);                        // window slides per pickup
  assert.equal(s.streak, 2);
  s = comboAdvance(s, 11.9 + COMBO.window);         // exactly at the edge: still in
  assert.equal(s.streak, 3);
  for (let i = 0; i < 30; i++) s = comboAdvance(s, s.last + 0.1);
  assert.equal(s.streak, COMBO.cap);                // capped, never past it
  s = comboAdvance(s, s.last + COMBO.window + 0.01);
  assert.equal(s.streak, 0);                        // a gap resets to the root
});

test('comboRate: one semitone per step, an octave at twelve', () => {
  assert.equal(comboRate(0), 1);
  assert.ok(Math.abs(comboRate(1) - Math.pow(2, 1 / 12)) < 1e-12);
  assert.equal(comboRate(12), 2);
  // Monotone: every step is strictly up.
  for (let i = 1; i <= COMBO.cap; i++) assert.ok(comboRate(i) > comboRate(i - 1));
});

test('the engine advances the combo off coin plays alone, on the injected clock', () => {
  let t = 0;
  const sfx = makeSfx({ enabled: false, clock: () => t });
  sfx.play('coin');                assert.equal(sfx.current().combo, 0);
  t = 0.4; sfx.play('coin');       assert.equal(sfx.current().combo, 1);
  t = 0.8; sfx.play('pew');        // other sounds neither advance...
  t = 1.0; sfx.play('coin');       assert.equal(sfx.current().combo, 2);
  t = 9.0; sfx.play('killpop');    // ...nor reset the streak; only time does
  t = 9.1; sfx.play('coin');       assert.equal(sfx.current().combo, 0);
  t = 9.2; sfx.play('coin');       assert.equal(sfx.current().combo, 1);
});
