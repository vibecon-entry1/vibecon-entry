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

## Dev quickstart
- `npm run assets`  rebuild atlas from ../assets source pack
- `npm run serve`   → http://localhost:8123 (F1 = anim viewer, R = restart)
- `npm test`        unit + e2e (screenshots in tests/artifacts/)
- Live tuning: open devtools console, edit `__blast.P` (e.g. `__blast.P.HOP_VY = -320`)
- Chunk authoring: ≥3 empty rows above any standing surface (44px player + OOB ceiling)
Plan 1 delivers: graybox verb prototype (M1+M2). Feel gate: user plays before Plan 2.
