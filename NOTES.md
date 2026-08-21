# VibeCon 2026 — Dogelon Mars Game Jam

Source: https://dogelonmars.com/blog/announcing-vibecon-2026-build-a-game-on-mars/
Site: ashbandicoot.com/vibecon · Register: forms.gle/Wb9Qb5WwhjwCmokh7

## Deadline
Submissions close **September 25, 2026**.

## Requirements
- Small, playable, **Dogelon-themed browser game**, AI-assisted development.
- One main character + one core mechanic.
- One short level / gameplay loop.
- Clear win condition, score, or survival goal.
- Playable in **1–5 minutes**.
- **Must use the official Dogelon character sprite** (assets in `assets/`).
- Runs entirely in a modern browser — no downloads, no installs.
- No NSFW, hate speech, malware, scams, or gambling mechanics.

## Submission payload
Working link, title, description, creator name, screenshot, tools used, sprite confirmation.

## Prizes
Winners get prizes; approved games featured in the official Dogelon community games
showcase (permanent arcade). Selected creators get social spotlights / interviews.

---

# Asset manifest

Layout: `assets/Sprite_Sheets/` (hero), `assets/Added sprites/` (enemies + ship),
`reference/` (mov/mp4 animation refs + `Dogelon Final Rig.glb` 3D rig).

All sheets are **row-major** grids. Hero/enemy cell size is **1728×1728 px** — huge
source art, downscale at load or pre-slice.

| Sheet | Grid | Cell | Frames |
|---|---|---|---|
| Dogelon_Stand | 1×1 | 1728 | 1 |
| Dogelon_Walk | 2×3 | 1728 | 6 |
| Dogelon_Run | 2×3 | 1728 | 6 |
| Dogelon_walk_Nogun | 2×3 | 1728 | 6 |
| Dogelon_backwalk | 2×2 | 1728 | 4 |
| Dogelon_frontwalk | 2×2 | 1728 | 4 |
| Dogelon_duck | 3×3 | 1728 | 8 |
| Dogelon_Slide | 3×3 | 1728 | 8 |
| Dogelon_Hit | 3×3 | 1728 | 8 |
| Dogelon_Blast | 4×4 | 1728 | 13 |
| Dogelon_Dead | 4×5 | 1728 | 18 |
| Dogelon_respawn | 4×6 | 1728 | 13 |
| Dogelon_enemywalk | 3×4 | 1728 | 10 (8 walker + 2 red variant) |
| Dogelon_enemyfly | 3×3 | 1728 | 8 |
| Dogelon_explode | 2×3 | 6912×5400 | 6 |
| Dogelon_spawn | 9×5 | 1024×2048 | 41 |
| Dogelon_Ship | 4×5 | 4000×3200 | 18 |

`assets/Added sprites/Dogelon_Ship/sprite_00..17.png` are the ship frames pre-sliced
(6912×5400 each, different scale from the sheet).

Hero look: shiba in a navy jacket + light blue tie, carrying a red/orange blaster.
Enemies: white one-eyed hopper and a red flying variant. Palette reads as
black bg / cream + tan fur / navy / red-orange accents.

## Derived art
`tools/posegen.py` builds `assets-gen/pose_gundown.png` — a "blaster aimed down"
hero pose the pack never shipped. The Stand frame's "gun" is actually an energy
blast (red flare shell, yellow core, white-hot tip) leaving the fist, so the
generator floods that colour cluster out at native 64×64, patches the coat, and
re-pastes it rotated 90° clockwise at the hip. `npm run assets` runs it, and the
result lands in the atlas as the 1-frame `gundown` anim. `--ascii` dumps
before/after pixel maps for eyeballing the surgery.

Air pose: `air` holds duck frame 6 (the most tucked of the eight) instead of
looping `run`. A/B'd in-game — the run loop mid-air is the same silhouette as
running on the ground, so you can't tell you left it; the tuck can't be mistaken.

## Music (Wave 2b)
Streaming only. `web/engine/audio.js` is a pooled jukebox over plain
`HTMLAudioElement`s: `web/assets/audio/manifest.json` (650 bytes) is the ONLY
thing a boot fetches, and a track's element isn't constructed — let alone
loaded — until that track is selected (`preload='none'`, src assigned at
selection). 33MB of mp3 on disk (14 tracks), one streamed file at a time, served over
Range/206 by `tools/serve.mjs`.

Pools: title[4], run[4], wow[2] (the endless mode's own set), fanfare[2] (one-shot). Per pool the session's FIRST track is random and never
the one the last session opened with — `save.data.audio.lastFirst[pool]`, banked
before a note plays — then it cycles in order on 'ended', wrapping.

Autoplay: `playPool()` before the first user gesture records intent only;
main.js's one-shot keydown/pointerdown listener calls `unlock()`, which starts
whatever the title scene already asked for. Every rejected `play()` is swallowed
and the whole module warns at most once, ever — the e2e suite asserts an empty
console and "blocked" is the normal path on a cold load.

Scene wiring: title → `playPool('title')`, play → `playPool('run')`, pause →
`setDuck()` (0.35 vs 1.0), takeoff → `stopMusic()` (the extraction rides quiet),
win → `playOneShot('fanfare')`. M toggles a HARD element mute, persisted.

`?test` builds a SILENT jukebox: the tape-driven specs fire hundreds of trusted
key gestures and would otherwise stream a run track per spec. `?test&music` opts
back in (that's how the takeoff→fanfare handoff is smoke-tested), and
`tests/e2e/audio.spec.js` covers the real path through the plain '/' front door,
asserting zero mp3 requests before a gesture.

## Dev quickstart
- `npm run assets`  rebuild atlas from ../assets source pack
- `npm run serve`   → http://localhost:8123 (F1 = anim viewer, R = restart)
- `npm test`        unit + e2e (screenshots in tests/artifacts/)
- Live tuning: open devtools console, edit `__blast.P` (e.g. `__blast.P.HOP_VY = -320`)
- Chunk authoring: ≥3 empty rows above any standing surface (44px player + OOB ceiling)
- Audio: M = mute (persisted); music streams — a boot fetches only manifest.json
- Gameplay: 3 hearts; kills refill boost pips; signs teach the verbs; R = full restart
- Burst chord: DOWN + direction + X on a settled slide (0.12s in, or instantly while
  pinned under a ceiling) = backward bolt + forward burst, and you STAY seated — hold
  the chord and mash X to chain up to BURST_MAX. Tapping X in the first 0.12s of a
  slide still hops instead (the running pit-saver).
## World art (the overhaul)
Every environment pixel is generated: late-afternoon Mars in a locked 43-color
palette harmonized with the official sprites. Pipeline: image-generation raws +
prompts committed under `assets-wow/raw/`, craft pass in `tools/genart_v2_prod.py`
(deterministic, seeded), ingested by `tools/build_assets.py`'s PROD table.
Terrain is a 133-frame organic-masonry tileset picked per tile by
`web/game/tiles.js` — pure f(coords), which is what keeps the scrolled tile
cache valid. Share cards regenerate from the same art via `tools/gencards.py`.

## Sound effects
14 sounds ship as small rendered files (`web/assets/sfx/`, ~240KB total,
fetched+decoded on the first user gesture, never under `?test`); the old
param-synth recipes in `web/engine/sfx.js` remain as the decode-failure
fallback. Renderer + rankings live in `assets-wow/sfx2/`.

## Share links
S on an end screen copies a LINK (text only). The link hits a 120-line stateless
Cloudflare worker (`share-worker/`) that rewrites OpenGraph tags to that run's
score and instantly redirects humans to the game — that's how a static Pages
site gets per-score unfurls. Card image URLs carry `?v=N`; bump it whenever the
card art changes or scrapers keep serving their cached copies.

## Deploying
gh-pages = `web/` at the repo root (orphan commit, force-push). Asset requests
carry the build stamp from `web/index.html`'s `?v=` on the module entry
(`web/engine/version.js`) — bump that one line on every deploy or returning
browsers will mix old code with new assets.

STATUS: v1.0.0 tagged — full game shipped (gauntlet, MEGA SAUCER, ship finale,
WOW ZONE endless, share chain, touch controls, world+sound overhaul). Remaining
work is submission clicks and playtest polish.
