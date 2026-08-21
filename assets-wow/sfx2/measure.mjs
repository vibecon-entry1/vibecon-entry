#!/usr/bin/env node
// Family-coherence measurements: per-file duration, peak, RMS dB, and spectral
// centroid (brightness proxy) straight off the rendered WAVs. Used by the
// coherence pass in RANKINGS.md.
// Usage: node measure.mjs <wavdir> [name_variant ...]
import fs from 'node:fs';
import path from 'node:path';

const [dir, ...only] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.wav'))
  .filter(f => !only.length || only.includes(f.replace('.wav', '')));

for (const f of files.sort()) {
  const b = fs.readFileSync(path.join(dir, f));
  const sr = b.readUInt32LE(24);
  const n = b.readUInt32LE(40) / 2;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768;
  let peak = 0, sum = 0;
  for (const v of x) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  // spectral centroid via zero-padded DFT is overkill; use a Goertzel-free
  // estimate: centroid of |FFT| with a simple radix-2 on the first pow2 chunk.
  const N = 1 << Math.min(14, 31 - Math.clz32(n));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < Math.min(N, n); i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  fft(re, im);
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    num += (k * sr / N) * m; den += m;
  }
  console.log(`${f.replace('.wav', '').padEnd(14)} ${(n / sr).toFixed(3)}s  peak ${(20 * Math.log10(peak)).toFixed(1)} dB  rms ${(10 * Math.log10(sum / n)).toFixed(1)} dB  centroid ${(num / den).toFixed(0)} Hz`);
}

function fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
}
