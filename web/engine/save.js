// Versioned, corruption-proof persistence. Never throws, never crashes the game
// over a high score. Storage is injectable for tests.
// Treat .data as read-only; all writes go through patch().
const KEY = 'suchblast_v1';
// The sfxPicks GENERATION. 2 = the SFX v2 rendered set (the letters were
// renumbered when the synth candidates became rendered runners-up). Written
// by the audition screen on every keep; checked — never migrated — on load.
export const SFX_PICKS_V = 2;
// `audio` is a nested object like `best`, but unlike `best` it is NOT
// sub-merged by patch() — callers (the jukebox) always write the WHOLE audio
// object. Adding a second special case to patch() for it would make the merge
// rules something you have to remember instead of read.
export const DEFAULTS = {
  v: 1, best: { gauntlet: 0, wow: 0 }, wowUnlocked: false, muted: false,
  audio: { lastFirst: {}, muted: false },
  // Per-sound picks from the sound test, name → candidate id, plus a
  // GENERATION marker `v` (a number, deliberately not a sound name, so the
  // resolver's per-sound lookups never see it). Same whole-object write rule
  // as `audio`: the one writer (audition) always patches the complete map,
  // stamping the current generation. SFX v2 renumbered what the letters MEAN
  // (b/c used to be synth recipes; they are rendered runners-up now), so a
  // pick banked against the old letters is somebody else's choice — the load
  // below discards any picks map whose generation isn't current, falling
  // back to "all defaults" exactly like a pre-sound-test save.
  sfxPicks: {},
  // 'crisp' = integer device-pixel scale (letterboxed, every game pixel is a
  // whole number of hardware pixels). 'fill' = fractional scale that fills the
  // window. Flat string, so patch()'s plain spread handles it with no new merge
  // rule; a v1 save written before the setting existed simply has no key and
  // falls back to the default below.
  display: 'crisp',
};

export function makeSave(storage) {
  let data = structuredClone(DEFAULTS);
  try {
    const parsed = JSON.parse(storage.getItem(KEY));
    if (parsed && parsed.v === DEFAULTS.v) {
      data = { ...data, ...parsed };
      // A v1 save written before music existed has no audio key at all; the
      // version didn't change because nothing about the OLD keys changed.
      data.audio = { ...DEFAULTS.audio, ...(parsed.audio ?? {}) };
      // Same story as `audio`: added after v1 shipped, no version bump needed
      // because no OLD key changed meaning. Unknown values fall back rather
      // than being trusted — a hand-edited localStorage shouldn't be able to
      // put fit() into a mode it has no branch for.
      if (data.display !== 'crisp' && data.display !== 'fill') data.display = DEFAULTS.display;
      // Added after v1 shipped, same tolerant read as `audio`: absent → empty.
      // Only the SHAPE and the GENERATION are enforced here (a non-object
      // would crash the spread in the writer; picks from an older sound
      // generation point at sounds that no longer mean what they meant — see
      // SFX_PICKS_V at DEFAULTS); the VALUES stay unvalidated on purpose —
      // sfx.js falls back per-entry, and save.js knowing the sound list
      // would be a second copy of it to keep in sync.
      data.sfxPicks = typeof parsed.sfxPicks === 'object' && parsed.sfxPicks !== null &&
                      parsed.sfxPicks.v === SFX_PICKS_V
        ? { ...parsed.sfxPicks } : structuredClone(DEFAULTS.sfxPicks);
    }
  } catch { /* corrupt or unavailable → defaults */ }
  return {
    get data() { return data; },
    patch(p) {
      const best = p.best ? { ...data.best, ...p.best } : data.best;
      data = { ...data, ...p, best };
      if (!data.audio) data.audio = structuredClone(DEFAULTS.audio);   // old save, new schema
      if (!data.sfxPicks) data.sfxPicks = structuredClone(DEFAULTS.sfxPicks);   // ditto
      try { storage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode etc. */ }
    },
  };
}
