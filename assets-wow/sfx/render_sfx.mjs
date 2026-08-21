// Offline WAV renderer for the SFX candidate recipes. Reproduces the exact
// synthesis model of web/engine/sfx.js (same envelope scaling, exponential
// sweep, stepped notes, looped-noise texture layer, master gain) so a rendered
// candidate sounds the way the engine will play it. Deterministic: the noise
// layer uses a seeded PRNG, not Math.random.
//
// Usage: node render_sfx.mjs <recipes.json> <out_dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SR = 44100;
const MASTER = 0.5;           // sfx.js MASTER
const FLOOR = 0.0001;         // sfx.js FLOOR

// sfx.js envelopeTimes, verbatim behavior
function envelopeTimes(p) {
  const total = Math.max(0, p.duration || 0);
  let a = Math.max(0, p.attack || 0);
  let d = Math.max(0, p.decay || 0);
  const span = a + d;
  if (span > total && span > 0) { const k = total / span; a *= k; d *= k; }
  let sustain = total - a - d;
  if (!(sustain > 1e-9)) sustain = 0;
  return { attack: a, sustain, decay: d, peakAt: a, releaseAt: a + sustain, total };
}

// mulberry32 — same seeded PRNG family the game uses for determinism
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function osc(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'square':   return p < 0.5 ? 1 : -1;
    case 'sawtooth': return 2 * p - 1;
    case 'triangle': return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    default:         return 0;
  }
}

// gain envelope at time t: FLOOR →(linear)→ v, hold, →(exponential)→ FLOOR
function gainAt(t, v, env) {
  const atk = Math.max(0.001, env.attack);
  if (t < atk) return FLOOR + (v - FLOOR) * (t / atk);
  if (t < env.releaseAt) return v;
  const span = env.total - env.releaseAt;
  if (span <= 0) return v;
  const k = Math.min(1, (t - env.releaseAt) / span);
  return v * Math.pow(FLOOR / v, k);      // exponentialRamp equivalent
}

function freqAt(t, p, env) {
  if (p.notes && p.notes.length) {        // stepped: setValueAtTime per step
    const step = env.total / p.notes.length;
    const i = Math.min(p.notes.length - 1, Math.floor(t / step));
    return p.notes[i];
  }
  if (p.f1 === p.f0) return p.f0;
  return p.f0 * Math.pow(p.f1 / p.f0, t / env.total);   // exponential sweep
}

function render(p, seed) {
  const env = envelopeTimes(p);
  const n = Math.ceil((env.total + 0.03) * SR);
  const out = new Float64Array(n);
  const v = Math.max(FLOOR, p.volume);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (t >= env.total) break;
    phase += freqAt(t, p, env) / SR;
    out[i] += osc(p.wave, phase) * gainAt(t, v, env);
  }
  if (p.noise > 0) {                       // texture layer, own envelope copy
    const rnd = mulberry32(seed);
    const buf = new Float64Array(SR);      // 1s looped buffer, like sfx.js
    for (let i = 0; i < SR; i++) buf[i] = rnd() * 2 - 1;
    const nv = Math.max(FLOOR, p.volume * p.noise);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (t >= env.total) break;
      out[i] += buf[i % SR] * gainAt(t, nv, env);
    }
  }
  for (let i = 0; i < n; i++) out[i] *= MASTER;
  return out;
}

function wav16(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

const [recipesPath, outDir] = process.argv.slice(2);
const recipes = JSON.parse(readFileSync(recipesPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
let count = 0;
for (const [sound, variants] of Object.entries(recipes)) {
  if (sound.startsWith('_')) continue;
  for (const [vid, p] of Object.entries(variants)) {
    const samples = render(p, 1234567 + count);
    writeFileSync(join(outDir, `${sound}__${vid}.wav`), wav16(samples));
    count++;
  }
}
console.log(`rendered ${count} wavs to ${outDir}`);
