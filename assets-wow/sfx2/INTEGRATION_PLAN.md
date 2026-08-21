# SFX round 2 — integration plan for `web/engine/sfx.js`

This round replaced runtime single-osc synthesis with pre-rendered, layered
sound design ("much premium" pass). Nothing under `web/` was touched; this is
the plan for the later integration wave.

## What ships

14 winner files (12 existing sounds + 2 new) + the remaining audition
candidates, all AAC-LC in `.m4a`
(the one compressed container every browser's `decodeAudioData` accepts —
Safari rejects ogg/opus, and raw WAV is 5-10x the bytes). Encoded at 64 kbps
mono from 44100 Hz peak-normalized (-1 dBFS) masters in `wav/`.

### Size table (all 42 candidates, final renders; winner in bold)

| sound | a | b | c | winner bytes |
|---|---|---|---|---|
| pew | 1859 | 1887 | **1878** | 1.9 KB (c) |
| hop | 2481 | **2403** | 2343 | 2.4 KB (b) |
| boost | 3377 | **3063** | 3285 | 3.1 KB (b) |
| burst | **2630** | 2582 | 2749 | 2.6 KB (a) |
| coin | **3915** | 3217 | 3619 | 3.9 KB (a) |
| hurt | **2949** | 2871 | 2809 | 2.9 KB (a) |
| ded | **13936** | 11780 | 11027 | 13.9 KB (a) |
| killpop | 2171 | **2190** | 2322 | 2.2 KB (b) |
| bosshit | **3171** | 3018 | 4674 | 3.2 KB (a) |
| bossdown | 14379 | 13539 | **17309** | 17.3 KB (c) |
| minionpop | **1725** | 1766 | 1822 | 1.7 KB (a) |
| uiclick | **1526** | 1576 | 1648 | 1.5 KB (a) |
| takeoff (new) | 26056 | **27522** | 26770 | 27.5 KB (b) |
| afktick (new) | **1635** | 1859 | 1757 | 1.6 KB (a) |

Totals: **all 42 files = 245,095 B (~239 KB)**, under the 400 KB
shipped-candidate budget; the 14 winners alone are ~85 KB (takeoff_b at
27.5 KB is the sanctioned exception file). All of it is well under one
music-track second of the existing 27 MB mp3 stream.

### Two NEW engine sound names

These do not exist in `SOUNDS` today; the integrator wires both:

- **`takeoff`** — ship-takeoff engine roar for the win finale. Trigger at the
  same site that starts the sequence in `web/game/scenes/play.js` (`takeoff = 0`,
  next to `jukebox?.playOneShot('fanfare')`, ~line 730). The asset is ~3.0-3.2s
  against the 2.5s frozen-world window on purpose: the tail rings into the win
  scene, which by design has no entry sting. It is mixed rumble/noise-forward
  so it never fights the fanfare's melody. Plays once per run; lazy-loading it
  at gate-open (or just fetching with the other 12) is fine. This one file is
  the sanctioned budget exception (~15-30 KB encoded).
- **`afktick`** — countdown tick for the AFK fail-safe. Fire once per second
  while the countdown overlay is showing, i.e. while
  `idleT >= AFK_WARN && outT < 0` (the same condition that draws the countdown,
  play.js ~line 1158). Up to 180 repetitions per incident: the candidates are
  bone-dry with near-zero tail for exactly this reason. Suggested trigger: on
  each change of `Math.ceil(left)`.

Both go through the same table/`play(name)` path as everything else — no new
API. `?test` silence and mute cover them automatically once they are table
entries.

## Preload strategy

Keep the engine's whole doctrine; only the voice source changes.

1. **Nothing before a gesture.** `unlock()` keeps creating the AudioContext
   lazily. The 14 default files (12 existing sounds + takeoff + afktick) are `fetch()`ed at `unlock()` time (first
   gesture), then `decodeAudioData`d into `AudioBuffer`s held in a map.
   ~85 KB over 14 requests is a non-event even on 3G; sounds that resolve
   before their first trigger simply play, and any `play()` arriving before
   its buffer resolves falls through to the synth fallback (below) — the game
   never waits on audio.
   - Optional hardening: `<link rel="prefetch">` the 14 URLs from index.html
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
5. **`sfx.current()` hook** grows one field: `loaded: <n of 14>` so the live
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
