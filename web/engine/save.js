// Versioned, corruption-proof persistence. Never throws, never crashes the game
// over a high score. Storage is injectable for tests.
// Treat .data as read-only; all writes go through patch().
const KEY = 'suchblast_v1';
// `audio` is a nested object like `best`, but unlike `best` it is NOT
// sub-merged by patch() — callers (the jukebox) always write the WHOLE audio
// object. Adding a second special case to patch() for it would make the merge
// rules something you have to remember instead of read.
export const DEFAULTS = {
  v: 1, best: { gauntlet: 0, wow: 0 }, wowUnlocked: false, muted: false,
  audio: { lastFirst: {}, muted: false },
  // Per-sound recipe picks from the sound test, name → candidate id. Same
  // whole-object write rule as `audio`: the one writer always patches the
  // complete map. Empty means "all defaults", and so does a save written
  // before the field existed — sfx.js's resolver treats absent and unknown
  // entries identically, so nothing here needs a version bump.
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
      // Only the SHAPE is enforced here (a non-object would crash the spread
      // in the writer); the VALUES stay unvalidated on purpose — sfx.js falls
      // back per-entry, and save.js knowing the sound list would be a second
      // copy of it to keep in sync.
      data.sfxPicks = typeof parsed.sfxPicks === 'object' && parsed.sfxPicks !== null
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
