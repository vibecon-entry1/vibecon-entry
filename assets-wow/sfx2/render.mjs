#!/usr/bin/env node
// Offline SFX renderer for SUCH BLAST — round 2 ("much premium" pass).
//
// Round 1 stayed inside the engine's single-osc param vocabulary; this round
// deliberately does NOT. Every candidate here is rendered sound design:
// layered oscillators, FM pairs, phase-accurate pitch envelopes, biquad-shaped
// noise, tanh saturation, and small Schroeder reverb tails where a tail earns
// its bytes. Output is plain 16-bit mono WAV at 44100 Hz, peak-normalized to
// -1 dBFS; distribution encoding happens in a separate step (encode.sh).
//
// Zero npm deps. Deterministic: every stochastic element draws from a
// per-candidate seeded PRNG, so a re-render is byte-identical.
//
// Usage: node render.js [outdir=./wav] [--only <sound>]

'use strict';
import fs from 'node:fs';
import path from 'node:path';
const __dirname = new URL('.', import.meta.url).pathname;

const SR = 44100;
const PEAK = Math.pow(10, -1 / 20); // -1 dBFS

// ---------------------------------------------------------------- utilities

/** mulberry32 — tiny seeded PRNG, plenty for noise. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const sec = s => Math.round(s * SR);

/** Exponential glide f0→f1 across dur (musical, equal-ratio). */
const glide = (f0, f1, dur) => t => f0 * Math.pow(f1 / f0, Math.min(t / dur, 1));
/** Constant. */
const flat = f => () => f;
/** Stepped pitch plan: [[hz, holdSec], ...]. */
function steps(list) {
  return t => {
    let acc = 0;
    for (const [hz, hold] of list) { acc += hold; if (t < acc) return hz; }
    return list[list.length - 1][0];
  };
}

/** amp envelope: linear attack, optional hold, exponential decay (tau). */
function env({ a = 0.002, h = 0, tau = 0.05 }) {
  return t => {
    if (t < a) return t / a;
    const td = t - a - h;
    return td <= 0 ? 1 : Math.exp(-td / tau);
  };
}
/** bell-shaped swell (attack then symmetric-ish release), for whooshes. */
function bell({ a, r }) {
  return t => (t < a ? t / a : Math.max(0, 1 - (t - a) / r)) ** 1.5;
}

// ------------------------------------------------------------------- voices

function makeBuf(dur) { return new Float64Array(sec(dur)); }

/**
 * Phase-accumulating oscillator into buf.
 *   shape: sine|tri|saw|square  freq: t=>Hz  amp: t=>gain  vol: scalar
 *   fm: { ratio, index: t=>idx } — classic 2-op FM (mod is a sine at ratio*f).
 *   detune: cents offset. phase0: initial phase 0..1.
 */
function osc(buf, { shape = 'sine', freq, amp, vol = 1, fm = null, detune = 0, phase0 = 0 }) {
  let ph = phase0, mph = 0;
  const det = Math.pow(2, detune / 1200);
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const f = freq(t) * det;
    let p = ph;
    if (fm) {
      mph += (f * fm.ratio) / SR;
      p += Math.sin(2 * Math.PI * mph) * fm.index(t) / (2 * Math.PI);
    }
    const x = p - Math.floor(p);
    let s;
    switch (shape) {
      case 'sine':   s = Math.sin(2 * Math.PI * p); break;
      case 'tri':    s = 4 * Math.abs(x - 0.5) - 1; break;
      case 'saw':    s = 2 * x - 1; break;
      case 'square': s = x < 0.5 ? 1 : -1; break;
      default: throw new Error(shape);
    }
    buf[i] += s * amp(t) * vol;
    ph += f / SR;
  }
}

/** Seeded white noise through an optional swept biquad, into buf. */
function noise(buf, { amp, vol = 1, filter = null, rnd }) {
  const bi = filter ? biquad() : null;
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    let s = rnd() * 2 - 1;
    if (bi) {
      const f = typeof filter.f === 'function' ? filter.f(t) : filter.f;
      bi.set(filter.type, f, filter.q || 0.707);
      s = bi.run(s);
    }
    buf[i] += s * amp(t) * vol;
  }
}

/** RBJ biquad with per-sample retune (coeffs recomputed when f moves). */
function biquad() {
  let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0, lastF = -1, lastT = '';
  return {
    set(type, f, q) {
      if (f === lastF && type === lastT) return;
      lastF = f; lastT = type;
      const w = 2 * Math.PI * Math.min(f, SR * 0.45) / SR;
      const cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
      let a0;
      if (type === 'lp')      { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
      else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
      else                    { b0 = al; b1 = 0; b2 = -al; } // bp
      a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
      b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    },
    run(x) {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      return y;
    },
  };
}

/** Whole-buffer static filter pass. */
function filterBuf(buf, type, f, q = 0.707) {
  const bi = biquad(); bi.set(type, f, q);
  for (let i = 0; i < buf.length; i++) buf[i] = bi.run(buf[i]);
}

/** tanh drive. amount ~1 = gentle, 4+ = crunchy. */
function saturate(buf, amount) {
  const n = Math.tanh(amount);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * amount) / n;
}

/** Mix src into dst at offset seconds, scaled. */
function mixAt(dst, src, at = 0, vol = 1) {
  const o = sec(at);
  for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * vol;
}

/** Tiny Schroeder reverb (4 comb + 2 allpass), returns a LONGER buffer. */
function reverb(buf, { mix = 0.15, decay = 0.4, tail = 0.3, damp = 0.35 }) {
  const out = new Float64Array(buf.length + sec(tail));
  const combs = [1557, 1617, 1491, 1422].map(len => ({
    buf: new Float64Array(len), i: 0, lp: 0,
    fb: Math.pow(10, (-3 * len / SR) / decay), // -60dB over `decay` sec-ish
  }));
  const aps = [225, 556].map(len => ({ buf: new Float64Array(len), i: 0 }));
  for (let i = 0; i < out.length; i++) {
    const x = i < buf.length ? buf[i] : 0;
    let wet = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp = y * (1 - damp) + c.lp * damp;
      c.buf[c.i] = x + c.lp * c.fb;
      c.i = (c.i + 1) % c.buf.length;
      wet += y;
    }
    wet /= combs.length;
    for (const a of aps) {
      const y = a.buf[a.i];
      const v = x * 0 + wet + y * 0.5;
      a.buf[a.i] = v;
      a.i = (a.i + 1) % a.buf.length;
      wet = y - 0.5 * v;
    }
    out[i] = x + wet * mix;
  }
  return out;
}

/** DC-block + normalize to -1 dBFS peak. */
function finalize(buf) {
  // one-pole DC blocker
  let x1 = 0, y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = x - x1 + 0.995 * y1;
    x1 = x; y1 = y; buf[i] = y;
  }
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const g = peak > 0 ? PEAK / peak : 1;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  // short fade-out on the very last 3ms to kill any truncation click
  const f = Math.min(sec(0.003), buf.length);
  for (let i = 0; i < f; i++) buf[buf.length - 1 - i] *= i / f;
  return buf;
}

function rmsDb(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-12);
}

function writeWav(file, buf) {
  const n = buf.length;
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, data);
}

// ------------------------------------------------------- shared vocabulary
// Family tuning: everything sits in C. Note constants (equal temperament).
const C2 = 65.41, G2 = 98, C3 = 130.81, E3 = 164.81, G3 = 196, A3 = 220,
  C4 = 261.63, E4 = 329.63, F4 = 349.23, G4 = 392, Ab4 = 415.3, A4 = 440,
  C5 = 523.25, E5 = 659.26, G5 = 783.99, C6 = 1046.5, E6 = 1318.5,
  G6 = 1568, C7 = 2093, E7 = 2637;

/** A short seeded HP-noise click transient — the "thwack" every hit needs. */
function click(buf, rnd, { at = 0, dur = 0.004, f = 4000, vol = 0.5 }) {
  const c = makeBuf(dur + 0.002);
  noise(c, { amp: env({ a: 0.0004, tau: dur / 2 }), vol: 1, filter: { type: 'hp', f, q: 0.8 }, rnd });
  mixAt(buf, c, at, vol);
}

/** Inharmonic bell strike: partial list [[ratio, relVol, tau]], base Hz. */
function bellStrike(buf, { at = 0, base, partials, a = 0.001, vol = 1 }) {
  for (const [ratio, rv, tau] of partials) {
    const p = makeBuf(Math.min(tau * 5, buf.length / SR - at));
    if (p.length <= 0) continue;
    osc(p, { shape: 'sine', freq: flat(base * ratio), amp: env({ a, tau }), vol: rv });
    mixAt(buf, p, at, vol);
  }
}

// ------------------------------------------------------------- the designs
// Each candidate: { dur, tail?, build(buf, rnd) } — build layers into buf,
// optionally returns a replacement buffer (reverb/echo extend length).

const DESIGNS = {
  // ============ pew — player gun. Fires several times/sec: tight, dry,
  // characterful but zero fatigue. Top-tier refs: crisp laser with a real
  // transient and a fast, clean die-off.
  pew: {
    a: { // "fm zap": 2-op FM dart, downward, with a needle click.
      dur: 0.09,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(G6, G4, 0.07), amp: env({ a: 0.001, tau: 0.020 }),
          vol: 0.9, fm: { ratio: 2.001, index: t => 5 * Math.exp(-t / 0.015) } });
        click(buf, rnd, { dur: 0.003, f: 6000, vol: 0.35 });
        saturate(buf, 1.4);
      },
    },
    b: { // "detuned dart": twin saws a few cents apart through a closing LP.
      dur: 0.085,
      build(buf, rnd) {
        const body = makeBuf(0.085);
        osc(body, { shape: 'saw', freq: glide(C6, E4, 0.07), amp: env({ a: 0.001, tau: 0.022 }), vol: 0.5, detune: -7 });
        osc(body, { shape: 'saw', freq: glide(C6, E4, 0.07), amp: env({ a: 0.001, tau: 0.022 }), vol: 0.5, detune: 7 });
        filterBuf(body, 'lp', 5200, 0.9);
        mixAt(buf, body, 0, 1);
        click(buf, rnd, { dur: 0.0025, f: 7000, vol: 0.3 });
      },
    },
    c: { // "soft blaster": sine chirp + quiet square body, rounder, arcade-warm.
      dur: 0.08,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(C7, C5, 0.06), amp: env({ a: 0.001, tau: 0.017 }), vol: 0.85 });
        osc(buf, { shape: 'square', freq: glide(C6, C4, 0.06), amp: env({ a: 0.001, tau: 0.014 }), vol: 0.22 });
        click(buf, rnd, { dur: 0.002, f: 5000, vol: 0.25 });
      },
    },
  },

  // ============ hop — ground jump-shot recoil: body goes UP. Springy, light.
  hop: {
    a: { // "spring chirp": sine+octave chirp with a soft air puff underneath.
      dur: 0.15,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(E4, E5, 0.11), amp: env({ a: 0.006, tau: 0.05 }), vol: 0.8 });
        osc(buf, { shape: 'tri', freq: glide(E5, E6, 0.11), amp: env({ a: 0.006, tau: 0.035 }), vol: 0.22 });
        const puff = makeBuf(0.09);
        noise(puff, { amp: bell({ a: 0.015, r: 0.07 }), vol: 0.16, filter: { type: 'bp', f: glide(700, 2200, 0.09), q: 1.2 }, rnd });
        mixAt(buf, puff, 0, 1);
      },
    },
    b: { // "boing": FM spring — modulator gives it a rubbery snap.
      dur: 0.16,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(G4, G5, 0.12), amp: env({ a: 0.004, tau: 0.055 }),
          vol: 0.9, fm: { ratio: 1.5, index: t => 2.2 * Math.exp(-t / 0.05) } });
        click(buf, rnd, { dur: 0.003, f: 3000, vol: 0.12 });
      },
    },
    c: { // "pixel hop": bright tri two-step up (C5→G5) + air, more retro-melodic.
      dur: 0.13,
      build(buf, rnd) {
        osc(buf, { shape: 'tri', freq: steps([[C5, 0.05], [G5, 0.08]]), amp: env({ a: 0.004, h: 0.05, tau: 0.045 }), vol: 0.8 });
        osc(buf, { shape: 'sine', freq: steps([[C6, 0.05], [G6, 0.08]]), amp: env({ a: 0.004, h: 0.05, tau: 0.03 }), vol: 0.18 });
        const puff = makeBuf(0.06);
        noise(puff, { amp: bell({ a: 0.008, r: 0.05 }), vol: 0.1, filter: { type: 'hp', f: 3000, q: 0.8 }, rnd });
        mixAt(buf, puff, 0, 1);
      },
    },
  },

  // ============ boost — mid-air thrust: airy whoosh with body, bigger than hop.
  boost: {
    a: { // "jetpuff": swept bandpass noise swell + rising tri + sub anchor.
      dur: 0.26,
      build(buf, rnd) {
        noise(buf, { amp: bell({ a: 0.05, r: 0.19 }), vol: 0.55, filter: { type: 'bp', f: glide(500, 3200, 0.24), q: 1.6 }, rnd });
        osc(buf, { shape: 'tri', freq: glide(G3, G5, 0.22), amp: env({ a: 0.02, tau: 0.09 }), vol: 0.5 });
        osc(buf, { shape: 'sine', freq: glide(G2, G3, 0.22), amp: env({ a: 0.015, tau: 0.08 }), vol: 0.35 });
      },
    },
    b: { // "afterburner": saw through an opening LP, noisier, more mechanical.
      dur: 0.24,
      build(buf, rnd) {
        const body = makeBuf(0.24);
        osc(body, { shape: 'saw', freq: glide(C3, C5, 0.2), amp: env({ a: 0.015, tau: 0.09 }), vol: 0.55, detune: -5 });
        osc(body, { shape: 'saw', freq: glide(C3, C5, 0.2), amp: env({ a: 0.015, tau: 0.09 }), vol: 0.55, detune: 5 });
        // opening LP sells acceleration
        const bi = biquad();
        for (let i = 0; i < body.length; i++) { bi.set('lp', 600 + 5000 * (i / body.length) ** 1.4, 1.2); body[i] = bi.run(body[i]); }
        mixAt(buf, body, 0, 1);
        noise(buf, { amp: bell({ a: 0.04, r: 0.18 }), vol: 0.3, filter: { type: 'hp', f: 1800, q: 0.8 }, rnd });
        saturate(buf, 1.5);
      },
    },
    c: { // "updraft": pure airy — big filtered-noise gesture + faint FM whistle.
      dur: 0.25,
      build(buf, rnd) {
        noise(buf, { amp: bell({ a: 0.06, r: 0.18 }), vol: 0.7, filter: { type: 'bp', f: glide(400, 4200, 0.23), q: 2.4 }, rnd });
        osc(buf, { shape: 'sine', freq: glide(C4, C6, 0.22), amp: t => 0.2 * bell({ a: 0.07, r: 0.16 })(t),
          vol: 1, fm: { ratio: 2.01, index: () => 1.2 } });
      },
    },
  },

  // ============ burst — slide-burst: the SHOVE. Low, physical, punchy.
  burst: {
    a: { // "kick shove": saturated sine drop + gut-punch noise + tight click.
      dur: 0.18,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(E3, 49, 0.13), amp: env({ a: 0.002, tau: 0.06 }), vol: 1 });
        const th = makeBuf(0.1);
        noise(th, { amp: env({ a: 0.002, tau: 0.03 }), vol: 0.5, filter: { type: 'lp', f: 900, q: 0.9 }, rnd });
        mixAt(buf, th, 0, 1);
        click(buf, rnd, { dur: 0.003, f: 2500, vol: 0.3 });
        saturate(buf, 2.8);
      },
    },
    b: { // "fm slam": low FM punch, grittier midrange knock.
      dur: 0.17,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(C3, G2 / 2, 0.12), amp: env({ a: 0.002, tau: 0.055 }),
          vol: 1, fm: { ratio: 1.4, index: t => 6 * Math.exp(-t / 0.02) } });
        noise(buf, { amp: env({ a: 0.002, tau: 0.04 }), vol: 0.35, filter: { type: 'bp', f: 350, q: 1.1 }, rnd });
        saturate(buf, 2.2);
      },
    },
    c: { // "airblast": drop + broadband blast, more whoosh than thump.
      dur: 0.19,
      build(buf, rnd) {
        osc(buf, { shape: 'square', freq: glide(G3, C2, 0.14), amp: env({ a: 0.003, tau: 0.06 }), vol: 0.6 });
        noise(buf, { amp: env({ a: 0.003, tau: 0.055 }), vol: 0.55, filter: { type: 'lp', f: glide(2600, 400, 0.16), q: 0.9 }, rnd });
        saturate(buf, 1.8);
        filterBuf(buf, 'lp', 3200, 0.8);
      },
    },
  },

  // ============ coin — pickup: bright inharmonic sparkle-ping, fast decay,
  // must pierce a busy mix without being shrill.
  coin: {
    a: { // "two-step bell": classic C6→C7 step, but as real inharmonic strikes.
      dur: 0.34,
      build(buf, rnd) {
        const P = [[1, 1, 0.10], [2.52, 0.45, 0.06], [4.42, 0.2, 0.035]];
        bellStrike(buf, { at: 0, base: C6, partials: P, vol: 0.7 });
        bellStrike(buf, { at: 0.045, base: C7, partials: [[1, 1, 0.16], [2.52, 0.4, 0.09], [4.42, 0.18, 0.05]], vol: 0.9 });
        click(buf, rnd, { dur: 0.0015, f: 8000, vol: 0.15 });
      },
    },
    b: { // "fm chime": single FM bell hit, glassier, shortest of the three.
      dur: 0.24,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: flat(C7), amp: env({ a: 0.001, tau: 0.07 }),
          vol: 0.9, fm: { ratio: 3.53, index: t => 3.2 * Math.exp(-t / 0.04) } });
        osc(buf, { shape: 'sine', freq: flat(C6), amp: env({ a: 0.001, tau: 0.05 }), vol: 0.25 });
        click(buf, rnd, { dur: 0.0015, f: 9000, vol: 0.12 });
      },
    },
    c: { // "sparkle arp": C6-G6-C7 micro-arp with shimmering upper partials.
      dur: 0.3,
      build(buf, rnd) {
        const notes = [[C6, 0], [G6, 0.03], [C7, 0.06]];
        for (const [hz, at] of notes) {
          bellStrike(buf, { at, base: hz, partials: [[1, 1, 0.09], [3.01, 0.3, 0.05], [5.4, 0.12, 0.03]], vol: hz === C7 ? 0.9 : 0.55 });
        }
        click(buf, rnd, { dur: 0.001, f: 9000, vol: 0.1 });
      },
    },
  },

  // ============ hurt — taking damage: unmistakable from any shot. Falling,
  // crunchy, a little ugly on purpose — but designed-ugly, not cheap-ugly.
  hurt: {
    a: { // "crunch steps": three falling saturated steps with gated grit.
      dur: 0.2,
      build(buf, rnd) {
        const plan = steps([[A3, 0.06], [E3, 0.06], [110, 0.08]]);
        osc(buf, { shape: 'square', freq: plan, amp: env({ a: 0.003, h: 0.12, tau: 0.05 }), vol: 0.7 });
        osc(buf, { shape: 'square', freq: t => plan(t) / 2, amp: env({ a: 0.003, h: 0.12, tau: 0.05 }), vol: 0.3 });
        noise(buf, { amp: env({ a: 0.003, h: 0.1, tau: 0.05 }), vol: 0.4, filter: { type: 'bp', f: t => plan(t) * 5, q: 1.4 }, rnd });
        saturate(buf, 3);
        filterBuf(buf, 'lp', 4200, 0.8);
      },
    },
    b: { // "growl": FM snarl sweeping down — organic, animal, clearly damage.
      dur: 0.21,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(A3, 82, 0.17), amp: env({ a: 0.004, tau: 0.075 }),
          vol: 0.95, fm: { ratio: 0.5, index: t => 7 * Math.exp(-t / 0.09) } });
        noise(buf, { amp: env({ a: 0.004, tau: 0.06 }), vol: 0.3, filter: { type: 'bp', f: 700, q: 1.2 }, rnd });
        saturate(buf, 2.4);
      },
    },
    c: { // "static hit": detuned saw fall under heavy shaped noise, harsher.
      dur: 0.19,
      build(buf, rnd) {
        osc(buf, { shape: 'saw', freq: glide(C4, G2, 0.15), amp: env({ a: 0.003, tau: 0.065 }), vol: 0.5, detune: -12 });
        osc(buf, { shape: 'saw', freq: glide(C4, G2, 0.15), amp: env({ a: 0.003, tau: 0.065 }), vol: 0.5, detune: 12 });
        noise(buf, { amp: env({ a: 0.002, tau: 0.06 }), vol: 0.55, filter: { type: 'lp', f: glide(3500, 500, 0.17), q: 1 }, rnd });
        saturate(buf, 2.6);
      },
    },
  },

  // ============ ded — death jingle: the one melodic moment. Sad but classy;
  // a tail is allowed here.
  ded: {
    a: { // "last breath": C5-G4-E4-C4 descending, layered soft keys + reverb.
      dur: 0.95, tail: 0.45,
      build(buf, rnd) {
        const notes = [[C5, 0], [G4, 0.18], [E4, 0.36], [C4, 0.54]];
        for (const [hz, at] of notes) {
          const last = hz === C4;
          const n = makeBuf(last ? 0.4 : 0.22);
          osc(n, { shape: 'sine', freq: flat(hz), amp: env({ a: 0.008, tau: last ? 0.18 : 0.08 }), vol: 0.7 });
          osc(n, { shape: 'tri', freq: flat(hz * 2), amp: env({ a: 0.008, tau: last ? 0.12 : 0.06 }), vol: 0.2 });
          osc(n, { shape: 'sine', freq: flat(hz), amp: env({ a: 0.008, tau: last ? 0.18 : 0.08 }), vol: 0.35, detune: 6 });
          mixAt(buf, n, at, 1);
        }
        return reverb(buf, { mix: 0.22, decay: 0.6, tail: 0.45 });
      },
    },
    b: { // "minor fall": darker line C5-Ab4-F4-C4, square-ish console voice + echo.
      dur: 0.9, tail: 0.4,
      build(buf, rnd) {
        const notes = [[C5, 0], [Ab4, 0.17], [F4, 0.34], [C4, 0.51]];
        for (const [hz, at] of notes) {
          const last = hz === C4;
          const n = makeBuf(last ? 0.38 : 0.2);
          osc(n, { shape: 'square', freq: flat(hz), amp: env({ a: 0.006, tau: last ? 0.15 : 0.07 }), vol: 0.45 });
          osc(n, { shape: 'sine', freq: flat(hz), amp: env({ a: 0.006, tau: last ? 0.17 : 0.08 }), vol: 0.5 });
          mixAt(buf, n, at, 1);
        }
        filterBuf(buf, 'lp', 3000, 0.8);
        return reverb(buf, { mix: 0.18, decay: 0.5, tail: 0.4 });
      },
    },
    c: { // "deflate": one long vibrato slide C5→C4 — comic-sad, distinct shape.
      dur: 0.85, tail: 0.35,
      build(buf, rnd) {
        const base = glide(C5, C4, 0.7);
        osc(buf, { shape: 'tri', freq: t => base(t) * (1 + 0.02 * Math.sin(2 * Math.PI * 7 * t)), amp: env({ a: 0.01, h: 0.45, tau: 0.14 }), vol: 0.75 });
        osc(buf, { shape: 'sine', freq: t => 2 * base(t) * (1 + 0.02 * Math.sin(2 * Math.PI * 7 * t)), amp: env({ a: 0.01, h: 0.4, tau: 0.1 }), vol: 0.2 });
        return reverb(buf, { mix: 0.16, decay: 0.5, tail: 0.35 });
      },
    },
  },

  // ============ killpop — enemy kill: plays hundreds of times. Tight, juicy,
  // instantly readable, zero tail.
  killpop: {
    a: { // "juice pop": sine drop with click + tiny body thump.
      dur: 0.12,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(E5, E3, 0.09), amp: env({ a: 0.001, tau: 0.032 }), vol: 0.9 });
        click(buf, rnd, { dur: 0.003, f: 4500, vol: 0.4 });
        const th = makeBuf(0.06);
        noise(th, { amp: env({ a: 0.001, tau: 0.02 }), vol: 0.25, filter: { type: 'lp', f: 1200, q: 0.9 }, rnd });
        mixAt(buf, th, 0, 1);
        saturate(buf, 1.6);
      },
    },
    b: { // "fm pluck": snappy FM string-pluck feel.
      dur: 0.13,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(C5, C3, 0.1), amp: env({ a: 0.001, tau: 0.038 }),
          vol: 0.95, fm: { ratio: 1.99, index: t => 4 * Math.exp(-t / 0.018) } });
        click(buf, rnd, { dur: 0.002, f: 5500, vol: 0.25 });
      },
    },
    c: { // "squish pop": down-then-sub blip — cartoonier, more gross-out.
      dur: 0.13,
      build(buf, rnd) {
        osc(buf, { shape: 'square', freq: glide(G5, G3, 0.07), amp: env({ a: 0.001, tau: 0.025 }), vol: 0.5 });
        const sub = makeBuf(0.07);
        osc(sub, { shape: 'sine', freq: glide(G3, G2, 0.06), amp: env({ a: 0.002, tau: 0.025 }), vol: 0.8 });
        mixAt(buf, sub, 0.03, 1);
        noise(buf, { amp: env({ a: 0.001, tau: 0.015 }), vol: 0.18, filter: { type: 'bp', f: 2500, q: 1.2 }, rnd });
        saturate(buf, 1.8);
      },
    },
  },

  // ============ bosshit — boss taking a hit: thump WITH BODY, no clash with
  // player fire transients.
  bosshit: {
    a: { // "deep drum": 808-style drop + soft knock + low room.
      dur: 0.24,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(G2, 41, 0.16), amp: env({ a: 0.003, tau: 0.09 }), vol: 1 });
        const kn = makeBuf(0.05);
        noise(kn, { amp: env({ a: 0.002, tau: 0.014 }), vol: 0.4, filter: { type: 'bp', f: 650, q: 1.6 }, rnd });
        mixAt(buf, kn, 0, 1);
        saturate(buf, 2.2);
        filterBuf(buf, 'lp', 2200, 0.8);
      },
    },
    b: { // "hull hit": FM metal-adjacent impact — armor, not flesh.
      dur: 0.22,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(82, 45, 0.15), amp: env({ a: 0.003, tau: 0.08 }),
          vol: 1, fm: { ratio: 1.41, index: t => 5 * Math.exp(-t / 0.03) } });
        noise(buf, { amp: env({ a: 0.002, tau: 0.03 }), vol: 0.3, filter: { type: 'lp', f: 1400, q: 1 }, rnd });
        saturate(buf, 2.4);
      },
    },
    c: { // "gut thud": square body + sub + tiny dark room tail.
      dur: 0.26, tail: 0.12,
      build(buf, rnd) {
        osc(buf, { shape: 'square', freq: glide(110, 49, 0.14), amp: env({ a: 0.003, tau: 0.06 }), vol: 0.45 });
        osc(buf, { shape: 'sine', freq: glide(G2 / 1.5, 37, 0.16), amp: env({ a: 0.004, tau: 0.09 }), vol: 0.9 });
        noise(buf, { amp: env({ a: 0.002, tau: 0.025 }), vol: 0.25, filter: { type: 'lp', f: 900, q: 1 }, rnd });
        saturate(buf, 2);
        return reverb(buf, { mix: 0.1, decay: 0.3, tail: 0.12, damp: 0.6 });
      },
    },
  },

  // ============ bossdown — THE payoff. Explosion + triumph, the only big one.
  bossdown: {
    a: { // "detonation + fanfare": impact, rumble, debris, then a rising C-major
      // sparkle arp blooming out of the smoke.
      dur: 1.1, tail: 0.5,
      build(buf, rnd) {
        // impact
        osc(buf, { shape: 'sine', freq: glide(G2, 33, 0.3), amp: env({ a: 0.003, tau: 0.16 }), vol: 0.9 });
        click(buf, rnd, { dur: 0.005, f: 2000, vol: 0.5 });
        // explosion wash: LP noise closing down
        noise(buf, { amp: env({ a: 0.008, tau: 0.28 }), vol: 0.8, filter: { type: 'lp', f: glide(5200, 260, 0.9), q: 0.9 }, rnd });
        // rumble wobble
        osc(buf, { shape: 'sine', freq: t => 41 * (1 + 0.08 * Math.sin(2 * Math.PI * 9 * t)), amp: env({ a: 0.05, h: 0.2, tau: 0.25 }), vol: 0.35 });
        // triumph arp out of the smoke
        const arp = [[C5, 0.42], [E5, 0.5], [G5, 0.58], [C6, 0.66], [E6, 0.76], [G6, 0.86]];
        for (const [hz, at] of arp) {
          bellStrike(buf, { at, base: hz, partials: [[1, 1, 0.12], [2.52, 0.3, 0.06]], vol: 0.28 });
        }
        saturate(buf, 1.6);
        return reverb(buf, { mix: 0.2, decay: 0.8, tail: 0.5, damp: 0.4 });
      },
    },
    b: { // "power surge": detuned-saw riser into a slam + long dark tail.
      dur: 1.05, tail: 0.45,
      build(buf, rnd) {
        const rise = makeBuf(0.55);
        osc(rise, { shape: 'saw', freq: glide(G2, G5, 0.55), amp: t => Math.min(1, t / 0.5) * 0.5, vol: 1, detune: -9 });
        osc(rise, { shape: 'saw', freq: glide(G2, G5, 0.55), amp: t => Math.min(1, t / 0.5) * 0.5, vol: 1, detune: 9 });
        noise(rise, { amp: t => (t / 0.55) ** 2 * 0.5, vol: 1, filter: { type: 'bp', f: glide(600, 5000, 0.55), q: 1.6 }, rnd });
        mixAt(buf, rise, 0, 0.8);
        // slam at the top
        const slam = makeBuf(0.5);
        osc(slam, { shape: 'sine', freq: glide(C3, 33, 0.35), amp: env({ a: 0.003, tau: 0.18 }), vol: 1 });
        noise(slam, { amp: env({ a: 0.004, tau: 0.2 }), vol: 0.7, filter: { type: 'lp', f: glide(4000, 300, 0.45), q: 0.9 }, rnd });
        mixAt(buf, slam, 0.55, 1);
        saturate(buf, 2);
        return reverb(buf, { mix: 0.18, decay: 0.9, tail: 0.45, damp: 0.45 });
      },
    },
    c: { // "shatter bloom": big FM boom then glittering debris field.
      dur: 1.0, tail: 0.5,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(C3, 37, 0.4), amp: env({ a: 0.003, tau: 0.2 }),
          vol: 1, fm: { ratio: 0.71, index: t => 8 * Math.exp(-t / 0.08) } });
        noise(buf, { amp: env({ a: 0.005, tau: 0.22 }), vol: 0.6, filter: { type: 'lp', f: glide(4500, 350, 0.8), q: 0.9 }, rnd });
        // glitter debris: seeded random bell ticks raining down, C-family
        const tones = [C6, G5, E6, C7, G6, E5];
        for (let k = 0; k < 14; k++) {
          const at = 0.25 + rnd() * 0.55;
          const hz = tones[Math.floor(rnd() * tones.length)];
          bellStrike(buf, { at, base: hz, partials: [[1, 1, 0.05], [2.52, 0.3, 0.03]], vol: 0.1 + rnd() * 0.1 });
        }
        saturate(buf, 1.7);
        return reverb(buf, { mix: 0.22, decay: 0.85, tail: 0.5, damp: 0.4 });
      },
    },
  },

  // ============ minionpop — minion death: smaller+higher than killpop,
  // audibly "not a roster kill".
  minionpop: {
    a: { // "tick pop": tiny sine blip up with a pin click.
      dur: 0.07,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(E6, G6, 0.05), amp: env({ a: 0.001, tau: 0.018 }), vol: 0.85 });
        click(buf, rnd, { dur: 0.0015, f: 7000, vol: 0.3 });
      },
    },
    b: { // "fm spark": one FM tick, glassy.
      dur: 0.07,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: flat(G6), amp: env({ a: 0.0008, tau: 0.02 }),
          vol: 0.9, fm: { ratio: 2.99, index: t => 2.5 * Math.exp(-t / 0.01) } });
      },
    },
    c: { // "bubble": tiny up-chirp with a soft body, rounder.
      dur: 0.08,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: glide(C6, C7, 0.055), amp: env({ a: 0.002, tau: 0.022 }), vol: 0.8 });
        osc(buf, { shape: 'tri', freq: glide(C5, C6, 0.055), amp: env({ a: 0.002, tau: 0.018 }), vol: 0.2 });
      },
    },
  },

  // ============ uiclick — menus: soft + tactile, felt more than heard.
  uiclick: {
    a: { // "felt tap": bandpassed tick + damped sine, like a good keyboard.
      dur: 0.05,
      build(buf, rnd) {
        noise(buf, { amp: env({ a: 0.0005, tau: 0.006 }), vol: 0.5, filter: { type: 'bp', f: 1900, q: 2.2 }, rnd });
        osc(buf, { shape: 'sine', freq: flat(A4 * 2), amp: env({ a: 0.001, tau: 0.014 }), vol: 0.6 });
      },
    },
    b: { // "soft step": two-tone down G5→E5, sine, gentle.
      dur: 0.055,
      build(buf, rnd) {
        osc(buf, { shape: 'sine', freq: steps([[G5, 0.022], [E5, 0.033]]), amp: env({ a: 0.002, h: 0.02, tau: 0.016 }), vol: 0.8 });
      },
    },
    c: { // "wood tick": resonant woodblock-ish ping + faint low knock.
      dur: 0.06,
      build(buf, rnd) {
        noise(buf, { amp: env({ a: 0.0004, tau: 0.004 }), vol: 0.4, filter: { type: 'bp', f: 1250, q: 5 }, rnd });
        osc(buf, { shape: 'sine', freq: glide(1250, 1100, 0.03), amp: env({ a: 0.0008, tau: 0.018 }), vol: 0.7 });
        osc(buf, { shape: 'sine', freq: flat(A3), amp: env({ a: 0.001, tau: 0.012 }), vol: 0.15 });
      },
    },
  },
};

// ------------------------------------------------------------------ driver

function main() {
  const args = process.argv.slice(2);
  const onlyIx = args.indexOf('--only');
  const only = onlyIx >= 0 ? args[onlyIx + 1] : null;
  const outDir = args.filter((a, i) => a !== '--only' && i !== onlyIx + 1)[0] || path.join(__dirname, 'wav');
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const [name, variants] of Object.entries(DESIGNS)) {
    if (only && name !== only) continue;
    for (const [v, d] of Object.entries(variants)) {
      const rnd = rng(seedOf(`${name}_${v}`));
      let buf = makeBuf(d.dur);
      const replaced = d.build(buf, rnd);
      if (replaced) buf = replaced;
      finalize(buf);
      const file = path.join(outDir, `${name}_${v}.wav`);
      writeWav(file, buf);
      report.push({ name: `${name}_${v}`, dur: +(buf.length / SR).toFixed(3), rms: +rmsDb(buf).toFixed(1), bytes: fs.statSync(file).size });
    }
  }
  for (const r of report) console.log(`${r.name.padEnd(14)} ${String(r.dur).padStart(6)}s  RMS ${String(r.rms).padStart(6)} dB  ${r.bytes} B`);
}

main();
