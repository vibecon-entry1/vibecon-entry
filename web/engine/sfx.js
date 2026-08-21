// Sound effects: pre-rendered, layered sound design served from tiny AAC
// files, with the original synthesized recipes kept underneath as the
// degraded-but-never-silent fallback.
//
// THE SFX v2 SHAPE. Every sound in the tables below carries BOTH a `file`
// (a rendered candidate in web/assets/sfx/, ~1.5-27KB of AAC-LC .m4a — the
// one compressed container every browser's decodeAudioData accepts) and the
// original synth patch params. play() prefers the decoded buffer; a buffer
// that hasn't resolved yet — or never will (cold offline cache, CDN 404, a
// broken decoder) — falls through to the recipe voice, so the game sounds
// like last release instead of going silent, and never waits on audio.
// Fetch+decode happens at unlock() (the first user gesture), gated on
// `enabled` so the ?test build stays fetch-free as well as silent.
//
// Doctrine shared with the jukebox, deliberately mirrored:
//   * nothing exists before a user gesture — the AudioContext itself is not
//     constructed until unlock(), so a page that is never touched never opens
//     an audio device (the ?test e2e asserts exactly this);
//   * ?test builds a SILENT engine (enabled:false) — the suite drives play with
//     hundreds of synthetic-but-trusted keypresses, and a live SFX layer would
//     mean thousands of oscillators per run;
//   * mute is ONE user-facing switch: main.js flips the jukebox and this
//     together off the same persisted save.data.audio.muted flag;
//   * failure is silent. Every entry point is wrapped so a browser without
//     WebAudio, or a context that refuses to resume, degrades to "no sound"
//     rather than to a console error (the e2e suite asserts an empty console).
//
// Node lifetime: WebAudio nodes are throwaway by design — an OscillatorNode is
// single-use, cannot be restarted, and is garbage once it has stopped. So a
// play() allocating 2-4 nodes is the intended shape, not a leak. The only thing
// that persists per context is the master gain and one shared noise buffer.

/** SFX sit UNDER the music: half gain, so a blip never fights the run track. */
export const MASTER = 0.5;

import { stamp } from './version.js';

/** Where the rendered files live; every fetch goes through stamp() like the
 *  atlas and the music, so a deploy can never mix stale audio with new code. */
export const SFX_BASE = 'assets/sfx/';

/**
 * The param table. Every entry is a rendered file + a tiny synth patch:
 *   file      the rendered winner in SFX_BASE (see the header note) — what a
 *             player actually hears once its buffer has decoded. Variant
 *             letters in FILE NAMES are render-candidate ids and do NOT line
 *             up with the engine's a/b/c pick scheme: engine 'a' is "the
 *             shipped default", which for coin happens to be coin_a.m4a but
 *             for pew is pew_c.m4a (the review's winner).
 *   wave      'square' | 'triangle' | 'sawtooth' | 'noise'
 *   f0, f1    start/end frequency in Hz; the pitch sweeps exponentially between
 *             them across `duration` (equal-ratio, i.e. musical, not linear).
 *   notes     optional: play the sound as a stepped SEQUENCE of pitches instead
 *             of one sweep — used for the coin's two-step and the death jingle.
 *             f0/f1 mirror notes[0]/notes.at(-1) so the table stays uniform.
 *   duration  total seconds, envelope included.
 *   attack    seconds to full gain.
 *   decay     seconds of falloff at the tail.
 *   volume    per-sound gain, pre-master.
 *   noise     optional 0..1: mix in a noise layer at this relative volume.
 *
 * Exported so the unit suite can assert completeness without a browser.
 */
export const SOUNDS = {
  // The gun. Short, dry, and deliberately the quietest thing here: it fires
  // several times a second and anything fatter turns into a buzzsaw. Ultra-short
  // sawtooth — no high end left to fatigue at rapid fire.
  pew:       { wave: 'sawtooth', f0: 960,  f1: 420,  duration: 0.065, attack: 0.002, decay: 0.05, volume: 0.28, file: 'pew_c.m4a' },
  // Down-shot off the ground: an UP-chirp, because the body goes up.
  hop:       { wave: 'triangle', f0: 300,  f1: 520,  duration: 0.12, attack: 0.008, decay: 0.09, volume: 0.42, file: 'hop_b.m4a' },
  // Mid-air boost: same gesture, wider sweep, a bigger noise swell for thrust
  // with some body to it.
  boost:     { wave: 'triangle', f0: 170,  f1: 780,  duration: 0.19, attack: 0.012, decay: 0.14, volume: 0.48, noise: 0.28, file: 'boost_b.m4a' },
  // Slide-burst chord: a downward saw punch. The only shot that MOVES you
  // horizontally, so the heavy low-end noise sells it as a shove, not a shot.
  burst:     { wave: 'sawtooth', f0: 190,  f1: 60,   duration: 0.15, attack: 0.003, decay: 0.11, volume: 0.52, noise: 0.45, file: 'burst_a.m4a' },
  // Pickup: bright, stepped a full octave (C6→C7), above everything else in the
  // mix's frequency range so it survives a kill and a landing on top of it.
  coin:      { wave: 'square',   f0: 1047, f1: 2093, duration: 0.12, attack: 0.003, decay: 0.07, volume: 0.30, notes: [1047, 2093], file: 'coin_a.m4a' },
  // Taking damage: a stepped FALLING square under heavy noise. Must not be
  // confusable with any shot — the steps make it unmistakable.
  hurt:      { wave: 'square',   f0: 220,  f1: 92,   duration: 0.16, attack: 0.004, decay: 0.12, volume: 0.50, noise: 0.50, notes: [220, 156, 92], file: 'hurt_a.m4a' },
  // Death: four descending squares, properly sad. The only jingle in the set.
  ded:       { wave: 'square',   f0: 523,  f1: 262,  duration: 0.70, attack: 0.005, decay: 0.16, volume: 0.40, notes: [523, 392, 330, 262], file: 'ded_a.m4a' },
  // Kill: tight transient, a whisper of noise — it plays hundreds of times.
  killpop:   { wave: 'sawtooth', f0: 620,  f1: 120,  duration: 0.11, attack: 0.003, decay: 0.085, volume: 0.40, noise: 0.10, file: 'killpop_b.m4a' },
  // Boss taking a hit: a dull heavy thud, no transient click to clash with the
  // player's own fire on the same frame.
  bosshit:   { wave: 'sawtooth', f0: 140,  f1: 50,   duration: 0.13, attack: 0.003, decay: 0.09, volume: 0.52, noise: 0.22, file: 'bosshit_a.m4a' },
  // Boss down: the one BIG sound. Slow noise swell under a square rising three
  // and a half octaves — long attack on purpose, it is a payoff not a hit.
  bossdown:  { wave: 'square',   f0: 90,   f1: 990,  duration: 0.80, attack: 0.100, decay: 0.45, volume: 0.55, noise: 0.65, file: 'bossdown_c.m4a' },
  // Boss-summoned minion: a smaller, higher killpop so a minion death is
  // audibly not a roster kill.
  minionpop: { wave: 'square',   f0: 990,  f1: 1320, duration: 0.07, attack: 0.003, decay: 0.05, volume: 0.30, file: 'minionpop_a.m4a' },
  // UI: a short down-step, atonal and non-grating.
  uiclick:   { wave: 'square',   f0: 880,  f1: 660,  duration: 0.045, attack: 0.002, decay: 0.035, volume: 0.30, file: 'uiclick_a.m4a' },
  // NEW in SFX v2 — ship-takeoff roar for the win finale. The rendered asset
  // is ~3s on purpose (its tail rings past the 2.5s frozen-world window into
  // the win screen, which has no entry sting of its own) and is mixed
  // rumble-forward so it never fights the fanfare's melody. The synth
  // fallback is a shorter noise-heavy saw swell: a degraded roar, not a
  // replica — it only exists so a failed decode still marks the moment.
  takeoff:   { wave: 'sawtooth', f0: 42,   f1: 130,  duration: 0.95, attack: 0.20, decay: 0.55, volume: 0.50, noise: 0.85, file: 'takeoff_b.m4a' },
  // NEW in SFX v2 — the AFK countdown tick, once per second, up to 180 times
  // an incident: bone-dry with near-zero tail BY DESIGN (the render review's
  // own note: restraint is the repetition-safe choice). Fallback matches.
  afktick:   { wave: 'square',   f0: 1100, f1: 880,  duration: 0.05, attack: 0.002, decay: 0.04, volume: 0.30, file: 'afktick_a.m4a' },
};

/**
 * Audition candidates: the hidden sound-test's B/C options per sound. Since
 * SFX v2 these are the rendered RUNNERS-UP (B the higher-scoring of the two,
 * C the other — per-round scores in assets-wow's sfx2 rankings), each with a
 * `file` like the SOUNDS entries. The synth params on each slot are its
 * decode-failure fallback: the previously-shipped recipes stay where they
 * lived, and slots that never had a bespoke recipe (pew/hurt 'c', all of
 * takeoff/afktick) borrow their sound's default recipe — a fallback marks
 * the event, it doesn't impersonate the render.
 * Every sound now runs three-wide: with all 42 candidates rendered there are
 * no known-bad synth slots left to hide.
 */
export const CANDIDATES = {
  pew:       { b: { wave: 'square',   f0: 880,  f1: 440,  duration: 0.08, attack: 0.004, decay: 0.06, volume: 0.30, file: 'pew_b.m4a' },
               c: { wave: 'sawtooth', f0: 960,  f1: 420,  duration: 0.065, attack: 0.002, decay: 0.05, volume: 0.28, file: 'pew_a.m4a' } },
  hop:       { b: { wave: 'triangle', f0: 240,  f1: 620,  duration: 0.13, attack: 0.006, decay: 0.10, volume: 0.44, noise: 0.08, file: 'hop_a.m4a' },
               c: { wave: 'square',   f0: 330,  f1: 660,  duration: 0.10, attack: 0.005, decay: 0.08, volume: 0.36, notes: [330, 494, 660], file: 'hop_c.m4a' } },
  boost:     { b: { wave: 'triangle', f0: 200,  f1: 660,  duration: 0.15, attack: 0.010, decay: 0.11, volume: 0.46, noise: 0.15, file: 'boost_c.m4a' },
               c: { wave: 'sawtooth', f0: 150,  f1: 620,  duration: 0.16, attack: 0.010, decay: 0.12, volume: 0.42, noise: 0.22, file: 'boost_a.m4a' } },
  burst:     { b: { wave: 'sawtooth', f0: 150,  f1: 90,   duration: 0.12, attack: 0.004, decay: 0.09, volume: 0.50, noise: 0.30, file: 'burst_b.m4a' },
               c: { wave: 'square',   f0: 140,  f1: 65,   duration: 0.13, attack: 0.004, decay: 0.10, volume: 0.50, noise: 0.35, file: 'burst_c.m4a' } },
  coin:      { b: { wave: 'square',   f0: 1320, f1: 1760, duration: 0.09, attack: 0.004, decay: 0.05, volume: 0.30, notes: [1320, 1760], file: 'coin_c.m4a' },
               c: { wave: 'triangle', f0: 1568, f1: 2349, duration: 0.11, attack: 0.003, decay: 0.06, volume: 0.36, notes: [1568, 1976, 2349], file: 'coin_b.m4a' } },
  hurt:      { b: { wave: 'sawtooth', f0: 220,  f1: 110,  duration: 0.18, attack: 0.005, decay: 0.14, volume: 0.50, noise: 0.60, file: 'hurt_c.m4a' },
               c: { wave: 'square',   f0: 220,  f1: 92,   duration: 0.16, attack: 0.004, decay: 0.12, volume: 0.50, noise: 0.50, notes: [220, 156, 92], file: 'hurt_b.m4a' } },
  ded:       { b: { wave: 'square',   f0: 440,  f1: 220,  duration: 0.50, attack: 0.005, decay: 0.12, volume: 0.40, notes: [440, 330, 220], file: 'ded_b.m4a' },
               c: { wave: 'triangle', f0: 494,  f1: 220,  duration: 0.62, attack: 0.006, decay: 0.20, volume: 0.46, notes: [494, 370, 294, 220], noise: 0.08, file: 'ded_c.m4a' } },
  killpop:   { b: { wave: 'square',   f0: 660,  f1: 110,  duration: 0.12, attack: 0.004, decay: 0.09, volume: 0.40, file: 'killpop_c.m4a' },
               c: { wave: 'square',   f0: 780,  f1: 90,   duration: 0.14, attack: 0.003, decay: 0.10, volume: 0.42, noise: 0.18, file: 'killpop_a.m4a' } },
  bosshit:   { b: { wave: 'sawtooth', f0: 110,  f1: 70,   duration: 0.10, attack: 0.004, decay: 0.07, volume: 0.50, file: 'bosshit_c.m4a' },
               c: { wave: 'square',   f0: 100,  f1: 58,   duration: 0.10, attack: 0.003, decay: 0.075, volume: 0.50, noise: 0.12, file: 'bosshit_b.m4a' } },
  bossdown:  { b: { wave: 'square',   f0: 110,  f1: 880,  duration: 0.60, attack: 0.080, decay: 0.35, volume: 0.55, noise: 0.50, file: 'bossdown_b.m4a' },
               c: { wave: 'sawtooth', f0: 110,  f1: 880,  duration: 0.72, attack: 0.060, decay: 0.40, volume: 0.52, noise: 0.45, notes: [110, 220, 440, 880], file: 'bossdown_a.m4a' } },
  minionpop: { b: { wave: 'square',   f0: 880,  f1: 1568, duration: 0.08, attack: 0.002, decay: 0.06, volume: 0.30, noise: 0.08, file: 'minionpop_c.m4a' },
               c: { wave: 'triangle', f0: 1046, f1: 1480, duration: 0.06, attack: 0.002, decay: 0.045, volume: 0.36, file: 'minionpop_b.m4a' } },
  uiclick:   { b: { wave: 'square',   f0: 660,  f1: 660,  duration: 0.04, attack: 0.002, decay: 0.03, volume: 0.30, file: 'uiclick_b.m4a' },
               c: { wave: 'triangle', f0: 990,  f1: 990,  duration: 0.035, attack: 0.001, decay: 0.028, volume: 0.38, file: 'uiclick_c.m4a' } },
  takeoff:   { b: { wave: 'sawtooth', f0: 42,   f1: 130,  duration: 0.95, attack: 0.20, decay: 0.55, volume: 0.50, noise: 0.85, file: 'takeoff_a.m4a' },
               c: { wave: 'sawtooth', f0: 42,   f1: 130,  duration: 0.95, attack: 0.20, decay: 0.55, volume: 0.50, noise: 0.85, file: 'takeoff_c.m4a' } },
  afktick:   { b: { wave: 'square',   f0: 1100, f1: 880,  duration: 0.05, attack: 0.002, decay: 0.04, volume: 0.30, file: 'afktick_c.m4a' },
               c: { wave: 'square',   f0: 1100, f1: 880,  duration: 0.05, attack: 0.002, decay: 0.04, volume: 0.30, file: 'afktick_b.m4a' } },
};

/**
 * Pick resolution: the player's persisted per-sound choices (save.data.sfxPicks,
 * absent on every save written before the sound test existed) override the
 * default table. Pure and exported for the unit suite. Tolerance is the whole
 * point: an unknown sound is null (play() already no-ops those), and a pick
 * that names no candidate — junk value, hand-edited save, a candidate that was
 * later removed — falls back to the default rather than being trusted.
 * Returns { patch, variant } with variant 'a' meaning "the SOUNDS entry".
 */
export function resolvePatch(name, picks) {
  const base = SOUNDS[name];
  if (!base) return null;
  const v = picks && typeof picks === 'object' ? picks[name] : null;
  const alt = v && v !== 'a' ? CANDIDATES[name]?.[v] : null;
  return alt ? { patch: alt, variant: v } : { patch: base, variant: 'a' };
}

export const WAVES = ['square', 'triangle', 'sawtooth', 'noise'];

/**
 * Envelope schedule for a patch. Pure, exported, and the only piece of this
 * file the unit suite can reach: the browser owns everything downstream of it.
 *
 * attack + decay are authored independently of duration, so a patch can specify
 * a combination that doesn't fit (or exactly fills) its own duration. Rather
 * than clamping one of them — which would silently drop a sound's whole tail —
 * both are scaled by the same factor so the SHAPE survives and only the scale
 * changes. `sustain` is whatever is left in the middle, never negative.
 *
 * Returns absolute offsets from the note start, in seconds:
 *   { attack, sustain, decay, peakAt, releaseAt, total }
 */
export function envelopeTimes(p) {
  const total = Math.max(0, p.duration || 0);
  let a = Math.max(0, p.attack || 0);
  let d = Math.max(0, p.decay || 0);
  const span = a + d;
  if (span > total && span > 0) { const k = total / span; a *= k; d *= k; }
  // Float dust snap: attack+decay that exactly fills the duration (0.04 + 0.06
  // in a 0.1s patch) leaves ~7e-18 of "sustain" in binary floating point. Left
  // in, it makes releaseAt !== peakAt by a quantity no scheduler can express.
  let sustain = total - a - d;
  if (!(sustain > 1e-9)) sustain = 0;
  return { attack: a, sustain, decay: d, peakAt: a, releaseAt: a + sustain, total };
}

// WebAudio's exponentialRampToValueAtTime throws on a zero/negative target, and
// a gain that ramps to exactly 0 is the common way to hit that. Everything here
// ramps toward this floor instead and then hard-stops the node.
const FLOOR = 0.0001;

/**
 * makeSfx({ save, enabled, CtxCtor }) → the SFX API used by main.js.
 *
 * Constructed synchronously at boot but INERT until unlock(): no AudioContext
 * is created in the constructor, on purpose (see the doctrine note up top).
 * `enabled:false` builds a fully-formed engine whose play() only bookkeeps —
 * the ?test path, mirroring makeJukebox's silent build.
 */
export function makeSfx({
  save,
  enabled = true,
  CtxCtor = typeof AudioContext !== 'undefined' ? AudioContext
          : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null,
} = {}) {
  let inert = !enabled || !CtxCtor;
  let ctx = null, master = null, noiseBuf = null;
  let muted = !!save?.data?.audio?.muted;
  let warned = false;
  // Decoded rendered sounds, keyed by FILE name (not sound name: the audition
  // candidates share the map). `loaded` counts only the 14 defaults so the
  // live probe can assert preload health against a known target.
  const buffers = new Map();
  const fetching = new Set();
  const DEFAULT_FILES = new Set(Object.values(SOUNDS).map(p => p.file));
  let loaded = 0;

  /**
   * Fetch+decode one rendered file into the buffer map, at most once. Every
   * failure mode — network, HTTP status, decoder — is swallowed whole: the
   * synth fallback keeps playing and a later call may simply try again (the
   * guard is dropped on failure ON PURPOSE, so a flaky connection heals).
   * Never runs before unlock(): it needs the ctx for decodeAudioData, and
   * inert (the ?test build) bails before any fetch happens at all.
   */
  function fetchBuf(file) {
    if (inert || !ctx || !file || buffers.has(file) || fetching.has(file)) return;
    fetching.add(file);
    fetch(stamp(SFX_BASE + file))
      .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(ab => ctx.decodeAudioData(ab))
      .then(buf => {
        buffers.set(file, buf);
        if (DEFAULT_FILES.has(file)) loaded++;
      })
      .catch(() => { fetching.delete(file); });
  }
  // Diagnostics for the live probe: a bounded log of what the game ASKED for,
  // recorded even in the silent build. Bounded because a full run fires
  // thousands of shots and an unbounded array would be a slow leak.
  let plays = 0;
  const log = [];
  const LOG_MAX = 64;

  const warn = msg => { if (!warned) { warned = true; console.warn(`[sfx] ${msg}`); } };

  function gain() { return muted ? 0 : MASTER; }

  /** One second of white noise, built once per context and shared by every hit. */
  function noise() {
    if (noiseBuf) return noiseBuf;
    const n = Math.floor(ctx.sampleRate);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /**
   * Schedule one voice: a source (oscillator or noise) through its own gain
   * envelope into the master. `plan` is the pitch plan:
   *   { sweep: [f0, f1] }  exponential glide across the whole duration
   *   { steps: [a, b, c] } equal-length held pitches (coin's two-step, ded's
   *                        jingle) — setValueAtTime, because the steps ARE the
   *                        sound and a ramp would smear them into a siren.
   * A noise source ignores the plan entirely; it exists for texture, not pitch.
   * Everything is scheduled ahead of `t0` and self-disposes on 'ended'.
   */
  function voice(wave, plan, t0, vol, env) {
    const g = ctx.createGain();
    g.connect(master);
    let src;
    if (wave === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = noise();
      src.loop = true;                       // 1s buffer, sounds run far shorter
    } else {
      src = ctx.createOscillator();
      src.type = wave;
      const f = src.frequency;
      if (plan.steps) {
        const step = env.total / plan.steps.length;
        plan.steps.forEach((hz, i) => f.setValueAtTime(hz, t0 + i * step));
      } else {
        const [f0, f1] = plan.sweep;
        f.setValueAtTime(f0, t0);
        if (f1 !== f0) f.exponentialRampToValueAtTime(f1, t0 + env.total);
      }
    }
    // The envelope. linearRamp for the attack (it starts at the floor, where an
    // exponential ramp behaves badly) and exponentialRamp for the tail (a linear
    // fade to zero reads as a click at these durations).
    const v = Math.max(FLOOR, vol);
    const gv = g.gain;
    gv.setValueAtTime(FLOOR, t0);
    gv.linearRampToValueAtTime(v, t0 + Math.max(0.001, env.attack));
    gv.setValueAtTime(v, t0 + env.releaseAt);
    gv.exponentialRampToValueAtTime(FLOOR, t0 + env.total);
    src.connect(g);
    src.start(t0);
    src.stop(t0 + env.total + 0.02);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { /* already gone */ } };
  }

  /**
   * One rendered voice: a decoded AudioBuffer through a trim gain into the
   * master. The files are peak-normalized with their loudness relationships
   * mastered in (role-banded RMS), so the per-sound trim is `gain` — a table
   * column defaulting to 1 — rather than the synth patches' `volume`.
   * `rate` bends playbackRate (the coin combo rides this); buffer sources
   * end themselves, so there is no stop() to schedule.
   */
  function bufferVoice(buf, t0, vol, rate) {
    const g = ctx.createGain();
    g.gain.value = Math.max(FLOOR, vol);
    g.connect(master);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (rate && rate !== 1) src.playbackRate.value = rate;
    src.connect(g);
    src.start(t0);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { /* already gone */ } };
  }

  // `variant` is the sound test's preview channel: an explicit candidate id
  // trumps the persisted pick for this one play, so the screen can audition
  // 'b' while your saved pick is 'a'. Every normal caller passes only a name
  // and gets pick-override → default resolution against the LIVE save — a pick
  // banked mid-session is audible on the very next trigger, no reload.
  function play(name, variant) {
    const r = resolvePatch(name, variant ? { [name]: variant } : save?.data?.sfxPicks);
    if (!r) return;
    const p = r.patch;
    plays++;
    // Non-default resolutions are tagged in the log ('coin#b'): the ?test hook
    // reads this, and "which recipe would have played" is exactly what the
    // pick-persistence e2e has to see. Default plays keep the bare name.
    log.push(r.variant === 'a' ? name : `${name}#${r.variant}`);
    if (log.length > LOG_MAX) log.shift();
    // Muted still counts as a play: the log is what the GAME asked for, and the
    // probe needs it to line up with the events regardless of the mix.
    if (inert || !ctx || muted) return;
    try {
      // A context can fall back to 'suspended' when a tab is backgrounded; a
      // resume() here is cheap and keeps sound alive on return without needing
      // a fresh gesture.
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t0 = ctx.currentTime + 0.001;                  // never schedule in the past
      // Rendered-first: a decoded buffer wins outright. A miss falls through
      // to the synth recipe AND kicks off the fetch — which is how the
      // audition screen's B/C candidates lazy-load (they are not preloaded;
      // the first poke warms them for every poke after), and how a file that
      // failed at unlock gets another chance.
      const buf = p.file ? buffers.get(p.file) : null;
      if (buf) { bufferVoice(buf, t0, p.gain ?? 1); return; }
      if (p.file) fetchBuf(p.file);
      const env = envelopeTimes(p);
      if (env.total <= 0) return;
      const plan = p.notes?.length ? { steps: p.notes } : { sweep: [p.f0, p.f1] };
      voice(p.wave, plan, t0, p.volume, env);
      if (p.noise > 0) voice('noise', plan, t0, p.volume * p.noise, env);
    } catch {
      warn('synthesis failed — sfx disabled');
      inert = true;
    }
  }

  /**
   * First user gesture: build the context. Idempotent, and safe to call from
   * the same one-shot listeners main.js already uses for the jukebox.
   */
  function unlock() {
    if (inert || ctx) return;
    try {
      ctx = new CtxCtor();
      master = ctx.createGain();
      master.gain.value = gain();
      master.connect(ctx.destination);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      // First gesture: start the 14 default files (plus any banked candidate
      // picks, so a saved 'b' ear is warm from the first trigger too).
      // ~85KB over 14 requests — a non-event even on 3G, and any play()
      // arriving before its buffer resolves falls through to the synth voice.
      for (const p of Object.values(SOUNDS)) fetchBuf(p.file);
      const picks = save?.data?.sfxPicks;
      if (picks && typeof picks === 'object')
        for (const name of Object.keys(SOUNDS)) {
          const v = picks[name];
          if (v && v !== 'a') fetchBuf(CANDIDATES[name]?.[v]?.file);
        }
    } catch {
      ctx = null; master = null; inert = true;
      warn('AudioContext unavailable — sfx disabled');
    }
  }

  /** Driven by main.js's single mute switch; persistence lives with the jukebox. */
  function setMuted(v) {
    muted = !!v;
    if (master) master.gain.value = gain();
    return muted;
  }

  return {
    play, unlock, setMuted,
    isMuted: () => muted,
    // Minimal diagnostic surface for the live probe: the actual gain-graph
    // value, not the intent — proof that mute reaches the node and that SFX
    // really do sit at half the music's level.
    current: () => ({
      muted, inert,
      master: master ? master.gain.value : null,
      ready: !!ctx,
      state: ctx ? ctx.state : null,
      plays,
      log: [...log],
      // Preload health for the live probe: how many of the 14 default
      // rendered files have decoded. 0 in the silent build, by construction.
      loaded,
    }),
  };
}
