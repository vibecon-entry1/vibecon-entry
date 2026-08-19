// Versioned, corruption-proof persistence. Never throws, never crashes the game
// over a high score. Storage is injectable for tests.
// Treat .data as read-only; all writes go through patch().
const KEY = 'suchblast_v1';
export const DEFAULTS = { v: 1, best: { gauntlet: 0, wow: 0 }, wowUnlocked: false, muted: false };

export function makeSave(storage) {
  let data = structuredClone(DEFAULTS);
  try {
    const parsed = JSON.parse(storage.getItem(KEY));
    if (parsed && parsed.v === DEFAULTS.v) data = { ...data, ...parsed };
  } catch { /* corrupt or unavailable → defaults */ }
  return {
    get data() { return data; },
    patch(p) {
      const best = p.best ? { ...data.best, ...p.best } : data.best;
      data = { ...data, ...p, best };
      try { storage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode etc. */ }
    },
  };
}
