# SFX candidate report

All 12 sounds in `web/engine/sfx.js` got 2 alternative recipes each, using the
exact same param vocabulary the engine already speaks (wave / f0 / f1 / notes /
duration / attack / decay / volume / noise) — integration is a table swap, no
engine change. Recipes: `sfx/recipes.json` (includes the shipped "current"
recipe per sound for A/B). Renders: `sfx/wav/<sound>__<variant>.wav`, produced
by `sfx/render_sfx.mjs`, which reproduces the engine's synthesis (envelope
scaling, exponential sweep, stepped notes, looped noise layer, master 0.5)
offline and deterministically (seeded PRNG noise).

An audio review ranked all 36 renders against each sound's target character.

## Rankings (score /10)

| sound | winner | scores (current / alt1 / alt2) | review note on winner |
|---|---|---|---|
| pew | **alt2** | 6 / 4 / 9 | ultra-short sawtooth; no high-end fatigue at rapid fire |
| hop | **current** | 8 / 6 / 3 | shipped chirp already right; alts read as UI blip / sluggish |
| boost | **alt1** | 5 / 9 / 7 | wider sweep + bigger noise swell = airy thrust with body |
| burst | **alt1** | 2 / 8 / 4 | heavier low-end noise sells the meaty recoil shove |
| coin | **alt1** | 4 / 9 / 6 | full-octave two-step (C6→C7) pierces a dense mix |
| hurt | **alt2** | 5 / 2 / 9 | stepped falling square + noise, unmistakable from shots |
| ded | **alt1** | 6 / 9 / 4 | four-note descending arpeggio, properly sad, not an error chirp |
| killpop | **alt2** | 7 / 4 / 9 | tight transient, ideal noise/tone balance for hundreds of kills |
| bosshit | **alt1** | 6 / 9 / 3 | dull heavy thud, no transient click to clash with player fire |
| bossdown | **alt1** | 6 / 7 / 2 | longer swell reads as the big payoff |
| minionpop | **current** | 9 / 6 / 4 | shipped micro-pop already ideal |
| uiclick | **alt1** | 4 / 9 / 6 | short down-step, atonal and non-grating |

10 of 12 sounds have a winning alternative; hop and minionpop stay as shipped.

## Review caveats

- bossdown alt1 scored 7 with the note that a true noise-swell explosion tail
  is beyond what one osc + one noise layer can do; if the integration wave ever
  extends sfx.js, a second delayed noise voice is the single highest-value
  addition. Not required for the swap.
- pew alt1 (noisy transient) and hurt alt1 (too squeaky) are kept in
  recipes.json for reference but should not ship.

## Integration

Replace the corresponding entries in `SOUNDS` in web/engine/sfx.js with the
winner objects from recipes.json (param names already match; `notes` mirrors
f0/f1 the same way the shipped table does). No other change. Re-render for a
listen any time: `node assets-wow/sfx/render_sfx.mjs assets-wow/sfx/recipes.json /tmp/out`.
