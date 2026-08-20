# Critique log — environment art candidates

Every round was scored by an independent vision review of the composite mocks
in `assets-wow/mocks/` (scores 1-10: READ = playfield/hazard readability,
HARM = palette harmony with the official hero sprite, POLISH = premium
commercial-pixel impression). Seeds per candidate live in `MANIFEST.json`.

## Round 0 — baseline art direction

Baseline plates (assets-wow/baseline/) reviewed against Shovel Knight /
Celeste-tier: "not an environment, a wireframe blockout" — flat single-color
layers, no ramps, no light source, near rocks confusable with foreground,
neon terrain seam, checkerboard noise. Distilled into ART_DIRECTION.md rules
R1-R10.

## Round 1 — 2-3 candidates per family (over the 'a' base set)

| family | cand | READ | HARM | POLISH | verdict |
|---|---|---|---|---|---|
| sky | a gradient+stars | 6 | 5 | 4 | too barren |
| sky | b nebula | 5.5 | 6 | 6 | **winner** — depth, ties to mesas |
| sky | c galaxy band | 4.5 | 4.5 | 5 | star noise fights projectiles |
| mesa | a single-row terraced | 5 | 6 | 4 | dither clutter |
| mesa | b two-row terraced | 7 | 6 | 7 | **winner** — best depth/separation |
| mesa | c low plateaus | 6 | 6 | 3 | reads unfinished |
| rock | a jagged lit/shadow | 6 | 6 | 5 | **winner** |
| rock | b dense+pebbles | 5 | 6 | 4 | blends into mesas |
| rock | c tall shards | 3 | 4 | 4 | highlights pull to foreground |
| tiles | a rule-R9 anatomy | 7 | 6 | 6 | **winner** |
| tiles | b pebbly | 4 | 4 | 3 | high-frequency noise |
| tiles | c mauve crust | 7 | 6 | 4 | too empty |
| props | a black-outline set | 4 | 5 | 4 | outlines fight sprites |
| props | b soft-edge set | 6 | 6 | 6 | **winner** |
| title | a planet curve | 6 | 6 | 4 | jagged arc stepping |
| title | b canyon vista | 6 | 6 | 5 | **winner** |

Round-1 flags: star density vs projectiles; spiky silhouettes read as hazard
spikes; pit edges undefined.

## Round 2 — refined winners ('d' variants) vs round-1 winners

| family | pair | verdict |
|---|---|---|
| sky | b vs d | **d wins** (6/5.5/5.5 vs 5/5/4) — cooler sparser stars, less noise |
| mesa | b vs d | b holds (6/6/6 vs 5/5/4) — d over-receded, washed out |
| rock | a vs d | ambiguous — cross-base comparison confounded the judge |
| tiles | a vs d | **d wins** (6/5/4 vs 5/5/4) — better edge visibility |
| props | b vs d | ambiguous — same confound |
| title | b vs d | **d wins** (7/6/6 vs 6/6/4) — raised black point, floor texture |

Round-2 mocks composed candidate-under-test over the full refined base, which
crossed two variables for mesa/rock/props → round 3 isolates them.

## Round 3 — isolation tie-breaks (identical base, only family varies)

| family | pair | scores | final |
|---|---|---|---|
| mesa | b_iso vs d_iso | 7/6/6 vs 5/5/4 | **mesa_b** (rim dim noted) |
| rock | a_iso vs d_iso | 6/6/4 vs 4/5/6 | **rock_d** for technique; fixes: dim highlight, widen flat tops |
| props | b_iso vs d_iso | 7/6/4 vs 6/6/6 | **props_d**; fixes: dim top-edge light |

## Final pass — 'e' variants fold in the last fixes

- mesa_e (seed 205): mesa_b silhouettes, rim dimmed one step (#332852).
- rock_e (seed 305): rock_d, highlights down a value step (#4c3053/#43294c),
  flat tops widened to ≥4px.
- props_e (seed 505): props_d, top edge light dimmed to #332852.

Winning set: **sky_d (104) + mesa_e (205) + rock_e (305) + tiles_d (404) +
props_e (505) + title_d (604)** — composed in `mocks/final_scene.png`.

Final before/after sign-off review (baseline 03_mid_run vs final_scene):
READ 6, HARM 6, POLISH 5 — "confirmed clear upgrade"; biggest remaining gap:
foreground tile variety / organic decoration (cracks, edge transitions),
logged as an open item in INTEGRATION_NOTES.md.

## Round 4 — REDO: direction sheets (supersedes the round 1-3 winning set)

The round 1-3 winning set was REJECTED at user review ("reads as the same game
slightly darker") — the loop had converged on timidity by optimizing harmony
with the baseline. Method change: art is now sourced by prompted image
generation (prompts + raw outputs under assets-wow/raw/), post-processed to
native 640x360 fidelity and quantized by tools/genart_v2_post.py, with a hard
divergence floor (mean absolute RGB delta vs baseline plate >= 25). Four
radically distinct worlds, committed to assets-wow/directions/ for a USER
taste pick before any refinement.

| sheet | divergence | colors | READ | HARM | EXEC | review notes |
|---|---|---|---|---|---|---|
| dir1_sunset_canyon | 65.94 | 40 | 6 | 4 | 4 | bright ground line clear; sky banding noted |
| dir2_neon_abyss | 26.29 | 40 | 7 | 4 | 6 | neon ground vs dark world = instant read; hero warm-vs-cool contrast |
| dir3_butterscotch_day | 123.99 | 36 | 4 | 5 | 6 | cleanest commercial execution; tan hero risks blending — needs contrast handling if picked |
| dir4_moss_dusk | 60.87 | 40 | 5 | 6 | 7 | strongest texturing; arches must not read walkable |

Review scope was readability / sprite harmony / execution only — similarity to
the current game was explicitly excluded. Sprite ground lines were nudged
1-3px after the review flagged minor float/sink. Awaiting user direction pick;
no refinement rounds until then.
