// ASCII chunks → level. Legend: '#' solid · '.' empty · 'P' player spawn ·
// 'C' checkpoint · 'h' hopper · 'H' red hopper · 'u' saucer · '$' coin ·
// 'S' sign. Spawn/checkpoint y = feet = top of the tile they stand on.
export const TILE = 16;

const ENT = { h: 'hopper', H: 'redhopper', u: 'saucer', $: 'coin' };

export function parseChunk(rows) {
  const hTiles = rows.length, wTiles = rows[0].length;
  const solid = new Uint8Array(wTiles * hTiles);
  let spawn = null; const checkpoints = []; const entities = []; const signs = [];
  rows.forEach((row, ty) => {
    if (row.length !== wTiles) throw new Error(`row ${ty} width ${row.length} != ${wTiles}`);
    [...row].forEach((ch, tx) => {
      if (ch === '#') solid[ty * wTiles + tx] = 1;
      const feet = { x: tx * TILE + TILE / 2, y: (ty + 1) * TILE };
      if (ch === 'P') {
        if (spawn) throw new Error('chunk has multiple P');
        spawn = feet;
      }
      if (ch === 'C') checkpoints.push(feet);
      if (ENT[ch]) entities.push({ type: ENT[ch], x: feet.x, y: feet.y });
      if (ch === 'S') signs.push({ x: feet.x, y: feet.y, text: '' });
    });
  });
  if (!spawn) throw new Error('chunk has no P');
  return {
    wTiles, hTiles, spawn, checkpoints, entities, signs,
    w: wTiles * TILE, h: hTiles * TILE,
    solidAt(tx, ty) {
      if (tx < 0 || tx >= wTiles) return true;     // side walls
      if (ty < 0) return true;                     // ceiling above level
      if (ty >= hTiles) return false;              // open bottom = pits kill
      return solid[ty * wTiles + tx] === 1;
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
// the ONE deliberate exception is C5's slide corridor, a 2-row (32px) opening
// that only the 24px slide box fits through.
function ch(rows) {
  const w = rows[0].length;
  const sky = '.'.repeat(w);
  return [...Array(12).fill(sky), ...rows, ...Array(5).fill(rows.at(-1))];
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

const SIGN_TEXTS = [
  'press X. very pew.',
  'hold DOWN + X. shoot ground. trust me.',
  'DOWN+X in air = boost. 3 pips. kills refill.',
  'DOWN+move = slide. X while sliding = zoom.',
  'rude saucers drop bolts. duck or blast.',
];

export const GAUNTLET = stitchChunks([C1, C2, C3, C4, C5, C6, C7], SIGN_TEXTS);
