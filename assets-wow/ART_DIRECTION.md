# SUCH BLAST — art direction (environment overhaul)

Quality bar: much premium. Shovel Knight / Celeste-tier environment polish while
keeping the Mars-at-night identity and the untouchable official hero/enemy
sprites (bright, black-outlined, flat-shaded — the environment must ground
them, never compete with them).

Baseline plates: `assets-wow/baseline/*.png`. A vision review of the baseline
against that bar produced the findings distilled below into executable rules.

## Baseline verdict (condensed)

- One flat color per layer, zero hue shifting, zero ramps: sky is flat black,
  mesas are flat navy pills with a stray lighter square, near rocks are flat
  purple triangles, ground is a slab with a harsh 1px neon seam and 1px
  checkerboard noise that reads as static.
- No light source, no rim light, no ambient occlusion, no underside/edge
  treatment on platforms.
- Readability hazard: near rocks share the ground's base purple — they can be
  mistaken for walkable foreground.
- Title screen is a black void with the hero pushed into a corner.

## Executable rules

R1 — VALUE HIERARCHY (relative brightness, back to front):
    sky 0-10% → far mesas 15-25% → near rocks 30-40% → terrain fill ~50% →
    walkable crust ~70%. Each layer strictly brighter than the one behind it.

R2 — OUTLINES: no black outlines anywhere in the environment. Black outlines
    belong to the sprites; environment separates by value/hue only, so sprites
    always pop.

R3 — RAMPS + HUE SHIFT: 3-4 values per material, shadows shift cool
    (toward indigo/blue, roughly +20..40° toward 240), highlights shift warm
    (toward terracotta/rose). Never lighten/darken a hue in place.

R4 — PALETTE (expanded, curated; harmonizes with hero #eec548 fur /
    #1e2f51 jacket / #aee6ff tie / #ff0000 gun — the jacket navy is the sky
    family, the fur gold is echoed only in coins, stars, and warm crust light):
      sky:        #0b0914 top → #161224 mid → #261c3a horizon glow
      far mesas:  #3a2e5d rim / #251d3a base / #161224 shadow (blends to sky)
      near rocks: #633e6b lit facet / #42274a base / #2a1635 shadow + AO
      terrain:    #b85b66 crust light / #8b3e54 subsurface / #5a2640 deep fill
                  / #3a1a30 underside lip
      accents:    #eec548 gold sparkle (stars/coins only), #aee6ff ice glints

R5 — DITHERING POLICY: 2x2 Bayer dither ONLY at sky band transitions (and
    inside nebula bodies). Nowhere else. No checkerboard noise on terrain.

R6 — SKY: vertical gradient (dark top → faint warm horizon glow), star
    hierarchy in 3 passes: dim 1px (horizon-glow color, dense), mid 1px
    (rock-highlight color, medium), bright 2x2 cross / gold twinkle (sparse).
    Optional nebula wisps in the mesa-highlight family, dithered edges.

R7 — SILHOUETTES: mesas are terraced/stepped (8-32px horizontal steps, flat
    plateaus, cragged shoulders), never rounded pills; every horizontal step
    top gets a 1px rim light. Near rocks are jagged stair-stepped clusters
    (up 2 over 1, up 3 over 2 ...) with a lit side and a shadow side, never
    clean triangles.

R8 — GROUNDING: 2px ambient-occlusion line in rock-shadow where near rocks
    meet the ground band. Sprite ground contact is handled by the engine
    (unchanged).

R9 — TERRAIN TILE ANATOMY (16x16 autotile):
    crust = top 1px solid #b85b66, rows 2-3 streaked #b85b66/#8b3e54
    (horizontal streaks, not noise); subsurface = 4-8px of #8b3e54 breakup;
    deep fill = #5a2640 with sparse 2px horizontal sediment lines of #8b3e54;
    platform undersides get a 1px #3a1a30 lip; vertical pit/wall edges get a
    1px #8b3e54 leading-edge highlight so the cut reads against the void.

R10 — TITLE: full generated vista backdrop (planet curve or sweeping mesa
    landscape), hero staged in composition, not cornered.

The exact winning candidate per family + scores live in CRITIQUE_LOG.md;
integration facts in INTEGRATION_NOTES.md.
