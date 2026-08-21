// Terrain dressing math, kept pure so the unit suite can reach it without a
// canvas. Two jobs:
//   * pickTileFrame — which of the 10 tileset frames a solid cell wears. A
//     pure function of the cell's neighbourhood plus a coordinate hash, so the
//     tile render cache stays valid: the same (tx, ty) always answers the same
//     frame, and only a carve (which bumps the cache epoch) can change the
//     neighbourhood.
//   * floraIndexAt — whether a ground column carries a decor plant, and which
//     one. Same determinism contract: a pure function of the world column, so
//     every visit to a stretch of gauntlet grows the same garden.
//
// NO Math.random anywhere in here — the sim determinism rule extends to the
// render: two machines on the same frame must draw the same world.

/** 2D integer hash → uint32. Small, well-mixed, stable across engines. */
export function hash2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Tileset frame map (assets-wow production tiles.png, 10 frames of 16x16):
//   0 surface · 1 fill · 2 surface w/ lit LEFT edge (pit on the left) ·
//   3 surface w/ lit RIGHT edge · 4 underside lip · 5/6 surface variants ·
//   7 fill variant (ember fleck) · 8 pit wall, pit on the LEFT · 9 pit wall,
//   pit on the RIGHT.
export function pickTileFrame(level, tx, ty) {
  if (!level.solidAt(tx, ty - 1)) {                    // surface row
    if (!level.solidAt(tx - 1, ty)) return 2;          // pit opens to the left
    if (!level.solidAt(tx + 1, ty)) return 3;          // pit opens to the right
    const h = hash2(tx, ty);
    return h % 4 === 0 ? 5 + ((h >>> 8) & 1) : 0;      // ~25% worn variants
  }
  // Fill rows. The level's bottom edge reads non-solid (open bottom = pits
  // kill), so the lip test is bounds-guarded or the whole last slab row would
  // wear the floating-platform underside.
  if (ty + 1 < level.hTiles && !level.solidAt(tx, ty + 1)) return 4;   // underside lip
  if (!level.solidAt(tx - 1, ty)) return 8;            // pit wall, pit on the left
  if (!level.solidAt(tx + 1, ty)) return 9;
  return hash2(tx, ty) % 7 === 0 ? 7 : 1;              // ~14% ember fleck
}

// Flora family weights: the tiny sprouts (6/7) and low shrubs carry the
// density, the tall pieces (1 ribbed cactus, 5 amber bloom) land rarely so
// they read as landmarks rather than a hedge.
const FLORA_PICK = [6, 7, 6, 7, 3, 4, 2, 3, 4, 2, 0, 5, 1, 0, 6, 7];

/**
 * Decor plant for a world column, or -1. `floorTy` is the walked floor's tile
 * row; a plant only grows where that floor is intact (solid at floorTy, two
 * clear rows above — so pit lips, corridors and shelves stay clean).
 * Density ≈ 1 column in 8 → 3-5 pieces per 40-tile screen, mock-matched.
 */
export function floraIndexAt(level, tx, floorTy) {
  const h = hash2(tx, 9173);
  if (h % 8) return -1;
  if (!level.solidAt(tx, floorTy) ||
      level.solidAt(tx, floorTy - 1) || level.solidAt(tx, floorTy - 2)) return -1;
  return FLORA_PICK[(h >>> 8) % FLORA_PICK.length];
}
