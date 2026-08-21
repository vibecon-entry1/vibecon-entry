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

## Round 5 — hybrid direction sheets (dir1 x dir3), pre-pick addition

Two hybrids requested before the final pick; same pipeline (prompt + raw under
assets-wow/raw/, craft pass in tools/genart_v2_post.py). Both carry the
readability treatment flagged for dir3: the walkable band is darker/cooler
than the sky with a lit top edge, and hybrid_a additionally gets a cool-darken
pass (x0.80/0.76/0.86) on the pale plain band directly behind the sprite zone.

| sheet | divergence | colors | READ | HARM | EXEC | review notes |
|---|---|---|---|---|---|---|
| hybrid_a_golden_hour | 112.08 | 40 | 4 | 4 | 5 | bright-world identity keeps the tan hero at risk of blending even after the band treatment — same tension as dir3; pick implies a stronger hero-separation treatment (e.g. darker mid-band or hero drop shadow) |
| hybrid_b_late_afternoon | 82.18 | 40 | 6 | 6 | 6 | darker molten ground + amber sky frame the sprites well; best-scoring warm option |

Placement: walker feet verified by pixel measurement to sit on the lit edge
(within 2px of anim-bbox slack); the reviewer's floating/sunk flags oscillated
across nudges and are judged a perception artifact of the thin grey legs on a
busy edge — not chased further.

Awaiting the user's final pick across all SIX directions (dir1-dir4 +
hybrid_a/b); dir2 production remains ON HOLD per coordinator.

## Round 6 — PRODUCTION (hybrid_b_late_afternoon picked by the user)

Full production set built from the prod_* raws by tools/genart_v2_prod.py;
every round scored by an independent vision review of the six full-scene
mocks in production/mocks/ (READ / HARM / EXEC as before, plus HERO_SEP =
hero-vs-backdrop separation). Four review rounds; per-mock scores
(READ/HARM/EXEC/HERO_SEP):

| mock | round 1 | round 2 | round 3 | round 4 (final) |
|---|---|---|---|---|
| gauntlet_early | 5/6/4/6 | 6/6/5/6 | 6/5/5/6 | 6/6/5/7 |
| gauntlet_late | 6/6/5/6 | 6/6/5/6 | 6/6/5/6 | 6/6/5/6 |
| boss_arena | 6/6/4/6 | 6/5/4/6 | 6/5/4/6 | 6/6/5/6 |
| wow_zone | 5/6/5/6 | 6/6/5/6 | 6/6/5/6 | 6/6/5/7 |
| title | 5/6/6/6 | 6/6/7/6 | 5/6/6/7 | 5/6/6/6 |
| win_ship | 5/5/4/4 | 6/5/4/6 | 5/6/4/5 | 5/6/4/6 |

What each round fixed:

- R1→R2: skies rebuilt as clean banded gradients (row-mean + ordered dither
  between palette neighbors) killing the blotchy upscaled dither; pit went
  from flat gap to void gradient + lit-edge surface tiles + ember-cracked
  wall frames; sun cameo enlarged with slat cuts moved above center so they
  survive the mesa overlap; wow sky recropped so the furnace glow clears the
  horizon; win hero repositioned off the busy rock cluster (HERO_SEP 4→6).
- R2→R3: per-sky 8-color ramps folded into the master palette (smoother
  band steps); interior fills flattened harder; mesa haze push 0.18→0.28.
- R3→R4: interior fill made near-flat (a 16px repeat cannot hide texture —
  the repetition complaint appeared in every prior round and died here);
  rock strip haze-pushed + darkened another step; wow embers raised into
  the visible sky band.
- Post-R4 micro-fix: walkable crust edge brightened (recurring READ note in
  all four rounds).

Verdict: scores plateaued at READ 5-6 / HARM 6 / EXEC 4-6 / HERO_SEP 6-7
with round-4 feedback oscillating against round-3 fixes (e.g. "add texture
variation" vs round 3's "reduce texture noise", "add gradient to the flat
sky" against the deliberate dread-flat boss sky) — the reviewer is now
churning on taste, not finding defects. HERO_SEP >= 6 in every mock (the
hard gate). Much premium; top shelf wow. Remaining sub-7 EXEC notes are
runtime-wiring items (tile variant probability, pit void fill, coin-band
tint), logged in INTEGRATION_NOTES.md open questions.

Tileability: skies uniform per row (tile by construction, seam 0.0); mesas
3.99 / rocks 0.0 on the strip-averaged seam metric; all three verified
visually at worst-case 320px offset wrap.

Locked palette: 43 master colors, 43 used across all assets (pixel-exact).
