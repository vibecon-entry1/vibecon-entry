// Streaming music. HTMLAudioElement progressive playback ONLY — a pool is a
// list of filenames, and the element for a track is not created (let alone
// loaded) until that track is the one actually selected. Nothing is decoded up
// front, nothing is preloaded, and the 27MB of mp3 on disk costs a boot exactly
// one 650-byte manifest.json.
//
// Three rules the jukebox exists to enforce:
//   1. streaming        — preload='none', src assigned at selection time.
//   2. no repeat-first  — the first track of a session is random per pool, and
//                         never the same one the previous session opened with
//                         (persisted as save.data.audio.lastFirst[pool]).
//   3. cycle            — after that random start, advance in order on 'ended',
//                         wrapping. No reshuffle mid-session.
//
// Everything here is failure-tolerant by construction: a missing manifest makes
// the whole jukebox an inert no-op, a track that 404s skips to the next one, and
// every rejected play() promise is swallowed. Music must never be able to take
// the game down, and it must never put an error in the console — the e2e suite
// asserts an empty console, and the autoplay-blocked path (no user gesture yet)
// is the NORMAL path on a fresh page load.

/**
 * Random starting index for a pool that isn't `lastFirst`.
 * Pure + exported for unit tests. Pools are guaranteed >= 2 by the manifest, but
 * degenerate lengths are handled rather than trusted.
 */
export function pickFirst(poolLen, lastFirst, rnd = Math.random) {
  if (poolLen <= 1) return 0;
  // Re-roll rather than "pick from the other n-1 slots": with pools of 2-4 the
  // expected number of rolls is under 1.5, and re-rolling keeps the remaining
  // choices uniform. Bounded so a pathological rnd() can't spin forever.
  for (let k = 0; k < 16; k++) {
    const i = Math.min(poolLen - 1, Math.floor(rnd() * poolLen));
    if (i !== lastFirst) return i;
  }
  return (((lastFirst | 0) + 1) % poolLen + poolLen) % poolLen;
}

/** Cycle step. Exported for the same reason: it's the whole of rule 3. */
export function nextIndex(i, len) {
  return len > 0 ? (i + 1) % len : 0;
}

const DUCKED = 0.35, FULL = 1.0;

/**
 * makeJukebox({ save }) → the audio API used by main.js and the scenes.
 * Constructed synchronously; the manifest lands later and any playPool() made
 * before then is remembered as intent (same mechanism as the autoplay gate).
 *
 * `enabled: false` builds a fully-formed but silent jukebox — used by the ?test
 * boot so the e2e suite (which drives play with hundreds of synthetic key
 * presses, every one of them a trusted gesture) never starts streaming a 3MB
 * run track. The real audio path is covered by the plain-'/' audio spec.
 */
export function makeJukebox({
  save,
  base = 'assets/audio/',
  enabled = true,
  rnd = Math.random,
  AudioCtor = typeof Audio !== 'undefined' ? Audio : null,
} = {}) {
  let manifest = null;
  let inert = !enabled || !AudioCtor;
  let unlocked = false;         // has a real user gesture happened yet?
  let pending = null;           // pool requested before manifest/gesture
  let cur = null;               // { pool, idx, el }
  let ducked = false;
  let muted = !!save?.data?.audio?.muted;
  let warned = false;

  // At most ONE console.warn for the entire lifetime of the page. A blocked
  // autoplay promise is expected, not exceptional, and a per-track warn would
  // turn a normal session into a wall of noise (and fail the console-clean e2e
  // if it ever got promoted to error).
  const warn = msg => { if (!warned) { warned = true; console.warn(`[audio] ${msg}`); } };

  const volume = () => (ducked ? DUCKED : FULL);

  function poolOf(name) {
    const p = manifest?.pools?.[name];
    return Array.isArray(p) && p.length ? p : null;
  }

  // Writes the whole audio object every time: save.patch() shallow-merges, and
  // only `best` gets special sub-merge treatment, so a partial { audio: {...} }
  // would silently drop the sibling key.
  function persist() {
    save?.patch({ audio: { lastFirst: { ...(save.data.audio?.lastFirst ?? {}) }, muted } });
  }

  function rememberFirst(pool, idx) {
    if (!save) return;
    const lastFirst = { ...(save.data.audio?.lastFirst ?? {}), [pool]: idx };
    save.patch({ audio: { lastFirst, muted } });
  }

  // Kill an element for good. `dead` is checked by the handlers below: pausing
  // and clearing src can itself fire 'error' in some engines, and a teardown
  // must not be mistaken for a bad track and advance the pool.
  function teardown(el) {
    if (!el) return;
    el.dead = true;
    try { el.pause(); el.removeAttribute('src'); } catch { /* nothing to do */ }
  }

  // tried = how many members of this pool have failed to load in a row; once
  // that reaches the pool size the whole pool is unplayable and we stop rather
  // than spin through 404s forever.
  function start(pool, idx, tried = 0) {
    const list = poolOf(pool);
    if (!list || tried >= list.length) { cur = null; return; }
    const el = new AudioCtor();
    el.preload = 'none';                 // rule 1: nothing loads until play()
    el.loop = false;                     // rule 3 needs the 'ended' event
    el.volume = volume();
    el.muted = muted;                    // hard mute, independent of volume
    el.src = base + list[idx];
    el.addEventListener('error', () => {
      if (el.dead || cur?.el !== el) return;
      teardown(el);
      start(pool, nextIndex(idx, list.length), tried + 1);
    });
    el.addEventListener('ended', () => {
      if (el.dead || cur?.el !== el) return;
      teardown(el);
      start(pool, nextIndex(idx, list.length), 0);   // a clean finish resets the failure count
    });
    cur = { pool, idx, el };
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => warn('playback blocked or interrupted'));
  }

  function stopMusic() {
    if (!cur) return;
    teardown(cur.el);
    cur = null;
    pending = null;
  }

  function playPool(name) {
    if (inert) return;
    // Intent, not playback: before the manifest lands or before the first user
    // gesture, remember what the game wanted and let unlock() (or the manifest
    // resolution) start it. Scenes never have to know which state we're in.
    if (!manifest || !unlocked) { pending = name; return; }
    if (cur?.pool === name) return;                  // already on this pool: don't restart
    stopMusic();
    const list = poolOf(name);
    if (!list) return;
    const idx = pickFirst(list.length, save?.data?.audio?.lastFirst?.[name], rnd);
    rememberFirst(name, idx);                        // rule 2, banked before a note plays
    start(name, idx, 0);
  }

  // One-shot (fanfare): random member, no lastFirst bookkeeping, no cycling, and
  // deliberately NOT tracked as `cur` so it can't be stopped by the next
  // playPool() and doesn't count as the running music.
  function playOneShot(name) {
    if (inert || !manifest || !unlocked) return;
    const list = poolOf(name);
    if (!list) return;
    const el = new AudioCtor();
    el.preload = 'none';
    el.volume = volume();
    el.muted = muted;
    el.src = base + list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
    el.addEventListener('ended', () => teardown(el));
    el.addEventListener('error', () => teardown(el));
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => warn('playback blocked or interrupted'));
  }

  function setDuck(on) {
    ducked = !!on;
    if (cur) cur.el.volume = volume();
  }

  function toggleMute() {
    muted = !muted;
    if (cur) cur.el.muted = muted;
    persist();
    return muted;
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    if (pending && !inert) { const p = pending; pending = null; playPool(p); }
  }

  // Manifest fetch is fire-and-forget. On failure the jukebox goes permanently
  // inert: the game keeps running, silently.
  if (!inert) {
    fetch(base + 'manifest.json')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(m => {
        manifest = m;
        if (pending && unlocked) { const p = pending; pending = null; playPool(p); }
      })
      .catch(() => { inert = true; warn('manifest unavailable — music disabled'); });
  }

  return {
    playPool, stopMusic, playOneShot, setDuck, toggleMute, unlock,
    current: () => ({
      pool: cur?.pool ?? null,
      index: cur?.idx ?? -1,
      track: cur ? poolOf(cur.pool)?.[cur.idx] ?? null : null,
      muted, ducked, unlocked, inert, pending,
      ready: !!manifest,
      // Live element readings: the Audio elements are never in the DOM, so this
      // is the only way a smoke test (or a bug report) can see what the browser
      // is actually doing with the volume and the stream.
      volume: cur ? cur.el.volume : null,
      time: cur ? cur.el.currentTime : null,
      paused: cur ? cur.el.paused : null,
      elMuted: cur ? cur.el.muted : null,   // proof mute is a HARD element mute, not volume 0
    }),
  };
}
