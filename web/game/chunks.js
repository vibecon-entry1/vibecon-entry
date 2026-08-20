// ASCII chunks → level. Legend: '#' solid · '.' empty · 'P' player spawn ·
// 'C' checkpoint · 'h' hopper · 'H' red hopper · 'u' saucer · '$' coin ·
// 'S' sign · 'G' gate tile (solid, recorded) · 'T' ship pad marker (not
// solid, recorded). Spawn/checkpoint y = feet = top of the tile they stand on.
export const TILE = 16;

const ENT = { h: 'hopper', H: 'redhopper', u: 'saucer', $: 'coin' };

export function parseChunk(rows) {
  const hTiles = rows.length, wTiles = rows[0].length;
  const solid = new Uint8Array(wTiles * hTiles);
  let spawn = null; const checkpoints = []; const entities = []; const signs = [];
  const gate = []; let shipPad = null;
  rows.forEach((row, ty) => {
    if (row.length !== wTiles) throw new Error(`row ${ty} width ${row.length} != ${wTiles}`);
    [...row].forEach((ch, tx) => {
      if (ch === '#' || ch === 'G') solid[ty * wTiles + tx] = 1;
      const feet = { x: tx * TILE + TILE / 2, y: (ty + 1) * TILE };
      if (ch === 'P') {
        if (spawn) throw new Error('chunk has multiple P');
        spawn = feet;
      }
      if (ch === 'C') checkpoints.push(feet);
      if (ENT[ch]) entities.push({ type: ENT[ch], x: feet.x, y: feet.y });
      if (ch === 'S') signs.push({ x: feet.x, y: feet.y, text: '' });
      if (ch === 'G') gate.push([tx, ty]);
      if (ch === 'T') {
        if (shipPad) throw new Error('chunk has multiple T');
        shipPad = feet;
      }
    });
  });
  if (!spawn) throw new Error('chunk has no P');
  return {
    wTiles, hTiles, spawn, checkpoints, entities, signs, gate, shipPad,
    w: wTiles * TILE, h: hTiles * TILE,
    solidAt(tx, ty) {
      if (tx < 0 || tx >= wTiles) return true;     // side walls
      if (ty < 0) return true;                     // ceiling above level
      if (ty >= hTiles) return false;              // open bottom = pits kill
      return solid[ty * wTiles + tx] === 1;
    },
    carve(tx, ty) {
      if (tx < 0 || tx >= wTiles || ty < 0 || ty >= hTiles) return;
      solid[ty * wTiles + tx] = 0;
    },
  };
}

// Stitch equal-height chunks side by side into one level. signTexts fill the
// 'S' markers left-to-right across the whole stitched level.
export function stitchChunks(chunks, signTexts = []) {
  const h = chunks[0].length;
  for (const c of chunks)
    if (c.length !== h) throw new Error(`chunk height ${c.length} != ${h}`);
  const rows = Array.from({ length: h }, (_, r) => chunks.map(c => c[r]).join(''));
  const L = parseChunk(rows);
  if (signTexts.length !== L.signs.length)
    throw new Error(`signTexts ${signTexts.length} != signs ${L.signs.length}`);
  L.signs.forEach((s, i) => { s.text = signTexts[i]; });
  return L;
}

// Graybox: runway → hop gap (3) → runway → boost gap (11) → checkpoint (open
// sky, BEFORE the corridor mouth — respawning inside it would embed the body)
// → slide corridor (2-tile clearance) → staircase chain: gaps 10/2/4/10 over
// three 2-wide stepping stones rising to the end pad.
// The floor slab is 12 rows deep: only the top row is played on, the rest is
// camera headroom so the follow target never clamps and the hero rides mid-screen.
export const GB1 = parseChunk([
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '....................................................................................................',
  '..............................................######################............................####',
  '....................................................................................##..............',
  '............................................C.................................##....................',
  '..P.......................................######################..........##........................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
  '#############...###############...........######################....................................',
]);

// ---- authored gauntlet ------------------------------------------------------
// Authoring contract: every chunk below is 17 rows x 48 chars. ch() pads 12 sky
// rows above and repeats the last row 5x below -> 34 rows (544px), matching the
// Plan-1 camera fix. Authored row 13 is the ON-FLOOR band (feet y = 416); rows
// 14-16 are the floor slab, and because row 16 is the one that repeats, any pit
// gap must be cut through rows 14/15/16 so it runs to the level bottom.
// Standing surfaces keep >= 3 empty rows overhead (44px body + solid ceiling);
// the deliberate exceptions are the slide corridors — 2-row (32px) openings
// that only the 24px slide box fits through. There are four now: C5, E5, E13
// and E17, and every one of them is listed in the geometry test's corridor
// exception ranges.
export const SKY_PAD = 12;
export const FLOOR_PAD = 5;
function ch(rows) {
  const w = rows[0].length;
  const sky = '.'.repeat(w);
  return [...Array(SKY_PAD).fill(sky), ...rows, ...Array(FLOOR_PAD).fill(rows.at(-1))];
}
const R = '.'.repeat(48);

// C1 — beam-in, walk, first pew. Threat-free, unbroken floor. Both starter
// signs live here: fire, then the ground-shot hop.
const C1 = ch([
  R, R, R, R, R, R, R, R, R, R, R, R, R,
  '...P....S...................S.........$.$.$.....',
  '################################################',
  '################################################',
  '################################################',
]);

// C2 — hop pits: 3-wide (48px), then 4-wide (64px). A flat-run hop covers
// ~97px, so both are comfortable; the coins ride the hop arc.
const C2 = ch([
  R, R, R, R, R, R, R, R, R, R, R,
  '...................$.................$$.........',
  '...............$.......$.........$........$.....',
  R,
  '##################...###############....########',
  '##################...###############....########',
  '##################...###############....########',
]);

// C3 — checkpoint, then two hoppers patrolling flat ground. The coin ledge
// sits 4 tiles up (64px) — above hop height (47px), so it only pays out to a boost.
const C3 = ch([
  R, R, R, R, R, R, R, R, R,
  '.......................$$$......................',
  '......................#####.....................',
  R, R,
  '..C......$........h.............h.......$.......',
  '################################################',
  '################################################',
  '################################################',
]);

// C4 — air-charge canyon. 12-wide (192px) pit with a saucer hovering mid-span:
// blast it on the way across and the kill refills charges. The 6-wide pit after
// is the graduation exercise.
const C4 = ch([
  R, R, R, R, R, R, R, R,
  '....................u...........................',
  R,
  '................$...$...$.......................',
  '....................................$$..........',
  R,
  '.........S....................$.................',
  '##############............########......########',
  '##############............########......########',
  '##############............########......########',
]);

// C5 — checkpoint, then the slide corridor: slab bottom at row 12, floor top at
// row 14 = a 32px opening, exactly the 24px slide box and nothing taller. Coins
// on the corridor floor bait the burst chain. First red hopper waits past the mouth.
const C5 = ch([
  R, R, R, R, R, R, R, R, R, R, R,
  '..................##############................',
  R,
  '..C.........S.......$..$..$..$..........H.......',
  '################################################',
  '################################################',
  '################################################',
]);

// C6 — saucer volleys over broken ground. Two 2-wide gaps keep you moving while
// bolts rain; duck under them or blast the saucers.
const C6 = ch([
  R, R, R, R, R, R, R,
  '................u...............u...............',
  R, R,
  '..........$.........$.........$.................',
  R,
  '......................$..............$..........',
  '......S.....................................$...',
  '######################..############..##########',
  '######################..############..##########',
  '######################..############..##########',
]);

// C7 — combo canyon. A red hopper patrols a ledge whose right edge is 2 tiles
// from a pit: contact knockback (~4.1 tiles) throws you in. That is the intended
// setpiece, not a bug. Saucer over the second pit, hoppers late, then a flat
// runway (Plan 3 appends the boss + ship there).
const C7 = ch([
  R, R, R, R, R, R, R,
  '..........................u.....................',
  R,
  '...................H............................',
  '.................######.........................',
  R,
  '..............$............$....................',
  '..C.....$........................$..h.....h.....',
  '############.....#######......##################',
  '############.....#######......##################',
  '############.....#######......##################',
]);

// ---- escalation tiers E1-E21 ------------------------------------------------
// Inserted BETWEEN C7 and C8: C1-C7 are byte-identical to the Plan-2 gauntlet
// (the early-game e2e tapes are calibrated against their absolute x), and
// C8/C9/C10 simply shift right. Same 17-row x 48-char contract as above.
//
// TIER 2 (E1-E10): every mechanic C1-C7 taught, one notch harder — wider hop
// pits, 8-10 wide boost canyons, hoppers on shelves, single saucers over pits,
// long slide corridors, 2-wide stepping stones.
// TIER 3 (E11-E21): combos — red hoppers guarding shelves flush with pits
// (marked INTENTIONAL SETPIECE where the knockback is the hazard),
// double-saucer volleys, corridor-into-canyon chains, six-stone staircases
// under fire, and E15's multi-refill canyon.
//
// Silhouette rule: no two adjacent chunks share a floor profile (pits / mesas /
// stones / corridors / flat rotate), and a threat-free half-chunk breather
// lands every ~4 chunks (E4, E8, E12, E16, E21).
//
// Authoring geometry that falls out of the 3-empty-rows-overhead invariant:
//   * a raised SHELF over intact floor must sit at authored row 10 or higher
//     (rows 11-13 would leave the floor beneath with < 3 clear rows);
//   * therefore every STEPPING STONE lives inside a pit, where there is no
//     floor underneath to starve — stones sit at authored rows 10-13;
//   * a MESA (solid from its top row down through row 16) has no such limit:
//     its lower rows are not surfaces, so mesas give 1-4 tile terraces;
//   * SLIDE CORRIDOR slabs are always authored row 11 -> a 32px opening, and
//     each one is listed in the geometry test's corridor exception ranges.

// E1 — the escalation gate. One sign, no threats: the tier-2 opener is
// pure traversal. Hop pits widen past anything C2 taught — 4-wide (64px) then
// 5-wide (80px) — but a flat-run hop still covers ~97px, so both stay honest.
// Coins ride the arcs.
const E1 = ch([
  R, R, R, R, R, R, R, R, R, R, R,
  '................$..............$.$..............',
  '.............$....$.............................',
  '.....S..........................................',
  '##############....############.....#############',
  '##############....############.....#############',
  '##############....############.....#############',
]);

// E2 — checkpoint 5, then the first tier-2 boost canyon: 8 wide (128px),
// past hop range, so the pips come out. A lone hopper paces the approach at
// col 14, twelve tiles clear of the near lip.
const E2 = ch([
  R, R, R, R, R, R, R, R, R, R,
  '............................$..$................',
  '.........................$........$.............',
  '................................................',
  '..C...........h.................................',
  '##########################........##############',
  '##########################........##############',
  '##########################........##############',
]);

// E3 — hoppers on a ledge. The 4-tile shelf (cols 18-25) carries its own
// patroller above solid ground, so a knock off the edge costs a heart at worst,
// never a pit. Ground hopper at col 6, a 4-wide hop pit to close.
const E3 = ch([
  R, R, R, R, R, R, R, R, R,
  '...................$.h.$........................',
  '..................########......................',
  '...................................$.$..........',
  '................................................',
  '......h.........................................',
  '##################################....##########',
  '##################################....##########',
  '##################################....##########',
]);

// E4 — single saucer over a pit, then a threat-free breather. 3-wide
// warm-up, then 6-wide (96px) with a saucer parked at the C4 height: boost up
// into bolt range or eat the bolts. Cols 22-47 are flat and empty on purpose —
// the first of the every-fourth-chunk breathers.
const E4 = ch([
  R, R, R, R, R, R, R, R,
  '...................u............................',
  '................................................',
  '................................................',
  '.........$.......$..$...........................',
  '................................................',
  '..............................$.................',
  '########...#####......##########################',
  '########...#####......##########################',
  '########...#####......##########################',
]);

// E5 — checkpoint 6 (open sky, before the mouth) then a long slide
// corridor: slab at authored row 11, floor top at row 14 = the same 32px opening
// C5 taught, but 14 tiles of it. Hopper past the exit at col 35, five clear of
// the closing 4-wide pit.
const E5 = ch([
  R, R, R, R, R, R, R, R, R, R, R,
  '....................##############.......$.$....',
  '................................................',
  '..C.....................$...$......h............',
  '########################################....####',
  '########################################....####',
  '########################################....####',
]);

// E6 — staircase over a 14-wide canyon. Three 2-wide stepping stones
// (rows 12/12/13) break 224px of nothing into four honest hops: 32px up onto the
// first, two level 48px strides, then a step down to the far lip.
const E6 = ch([
  R, R, R, R, R, R, R, R, R, R, R,
  '..................$....$........................',
  '..................##...##...$...................',
  '......h....................##...................',
  '################..............##################',
  '################..............##################',
  '################..............##################',
]);

// E7 — 9-wide boost canyon (144px) opening the chunk cold, a hopper on
// the long middle flat, and a 3-wide sting at the end. Silhouette is the inverse
// of E6: gaps at the shoulders, solid through the belly.
const E7 = ch([
  R, R, R, R, R, R, R, R, R, R,
  '..............$...$.............................',
  '...........................................$....',
  '................................................',
  '..............................h.................',
  '############.........#####################...###',
  '############.........#####################...###',
  '############.........#####################...###',
]);

// E8 — checkpoint 7 on a threat-free half-chunk (cols 0-23), then two
// staggered pits, 4 then 5 wide. Breather number two: nothing shoots here, the
// geometry is the whole test.
const E8 = ch([
  R, R, R, R, R, R, R, R, R, R, R,
  '...........................$.$.......$.$........',
  '................................................',
  '..C.......$.....................................',
  '##########################....######.....#######',
  '##########################....######.....#######',
  '##########################....######.....#######',
]);

// E9 — mesa staircase up, then a drop-gap down. Three solid terraces
// (1/2/3 tiles) walk you up to a 48px-high lip, and from there an 8-wide gap that
// plays SHORTER than it measures because you're falling 48px into the landing.
// Hopper on the far flat at col 40.
const E9 = ch([
  R, R, R, R, R, R, R, R, R, R,
  '....................$.......$..$................',
  '...............$..########......................',
  '..............############......................',
  '..........################..............h.......',
  '##########################........##############',
  '##########################........##############',
  '##########################........##############',
]);

// E10 — tier-2 finale: pure broken-ground rhythm. Four pits (3/4/3/4)
// with nothing but footwork between them. No enemies at all — the metre is the
// enemy, and it sets up the tier-3 combos that start next chunk.
const E10 = ch([
  R, R, R, R, R, R, R, R, R, R, R,
  '..........$........$.$.......$........$.$.......',
  '................................................',
  '................................................',
  '#########...######....######...######....#######',
  '#########...######....######...######....#######',
  '#########...######....######...######....#######',
]);

// E11 — tier 3 opens with the C7 setpiece, sharpened. Checkpoint 8,
// then a red hopper on a shelf whose right edge sits ONE tile from a 6-wide pit:
// contact knockback (~4.1 tiles) throws you straight in. INTENTIONAL SETPIECE —
// this is the whole point of the chunk, not a spacing bug. Ground hopper at 36.
const E11 = ch([
  R, R, R, R, R, R, R, R, R,
  '...............$..H.$...........................',
  '..............########..$.$.....................',
  '................................................',
  '................................................',
  '..C.................................h...........',
  '######################......####################',
  '######################......####################',
  '######################......####################',
]);

// E12 — breather three: cols 0-22 flat and threat-free, then a
// double-saucer volley over three pits. Two saucers cover overlapping ground, so
// ducking one bolt line walks you into the other.
const E12 = ch([
  R, R, R, R, R, R, R, R,
  '..........................u.......u.............',
  '................................................',
  '................................................',
  '.........................$.$.....$.$.....$......',
  '................................................',
  '............$...................................',
  '########################....####....####...#####',
  '########################....####....####...#####',
  '########################....####....####...#####',
]);

// E13 — slide corridor into an immediate boost canyon. 12 tiles of 32px
// ceiling (cols 6-17), three tiles of daylight, then 160px of nothing: the burst
// speed you carry out of the corridor IS the crossing. Slide-hop keeps it. Red
// hopper on the far flat, six clear of both lips, then a 4-wide closer.
const E13 = ch([
  R, R, R, R, R, R, R, R, R, R,
  '........................$...$...................',
  '......############........................$.....',
  '................................................',
  '..........$...$...$.................H...........',
  '#####################..........##########....###',
  '#####################..........##########....###',
  '#####################..........##########....###',
]);

// E14 — checkpoint 9, then the long staircase: a 28-wide void spanned by six
// 2-wide stones that climb three steps and descend three, with two saucers
// parked over the apex. Every stride is 32-48px; the difficulty is doing them
// under fire, on 32px of landing each time.
// The saucers sit at authored row 5, not row 7. Row 7 was authored first and
// the live-crossing probe caught it: a boosting player's HEAD lands exactly in
// the saucer's contact box mid-stride, and knockback off a 2-wide stone over a
// 28-wide void is an unavoidable heart every single time. Two rows up they
// still rain bolts on the staircase; they are no longer a wall.
const E14 = ch([
  R, R, R, R, R,
  '..................u...........u.................',
  R, R, R,
  '....................$...........................',
  '................$...##...$......................',
  '............$...##.......##..$..................',
  '............##...............##..$..............',
  '..C..............................##.............',
  '##########............................##########',
  '##########............................##########',
  '##########............................##########',
]);

// E15 — the multi-refill canyon. 22 tiles (352px) of open air with two saucers
// strung across it — the longest crossing in the game by 144px. BOTH paths are
// kinematically verified (see the margin table): pips-only clears it with all
// three charges spent and ~50px to spare (tight, and it is meant to be, and it
// costs you a saucer contact on the way through), while blasting a saucer
// mid-flight refills the tank (play.js: kills refill the tank) and turns the
// same crossing into ~200px of slack. That is C4's lesson scaled to a chunk.
const E15 = ch([
  R, R, R, R, R, R, R,
  '....................$...........................',
  '................u.......u.......................',
  '............$...............$...................',
  '................................................',
  '.................................$..............',
  '................................................',
  '........................................h.......',
  '##########......................################',
  '##########......................################',
  '##########......................################',
]);

// E16 — mesa climb with a red hopper on the summit, then breather four
// (cols 32-47, flat, one lazy hopper). Terraces at 1/2/3 tiles read as a
// different silhouette from E9's because the descent is a single step, not a
// gap.
const E16 = ch([
  R, R, R, R, R, R, R, R, R, R,
  '.....................$..H.$.....................',
  '.............$......########....................',
  '............################....................',
  '......##########################....$...h.......',
  '################################################',
  '################################################',
  '################################################',
]);

// E17 — checkpoint 10, then corridor-into-canyon again, harder: 14
// tiles of 32px ceiling, ONE tile of daylight at the mouth, then an 11-wide
// (176px) canyon. Slide out, slide-hop off the lip, spend a pip. A 7-wide gap
// follows before you get to breathe.
const E17 = ch([
  R, R, R, R, R, R, R, R, R,
  '..........................$...$.................',
  '................................................',
  '........##############...................$......',
  '................................................',
  '..C.........$...$...$...........................',
  '#######################...........####.......###',
  '#######################...........####.......###',
  '#######################...........####.......###',
]);

// E18 — double-saucer volley over broken ground, then the second red
// setpiece. Three pits under two saucers, then a shelf (cols 32-39) whose right
// edge is FLUSH with a 5-wide pit and a red hopper on top. INTENTIONAL SETPIECE:
// take the knock and you take the fall.
const E18 = ch([
  R, R, R, R, R, R, R,
  '............u........u..........................',
  '................................................',
  '...................................$H...........',
  '................................########........',
  '.........$.......$.$.......$..............$.....',
  '................................................',
  '................................................',
  '########....####.....#####....##########.....###',
  '########....####.....#####....##########.....###',
  '########....####.....#####....##########.....###',
]);

// E19 — high plateau, long drop. Two terraces lift you 64px onto a
// 12-tile mesa with a hopper walking it, and the only way off is a 13-wide
// (208px) gap that lands you a full 64px lower. Falling buys airtime; a pip buys
// the rest.
const E19 = ch([
  R, R, R, R, R, R, R, R, R,
  '..................$.h..$......$.................',
  '...........$..############.........$............',
  '..........################......................',
  '......####################......................',
  '......####################.................h....',
  '##########################.............#########',
  '##########################.............#########',
  '##########################.............#########',
]);

// E20 — checkpoint 11 and the full combo: a 12-wide canyon crossed on
// two stepping stones, a red hopper holding the middle flat (six clear of both
// lips), then a 7-wide gap and a hopper guarding the landing strip.
const E20 = ch([
  R, R, R, R, R, R, R, R, R, R,
  '....................................$...........',
  '.............$....$...................$.........',
  '.............##...##............................',
  '..C......................$.H.................h..',
  '##########............############.......#######',
  '##########............############.......#######',
  '##########............############.......#######',
]);

// E21 — last escalation, then the run-in to the arena. 10 tiles of clean floor
// (the canyon used to open at col 6, which put its launch lip inside the patrol
// of E20's closing hopper — the run-in to the last jump in the game should not
// be shared with a walker), then an 11-wide canyon, a saucer parked over SOLID
// ground at col 22, and the third red setpiece: a shelf two tiles clear of a
// 5-wide pit. INTENTIONAL — same knockback trap as C7 and E11/E18. Cols 39-47
// are flat and empty, and C8's arena floor continues that breather.
// The saucer is deliberately NOT over the canyon. Authored there it sat inside
// the contact box of the 2-pip crossing line and could not be blasted out of
// the arc either, so the last chunk before the boss charged an unavoidable
// heart. Over solid ground it is an ordinary C6-style overhead threat.
const E21 = ch([
  R, R, R, R, R, R, R,
  '......................u.........................',
  '................$...............................',
  '............$.......$......$H.$.................',
  '........................########................',
  '...................................$............',
  '................................................',
  '..........................................$.....',
  '##########...........#############.....#########',
  '##########...........#############.....#########',
  '##########...........#############.....#########',
]);

const SIGN_TEXTS = [
  'press X. very pew.',
  'hold DOWN + X. shoot ground. trust me bro.',
  'DOWN+X in air = boost. 3 pips. kills refill.',
  'DOWN+move = slide. X while sliding = zoom.',
  'rude saucers drop bolts. keep moving or blast.',
  'much danger ahead. very brave.',
];

// C8 — boss arena. Flat 48-wide floor, open sky (the MEGA SAUCER hovers and
// dives above it). A 2-col gate wall of 'G' at the right edge (cols 46-47),
// solid across EVERY authored row above the floor (authored rows 0-13, 14 rows
// = 224px): a 3-row wall was hoppable — a hop (46.7px) plus a 3-boost chain
// (3 x 56.9px) lifts the feet ~217px off the floor, which cleared it and let a
// player skip the climax into the sealed-pad dead end. At full authored height
// the wall top sits 224px up, above the ~217px ceiling, so nothing gets over
// it until the boss dies and Plan-3's scene code carves it open. ch()'s 12
// padded sky rows above the authored block stay open on purpose: they are
// camera headroom, unreachable by any boost chain.
// No enemies/coins/signs — the fight itself is the content.
const C8 = ch([
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '..............................................GG',
  '################################################',
  '################################################',
  '################################################',
]);

// C9 — victory stretch. Flat floor, checkpoint right at the mouth (post-boss
// respawns land here, not back at C7), 15 coins in a floor-hugging line for
// the cooldown lap to the ship. No enemies, no signs.
const C9 = ch([
  R, R, R, R, R, R, R, R, R, R, R,
  '...$..$..$..$..$..$..$..$..$..$..$..$..$..$..$..',
  R,
  '..C.............................................',
  '################################################',
  '################################################',
  '################################################',
]);

// C10 — ship pad. Flat floor, 'T' marks the pad center (~col 24). No enemies.
const C10 = ch([
  R, R, R, R, R, R, R, R, R, R, R, R, R,
  '........................T.......................',
  '################################################',
  '################################################',
  '################################################',
]);

// Fresh level per scene: carve() mutates tiles, so each run must parse its own copy.
export function buildGauntlet() {
  const L = stitchChunks([
    C1, C2, C3, C4, C5, C6, C7,
    E1, E2, E3, E4, E5, E6, E7, E8, E9, E10,
    E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21,
    C8, C9, C10,
  ], SIGN_TEXTS);
  // C8 is chunk index 28 now (7 originals + 21 escalation chunks).
  L.bossTrigger = (28 * 48 + 8) * TILE;
  return L;
}
