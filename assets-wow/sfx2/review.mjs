#!/usr/bin/env node
// Audio-review loop: for one round, send each sound's candidate WAVs to the
// review API and collect comparative scores vs the bar "sounds like a polished
// commercial 2D platformer". One API call per sound (all candidates in the
// call, so scores are comparative, not absolute-drifting).
//
// Key: read from /root/.vibecon-secrets/cloudflare.env at runtime; never
// logged, never written anywhere.
//
// Usage: node review.mjs <wavdir> <round-label> [sound ...]
// Output: scores/<round-label>.json  (scores + verbatim critique per candidate)

import fs from 'node:fs';
import path from 'node:path';
const __dirname = new URL('.', import.meta.url).pathname;

const KEY = fs.readFileSync('/root/.vibecon-secrets/cloudflare.env', 'utf8')
  .split('\n').find(l => l.startsWith('GEMINI_API_KEY='))?.slice('GEMINI_API_KEY='.length).trim();
if (!KEY) { console.error('no key'); process.exit(1); }

const MODEL = 'audio-review-model';
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const ROLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts', 'roles.json'), 'utf8'));
const RUBRIC = fs.readFileSync(path.join(__dirname, 'prompts', 'rubric.txt'), 'utf8');

const [wavDir, label, ...onlyList] = process.argv.slice(2);
if (!wavDir || !label) { console.error('usage: review.mjs <wavdir> <label> [sound ...]'); process.exit(1); }

async function reviewSound(name) {
  const variants = ['a', 'b', 'c'].filter(v => fs.existsSync(path.join(wavDir, `${name}_${v}.wav`)));
  const parts = [{ text: RUBRIC.replace('{{ROLE}}', `Sound: "${name}". ${ROLES[name]}`).replace('{{VARIANTS}}', variants.join(', ')) }];
  for (const v of variants) {
    parts.push({ text: `Candidate ${v}:` });
    parts.push({ inlineData: { mimeType: 'audio/wav', data: fs.readFileSync(path.join(wavDir, `${name}_${v}.wav`)).toString('base64') } });
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`${name}: HTTP ${res.status} (attempt ${attempt}) ${t.slice(0, 200)}`);
      await new Promise(r => setTimeout(r, 4000 * attempt));
      continue;
    }
    const j = await res.json();
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    try {
      const parsed = JSON.parse(text);
      return { parsed, calls: attempt };
    } catch {
      console.error(`${name}: bad JSON (attempt ${attempt})`);
    }
  }
  return { parsed: null, calls: 4 };
}

const outDir = path.join(__dirname, 'scores');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${label}.json`);
const results = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { label, model: 'audio review', calls: 0, sounds: {} };

const names = onlyList.length ? onlyList : Object.keys(ROLES);
for (const name of names) {
  process.stderr.write(`reviewing ${name}... `);
  const { parsed, calls } = await reviewSound(name);
  results.calls += calls;
  if (parsed) { results.sounds[name] = parsed; console.error(`ok (${JSON.stringify(parsed.scores)})`); }
  else console.error('FAILED');
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
}
console.error(`total api calls so far in ${label}: ${results.calls}`);
