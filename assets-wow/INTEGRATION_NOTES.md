# Integration notes — environment art + SFX overhaul

For the integration wave. Nothing under web/ was touched by this track; all
deliverables live in assets-wow/ and tools/genart_v2.py (not imported by
anything). Regenerate everything deterministically: `python3 tools/genart_v2.py`
(seeds per candidate in MANIFEST.json).

## Winning candidates

| family | winner | seed | file | replaces |
|---|---|---|---|---|
| sky | sky_d | 104 | candidates/sky_d.png | assets-gen/par_stars.png (640x360 slot) |
| far mesas | mesa_e | 205 | candidates/mesa_e.png | assets-gen/par_mesas.png (640x120) |
| near rocks | rock_e | 305 | candidates/rock_e.png | assets-gen/par_rocks.png (640x80) |
| terrain | tiles_d | 404 | candidates/tiles_d.png | assets-gen/tiles.png (see frame map) |
| props | props_e | 505 | candidates/props_e.png | new sheet (3 cells 48x64) |
| title | title_d | 604 | candidates/title_d.png | new 640x360 title backdrop |

Full-scene sign-off composite: `mocks/final_scene.png`. Why each won:
CRITIQUE_LOG.md. Rules the art obeys: ART_DIRECTION.md.

## SFX winners

pew=alt2, hop=current, boost=alt1, burst=alt1, coin=alt1, hurt=alt2, ded=alt1,
killpop=alt2, bosshit=alt1, bossdown=alt1, minionpop=current, uiclick=alt1.
Table swap in web/engine/sfx.js SOUNDS; details in SFX_REPORT.md.

## Palette (expanded, supersedes the old pack-locked rule)

| role | hex |
|---|---|
| sky top / mid / horizon glow | #0b0914 / #161224 / #261c3a |
| mesa rim (front, dimmed) / base / back-row | #332852 / #251d3a / #161224 |
| rock highlight / midtone / base / shadow+AO | #4c3053 / #43294c / #42274a / #2a1635 |
| terrain crust / crust-seam / subsurface / deep fill / underside lip | #b85b66 / #4a2b42 / #8b3e54 / #5a2640 / #3a1a30 |
| pit edge leading highlight | #a5506b |
| accents (stars/glints only) | #eec548 gold, #aee6ff ice, #e8e4f0 star-white |
| far-ground haze (unchanged, still matches) | #2a1c33 |

## Pipeline changes needed at integration

1. **Tileset frame map changed.** New strip is 8 frames of 16x16 (128x16):
   0 surface, 1 fill, 2 edgeL (pit leading edge), 3 edgeR, 4 underside lip,
   5-6 surface variants, 7 fill variant. build_assets.py's GEN entry for
   `tiles` needs the new frame count; play.js's tile picker currently uses
   only frames 0/1 — wiring 2/3 at pit lips, 4 under floating platforms, and
   the variants at low probability (~15-30%) is where most of the "organic
   variety" payoff is. The final review's one remaining gap was exactly tile
   variety — the variant frames exist for this.
2. **Sky is opaque now** (gradient + stars in one 640x360 cell) — same
   par_stars draw slot works, it just fully covers the canvas clear color.
3. **Strips keep their sizes** (mesas 640x120, rocks 640x80) and the same
   `band()` biases; both still tile at 640.
4. **Floor depth bands** (play.js render step 2b, alphas .15/.3/.45) were
   reproduced in the mocks and look right over the new tiles — keep them.
5. **Props sheet** (3 cells 48x64) is new art for the scene's single-placement
   parallax pass; cells sit on the haze line in the mocks (bottom of cell at
   restLine+10).
6. **prop1/prop2 MUST SURVIVE.** The two small background cameo props already
   in the atlas (atlas names `prop1`, `prop2`, sources in assets-extra/) are
   placement-critical and stay in the game: re-composite them into the new
   background style (dim their outlines toward the mesa/rock palette the same
   way props_e does — no black outlines in the environment) but do not redraw
   or replace what they show.
7. **Title backdrop** is a full 640x360 plate; the title scene currently
   draws its own starfield — draw the plate first instead, keep the text/hero
   layout on top (hero staging can move out of the corner per R10).
8. **genart_v2.py is candidate tooling**, not the shipped generator. The
   integration wave should port the winning functions into genart.py (or
   promote genart_v2 wholesale) so build_assets.py keeps its single-entry
   build; until then nothing imports it.

## Open questions for the integration wave

- Tile variant probability + whether pit edge frames read better mirrored.
- Whether the win/wowend screens should reuse title_d as their backdrop.
- WOW ZONE tint: candidates are gauntlet-toned; a hue-rotated variant per mode
  is a 5-line addition to the winning generator if wanted.
- Boss arena: MEGA SAUCER is drawn over the sky band — sky_d's nebula sits in
  the upper-left; verify no readability clash at the arena camera height.
