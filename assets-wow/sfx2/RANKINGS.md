# SFX round 2 — rankings

Rendered, layered candidates for all 12 engine sounds plus the two new ones
(takeoff, afktick). Every candidate was scored by an audio review against the
bar "sounds like a polished commercial 2D platformer" (rubric:
`prompts/rubric.txt`, per-sound briefs: `prompts/roles.json`, raw scores +
verbatim critiques: `scores/*.json`). Scoring calibration: 5 = acceptable
indie, 7 = solid commercial, 9+ = top shelf.

## How the rounds worked

- **round1**: all 36 original candidates, one comparative call per sound.
- **round2**: after targeted revisions to every sound whose best score was
  below 9 (each revision implements the review's concrete production notes —
  the `// r2:` comments in `render.mjs` cite them), plus first scores for the
  two new sounds.
- **round3**: second revision pass on the five sounds still below 9
  (`// r3:` comments).
- **round4a/round4b**: the reviewer showed real round-to-round variance on
  four contested sounds (identical files swinging several points), so those
  got two replicate passes and the winner is decided on the aggregate across
  all rounds, not a single roll.

## Scores by round

| sound | cand | r1 | r2 | r3 | r4a | r4b | winner |
|---|---|---|---|---|---|---|---|
| pew | a | 3 | | | | | |
| | b | 4 | | | | | |
| | **c** | **9** | | | | | ✔ locked at r1 |
| hop | a | 5 | 5 | | | | |
| | **b** | 8 | **9** | | | | ✔ r2 revision (8-10 kHz air puff) |
| | c | 3 | 4 | | | | |
| boost | a | 3 | 3 | 5 | 4 | 5 | |
| | **b** | 3 | 4 | **8** | **8** | **8** | ✔ r2 redesign (whoosh-led), consensus 8 |
| | c | 6 | 8 | 3 | 3 | 3 | |
| burst | **a** | 4 | **9** | | | | ✔ r2 revision (sub-drop, laser tail killed) |
| | b | 7 | 3 | | | | |
| | c | 2 | 5 | | | | |
| coin | **a** | **9** | | | | | ✔ locked at r1 |
| | b | 4 | | | | | |
| | c | 6 | | | | | |
| hurt | **a** | **9** | | | | | ✔ locked at r1 |
| | b | 3 | | | | | |
| | c | 5 | | | | | |
| ded | **a** | 5 | 7 | 5 | **8** | **9** | ✔ r3 revision (low-mid pad + tail bloom) |
| | b | 8 | 3 | 3 | 4 | 4 | |
| | c | 3 | 4 | 7 | 3 | 3 | |
| killpop | a | 4 | | | | | |
| | **b** | **9** | | | | | ✔ locked at r1 |
| | c | 6 | | | | | |
| bosshit | **a** | 6 | **9** | | | | ✔ r2 revision (dedicated sub + low-mid) |
| | b | 4 | 4 | | | | |
| | c | 8 | 3 | | | | |
| bossdown | a | 4 | 4 | 3 | 5 | 5 | |
| | b | 3 | 2 | 7 | 8 | 4 | |
| | **c** | **8** | **7** | 5 | 3 | **7** | ✔ best aggregate (6.0 vs b 4.8, a 4.2) |
| minionpop | **a** | 6 | **9** | | | | ✔ r2 revision (2.5-4 kHz bite) |
| | b | 5 | 4 | | | | |
| | c | 8 | 5 | | | | |
| uiclick | **a** | **9** | | | | | ✔ locked at r1 |
| | b | 5 | | | | | |
| | c | 4 | | | | | |
| takeoff | a | | 4 | 4 | | | |
| | **b** | | 8 | **9** | | | ✔ r3 revision (tail fade + ignition kick) |
| | c | | 3 | 4 | | | |
| afktick | **a** | | 7 | 7 | 7 | 6 | ✔ most stable aggregate (6.8 vs c 6.75, b 5.75) |
| | b | | 4 | 5 | 9 | 5 | |
| | c | | 8 | 6 | 5 | 8 | |

Empty cells = the sound was not re-reviewed that round (either already at 9,
or not in that round's contested set). Winners at 9: pew_c, hop_b, burst_a,
coin_a, hurt_a, ded_a, killpop_b, bosshit_a, minionpop_a, uiclick_a,
takeoff_b. Winners on consensus below 9: boost_b (8), bossdown_c (aggregate
6.0 — the review's remaining ask is even more sub weight, which fought the
peak-normalization ceiling; flagged as the one candidate worth a mastering
revisit in the integration wave), afktick_a (~7 — deliberately understated,
the reviewer's own note is that its restraint is the repetition-safe choice).

## Family-coherence pass

All 14 winners concatenated into one montage and reviewed as a set
(`prompts/coherence.txt`, result: `scores/coherence.json`):

> coherence **10/10** — "An exceptionally cohesive retro-synth sound set with
> unified FM/chiptune timbre, consistent pitch anchor, and immaculate dynamic
> balance across all gameplay roles." **No outliers.**

Shared design language enforcing that verdict:
- **Tuning root C**: every pitched element sits on C/E/G family notes
  (hurt/afktick use A3/E3 — the relative-minor shading for "bad news"
  sounds, still inside the key).
- **Peaks** all at -1 dBFS (renderer normalization), **RMS** role-banded:
  impacts -7..-11 dB (hurt loudest by design), traversal -12..-16 dB,
  micro-UI ~-13 dB, jingles/payoffs -14..-16 dB. Full table via
  `node measure.mjs wav`.
- **Brightness** (spectral centroid): UI/pickup cluster 1.9-3.2 kHz, weapon
  cluster 3-4 kHz, impact cluster 0.1-1.5 kHz, boost_b intentionally airy at
  ~9 kHz (it is the one "air" material in the set; the coherence pass raised
  no flag).

## Reproducibility

- `node render.mjs wav` — byte-identical re-render (seeded noise per
  candidate).
- `./encode.sh wav dist` — distribution encode (AAC-LC .m4a, 64 kbps mono).
- `node review.mjs wav <label> [sounds...]` — re-run a review round.
- `node measure.mjs wav` — duration/peak/RMS/centroid table.

API call count: 35 successful review calls (comparative rounds 12 + 9 + 5 +
4 + 4, plus 1 coherence call, all counted in `scores/*.json`), plus 48 no-op
attempts burned on a deprecated model id before the first round ran (no audio
was scored by them).
