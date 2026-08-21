// Terrain dressing math, kept pure so the unit suite can reach it without a
// canvas. Two jobs:
//   * pickTileFrame — which of the 133 tileset frames a solid cell wears. A
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

// Tileset frame map (assets-wow production tiles.png, 133 frames of 16x16).
// The set encodes a CONTINUOUS 256x128 organic masonry band — irregular
// stones of mixed sizes, wandering courses, ember seams flowing along the
// joints, depth fade baked into the stonework (the approved hybrid_b floor):
//   0..15    surface course (walked crust), x phase tx mod 16
//   16..127  fill: 16 + (depth-1)*16 + phase, depth = solid rows above,
//            capped at 7 (the slab is 8 rows; deeper reuses the darkest)
//   128/129  surface pit edge, pit on the LEFT / RIGHT
//   130      underside lip (floating platforms)
//   131/132  pit wall, pit on the LEFT / RIGHT
// Phase + depth index adjacent windows of the same band, so any frame meshes
// with its neighbours and the super-pattern repeats every 16 tiles (256 px)
// with per-cell decal variation on top (play.js). Still a pure function of
// (tx, ty, neighbourhood) — the cache contract is unchanged.
export const TILE_PERIOD = 16;
export const FILL_DEPTH = 7;
export function pickTileFrame(level, tx, ty) {
  const ph = tx & 15;                                  // x phase, negatives safe
  if (!level.solidAt(tx, ty - 1)) {                    // surface row
    if (!level.solidAt(tx - 1, ty)) return 128;        // pit opens to the left
    if (!level.solidAt(tx + 1, ty)) return 129;        // pit opens to the right
    return ph;
  }
  // Fill rows. The level's bottom edge reads non-solid (open bottom = pits
  // kill), so the lip test is bounds-guarded or the whole last slab row would
  // wear the floating-platform underside.
  if (ty + 1 < level.hTiles && !level.solidAt(tx, ty + 1)) return 130; // underside lip
  if (!level.solidAt(tx - 1, ty)) return 131;          // pit wall, pit on the left
  if (!level.solidAt(tx + 1, ty)) return 132;
  let d = 1;                                           // depth below the surface
  while (d < FILL_DEPTH && level.solidAt(tx, ty - d - 1)) d++;
  return 16 + (d - 1) * 16 + ph;
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
