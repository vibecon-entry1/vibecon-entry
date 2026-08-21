# SFX round 2 — integration plan for `web/engine/sfx.js`

This round replaced runtime single-osc synthesis with pre-rendered, layered
sound design ("much premium" pass). Nothing under `web/` was touched; this is
the plan for the later integration wave.

## What ships

12 winner files + the remaining audition candidates, all AAC-LC in `.m4a`
(the one compressed container every browser's `decodeAudioData` accepts —
Safari rejects ogg/opus, and raw WAV is 5-10x the bytes). Encoded at 64 kbps
mono from 44100 Hz peak-normalized (-1 dBFS) masters in `wav/`.

### Size table (all 36 candidates)

| sound | a | b | c | winner-only cost |
|---|---|---|---|---|
| pew | 1859 | 1887 | 1878 | ~1.9 KB |
| hop | 2448 | 2416 | 2343 | ~2.4 KB |
| boost | 3328 | 3104 | 3280 | ~3.3 KB |
| burst | 2600 | 2625 | 2749 | ~2.7 KB |
| coin | 3915 | 3217 | 3619 | ~3.9 KB |
| hurt | 2949 | 2871 | 2809 | ~2.9 KB |
| ded | 12770 | 11791 | 11027 | ~12.8 KB |
| killpop | 2171 | 2190 | 2322 | ~2.2 KB |
| bosshit | 3198 | 3018 | 4392 | ~3.2 KB |
| bossdown | 14348 | 13539 | 13592 | ~14.3 KB |
| minionpop | 1775 | 1766 | 1865 | ~1.8 KB |
| uiclick | 1526 | 1576 | 1648 | ~1.6 KB |

Totals: **all 36 files = 154,411 B (~151 KB)**; the 12 defaults alone are
~53 KB — both far under the 400 KB budget and well under one music-track
second of the existing 27 MB mp3 stream.

## Preload strategy

Keep the engine's whole doctrine; only the voice source changes.

1. **Nothing before a gesture.** `unlock()` keeps creating the AudioContext
   lazily. The 12 default files are `fetch()`ed at `unlock()` time (first
   gesture), then `decodeAudioData`d into `AudioBuffer`s held in a map.
   ~53 KB over 12 requests is a non-event even on 3G; sounds that resolve
   before their first trigger simply play, and any `play()` arriving before
   its buffer resolves falls through to the synth fallback (below) — the game
   never waits on audio.
   - Optional hardening: `<link rel="prefetch">` the 12 URLs from index.html
     so the bytes are usually in HTTP cache before unlock even runs; still
     zero audio-device usage before the gesture.
2. **`?test` stays silent.** The `enabled:false` build must not fetch at all:
   gate the fetch on `enabled`, same as context creation. The play-log
   bookkeeping (`plays`, `log`, `name#variant` tags) is untouched, so every
   existing e2e assertion holds.
3. **Playback path.** `play(name, variant)` resolves patch exactly as today
   (`resolvePatch` survives unchanged — picks, junk tolerance, preview
   override). If `buffers[name_variant]` exists: one `AudioBufferSourceNode`
   into the existing master gain (`MASTER 0.5` still applies; files are
   normalized so per-sound trim lives in a small `gain` column in the table).
   Mute/half-gain/current() diagnostics all sit on the master node and keep
   working as-is.
4. **Audition screen keeps working.** B/C candidate files are NOT preloaded;
   the sound-test screen lazy-fetches `<sound>_<v>.m4a` on first audition
   (it is a menu — a 50 ms fetch is imperceptible) and caches the decoded
   buffer for the session. A banked pick triggers a background fetch of that
   file so the next in-game trigger is warm.
5. **`sfx.current()` hook** grows one field: `loaded: <n of 12>` so the live
   probe can assert preload health. No existing field changes.

## Fallback question: keep the synth recipes if decode fails?

**Yes — keep them.** Reasoning:

- The entire synth engine already exists, is ~3 KB, has zero asset
  dependencies, and is covered by the unit + e2e suites. Deleting it buys
  nothing; keeping it turns every failure mode (offline reload with a cold
  cache, a CDN 404, a browser with a broken AAC decoder, a fetch blocked by
  an aggressive extension) into "the game sounds like it did last release"
  instead of silence.
- Failure-is-silent is the file's doctrine, but *degraded-is-better-than-
  silent* when degradation is free and already tested.
- Concretely: `play()` tries the decoded buffer first, else schedules the
  recipe voice. One `||` branch, no new code paths to test beyond "buffer
  missing" — which is also the pre-resolve path in item 1, so it is
  exercised on every fresh load anyway.

## Engine changes summary (later wave)

- `SOUNDS`/`CANDIDATES` tables gain a `file` field per variant, keep the
  recipe params as fallback.
- `unlock()`: + fetch/decode of default files (gated on `enabled`).
- `voice()`: + buffer branch (`createBufferSource` + per-sound trim gain).
- `current()`: + `loaded` count.
- No API change: `play(name, variant)`, `unlock()`, `setMuted()`, `isMuted()`,
  `resolvePatch()` signatures all stable; main.js and the test suites are
  untouched except new coverage for the buffer branch.
