// Synthesized sound effects. Zero assets, zero bytes on the wire: every sound
// in the game is a handful of numbers turned into an OscillatorNode (or a
// noise buffer) with a gain envelope, jsfxr-style. The whole SFX budget is the
// ~3KB of param table below.
//
// Why synthesis and not a sprite sheet of wavs: the music is already 27MB of
// streamed mp3 (engine/audio.js), and a blip-per-shot layer on top of that
// would either add a second preload budget or arrive late on the frame it was
// needed. A scheduled oscillator is sample-accurate and costs nothing to boot.
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

/**
 * The param table. Every entry is a tiny synth patch:
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
  // several times a second and anything fatter turns into a buzzsaw.
  pew:       { wave: 'square',   f0: 880,  f1: 440,  duration: 0.08, attack: 0.004, decay: 0.06, volume: 0.30 },
  // Down-shot off the ground: an UP-chirp, because the body goes up.
  hop:       { wave: 'triangle', f0: 300,  f1: 520,  duration: 0.12, attack: 0.008, decay: 0.09, volume: 0.42 },
  // Mid-air boost: same gesture, wider sweep, a breath of noise for thrust.
  boost:     { wave: 'triangle', f0: 200,  f1: 660,  duration: 0.15, attack: 0.010, decay: 0.11, volume: 0.46, noise: 0.15 },
  // Slide-burst chord: a downward saw punch. The only shot that MOVES you
  // horizontally, so it reads as a shove rather than a shot.
  burst:     { wave: 'sawtooth', f0: 150,  f1: 90,   duration: 0.12, attack: 0.004, decay: 0.09, volume: 0.50, noise: 0.30 },
  // Pickup: bright, stepped, above everything else in the mix's frequency range
  // so it survives being played on top of a kill and a landing.
  coin:      { wave: 'square',   f0: 1320, f1: 1760, duration: 0.09, attack: 0.004, decay: 0.05, volume: 0.30, notes: [1320, 1760] },
  // Taking damage: noise-forward, pitch falling. Must not be confusable with
  // any shot, so it is the one sound where noise dominates the tone.
  hurt:      { wave: 'sawtooth', f0: 220,  f1: 110,  duration: 0.18, attack: 0.005, decay: 0.14, volume: 0.50, noise: 0.60 },
  // Death: three descending squares. The only sound long enough to be a jingle.
  ded:       { wave: 'square',   f0: 440,  f1: 220,  duration: 0.50, attack: 0.005, decay: 0.12, volume: 0.40, notes: [440, 330, 220] },
  killpop:   { wave: 'square',   f0: 660,  f1: 110,  duration: 0.12, attack: 0.004, decay: 0.09, volume: 0.40 },
  bosshit:   { wave: 'sawtooth', f0: 110,  f1: 70,   duration: 0.10, attack: 0.004, decay: 0.07, volume: 0.50 },
  // Boss down: the one BIG sound. Slow noise swell under a square rising two
  // and a half octaves — long attack on purpose, it is a payoff not a hit.
  bossdown:  { wave: 'square',   f0: 110,  f1: 880,  duration: 0.60, attack: 0.080, decay: 0.35, volume: 0.55, noise: 0.50 },
  // Boss-summoned minion: a smaller, higher killpop so a minion death is
  // audibly not a roster kill.
  minionpop: { wave: 'square',   f0: 990,  f1: 1320, duration: 0.07, attack: 0.003, decay: 0.05, volume: 0.30 },
  uiclick:   { wave: 'square',   f0: 660,  f1: 660,  duration: 0.04, attack: 0.002, decay: 0.03, volume: 0.30 },
};

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

  function play(name) {
    const p = SOUNDS[name];
    if (!p) return;
    plays++;
    log.push(name);
    if (log.length > LOG_MAX) log.shift();
    // Muted still counts as a play: the log is what the GAME asked for, and the
    // probe needs it to line up with the events regardless of the mix.
    if (inert || !ctx || muted) return;
    try {
      const env = envelopeTimes(p);
      if (env.total <= 0) return;
      // A context can fall back to 'suspended' when a tab is backgrounded; a
      // resume() here is cheap and keeps sound alive on return without needing
      // a fresh gesture.
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t0 = ctx.currentTime + 0.001;                  // never schedule in the past
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
    }),
  };
}
