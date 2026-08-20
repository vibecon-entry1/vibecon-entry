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
    }
  } catch { /* corrupt or unavailable → defaults */ }
  return {
    get data() { return data; },
    patch(p) {
      const best = p.best ? { ...data.best, ...p.best } : data.best;
      data = { ...data, ...p, best };
      if (!data.audio) data.audio = structuredClone(DEFAULTS.audio);   // old save, new schema
      try { storage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode etc. */ }
    },
  };
}
