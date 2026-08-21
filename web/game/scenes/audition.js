// Sound check. A hidden list screen: every sound in the game, each with its
// rendered candidates side by side — A is the shipped winner, B/C are the
// rendered runners-up (engine/sfx.js CANDIDATES; lazy-fetched on first poke).
// Poke a candidate to hear it, keep the one you like; keeps persist in the
// save (sfxPicks) and the engine resolves pick-over-default on every play from
// then on. Not reachable from any visible menu — main.js owns the way in, the
// same way it owns the other sequence.
//
// The scene never touches the recipes themselves: it reads two exported tables
// and writes ONE save field. All the audio plumbing stays in sfx.js.
import { SOUNDS, CANDIDATES } from '../../engine/sfx.js';
import { SFX_PICKS_V } from '../../engine/save.js';
import { drawText, drawTextShadow } from '../../engine/font.js';

const VW = 640, VH = 360;

// Row/cell geometry, shared by the hit tests in update() and the draw in
// render() — same rule as the title's plates: the thing you see IS the thing
// you hit. Cells are 56x15 plates 80px apart; the 44 CSS px tap floor inflates
// them into each other and across rows, so taps resolve to the nearest cell
// CENTRE (the shell's claim() idiom) and every cell stays its own target.
// ROW_H tightened 19 → 17 when SFX v2 grew the list to 14 rows (takeoff,
// afktick): at 19 the last row ran into the footer legend. Tap targets keep
// their 44 CSS px floor — hits resolve to the NEAREST cell centre, so rows
// only need to be distinct, not 44px apart.
const ROW_Y0 = 60, ROW_H = 17;
const NAME_X = 76;
const CELL_X = 306, CELL_W = 56, CELL_STEP = 80, CELL_H = 15;
const LETTERS = ['A', 'B', 'C'];

// Back plate, top-left: Escape has no key on a phone. Same 22x20 plate family
// as the shell's corner buttons.
const BACK_BTN = { x: 3, y: 3, w: 22, h: 20 };

const cellRect = (i, j) =>
  ({ x: CELL_X + j * CELL_STEP, y: ROW_Y0 + i * ROW_H - 4, w: CELL_W, h: CELL_H });

export function makeAudition({ input, save, sfx, go, touchUI, tapNeed }) {
  const names = Object.keys(SOUNDS);
  // Variant ids per row: 'a' is always the default; b/c only where a candidate
  // exists (some sounds run two-wide — see the CANDIDATES note in sfx.js).
  const variants = names.map(n => ['a', ...Object.keys(CANDIDATES[n] ?? {})]);

  let row = 0, col = 0, t = 0;

  const onTouch = () => !!touchUI?.();
  const picks = () => save?.data?.sfxPicks ?? {};
  const pickOf = n => {
    const v = picks()[n];
    return typeof v === 'string' ? v : 'a';
  };

  // The same 44 CSS px floor + nearest-centre resolution as the shell buttons.
  const hitPlate = (v, r) => {
    const need = tapNeed?.() ?? 0;
    const px = Math.max(0, (need - r.w) / 2), py = Math.max(0, (need - r.h) / 2);
    return v.x >= r.x - px && v.x < r.x + r.w + px && v.y >= r.y - py && v.y < r.y + r.h + py;
  };
  const plateDist = (v, r) => Math.hypot(v.x - (r.x + r.w / 2), v.y - (r.y + r.h / 2));

  function audition() { sfx?.play(names[row], variants[row][col]); }

  function keep() {
    // Whole-object write, like the jukebox writes `audio` — see save.js.
    // Every keep stamps the CURRENT pick generation: picks banked against an
    // older sound set (the letters meant different sounds) are discarded at
    // load, so the stamp is what keeps these ones alive across reloads.
    save?.patch({ sfxPicks: { ...picks(), v: SFX_PICKS_V,
                              [names[row]]: variants[row][col] } });
    audition();
  }

  return {
    update(dt) {
      t += dt;
      if (input.pressed('pause')) { go('title'); return; }
      // up/down walk the list (wrapping — fourteen rows is a long way back up);
      // the cursor lands on the row's CURRENT pick so left/right always starts
      // from what you'd actually hear.
      if (input.pressed('up') || input.pressed('down')) {
        row = (row + (input.pressed('down') ? 1 : names.length - 1)) % names.length;
        col = Math.max(0, variants[row].indexOf(pickOf(names[row])));
      }
      // left/right audition on arrival: selecting a candidate IS hearing it.
      if (input.pressed('left') && col > 0) { col--; audition(); }
      if (input.pressed('right') && col < variants[row].length - 1) { col++; audition(); }
      // Keyboard keep only. A touch raises a fire EDGE on landing (the fire
      // zone covers the whole cell column) a frame before its tap is even
      // reported — without this guard every first poke also banked whatever
      // row the cursor happened to be on. touchActive() is presence: true on
      // exactly the frames a finger could have forged this edge.
      if (input.pressed('fire') && !input.touchActive?.()) keep();

      const taps = input.taps?.() ?? [];
      if (taps.length) {
        const v = taps[0];
        const hits = [];
        if (hitPlate(v, BACK_BTN)) hits.push([-1, -1, BACK_BTN]);
        for (let i = 0; i < names.length; i++)
          for (let j = 0; j < variants[i].length; j++) {
            const r = cellRect(i, j);
            if (hitPlate(v, r)) hits.push([i, j, r]);
          }
        hits.sort((a, b) => plateDist(v, a[2]) - plateDist(v, b[2]));
        if (hits.length) {
          const [i, j] = hits[0];
          if (i < 0) { go('title'); return; }
          // First tap on a cell moves the cursor there and plays it; a second
          // tap on the SAME cell keeps it — hear before you commit, and a
          // finger never needs a separate confirm button.
          if (i === row && j === col) keep();
          else { row = i; col = j; audition(); }
        }
      }
    },

    render(ctx) {
      ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, VW, VH);
      const g = ctx.createLinearGradient(0, 0, 0, VH);
      g.addColorStop(0, 'rgba(60,36,72,0.55)'); g.addColorStop(0.6, 'rgba(11,11,18,0)');
      g.addColorStop(1, 'rgba(11,11,18,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);

      drawTextShadow(ctx, 'SUCH SOUND CHECK', VW / 2, 12,
                     { align: 'center', scale: 3 }, '#eec548', '#2a1c33');
      ctx.fillStyle = '#8a7db0';
      drawText(ctx, 'much listen. very choose.', VW / 2, 40, { align: 'center' });

      for (let i = 0; i < names.length; i++) {
        const y = ROW_Y0 + i * ROW_H;
        const active = i === row;
        // Cursor: a filled nub, not a glyph — the font has no arrow and an
        // unauthored glyph renders as tofu by design (see font.js).
        if (active) {
          ctx.fillStyle = '#8fa';
          ctx.fillRect(NAME_X - 14, y + 1, 5, 5);
        }
        ctx.fillStyle = active ? '#e8e0d0' : '#8a7db0';
        drawText(ctx, names[i], NAME_X, y);

        const picked = pickOf(names[i]);
        for (let j = 0; j < variants[i].length; j++) {
          const r = cellRect(i, j);
          const isPick = variants[i][j] === picked;
          const isCursor = active && j === col;
          ctx.fillStyle = 'rgba(11,11,18,0.55)';
          ctx.fillRect(r.x, r.y, r.w, r.h);
          // Border: quiet rule normally, lit when the cursor sits on it.
          ctx.fillStyle = isCursor ? '#8fa' : '#3a3350';
          ctx.fillRect(r.x, r.y, r.w, 1);
          ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
          ctx.fillRect(r.x, r.y, 1, r.h);
          ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
          // The kept candidate is gold; the rest stay quiet. The letter is the
          // whole label — the recipes have no names a player would recognise.
          ctx.fillStyle = isPick ? '#eec548' : '#6f6a86';
          drawText(ctx, LETTERS[j], r.x + CELL_W / 2 - 2, y, {});
          if (isPick) {                       // pip: "this one is yours"
            ctx.fillStyle = '#eec548';
            ctx.fillRect(r.x + 4, r.y + CELL_H / 2 - 1, 3, 3);
          }
        }
      }

      // Back plate + footer legend. The plate draws for touch AND keyboard —
      // a mouse can click nothing here, and on keyboard it is just a glyph in
      // the corner reminding you the way out exists.
      ctx.fillStyle = 'rgba(11,11,18,0.55)';
      ctx.fillRect(BACK_BTN.x, BACK_BTN.y, BACK_BTN.w, BACK_BTN.h);
      ctx.fillStyle = '#e8e0d0';
      for (let i = 0; i < 5; i++) {           // left-pointing pixel chevron
        ctx.fillRect(BACK_BTN.x + 13 - i, BACK_BTN.y + 5 + i, 2, 1);
        ctx.fillRect(BACK_BTN.x + 13 - i, BACK_BTN.y + 14 - i, 2, 1);
      }

      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 4);
      ctx.fillStyle = '#8fa';
      drawText(ctx, onTouch() ? 'tap = hear it. same tap again = keep it.'
                              : 'arrows = choose. X = keep. Esc = back.',
               VW / 2, 316, { align: 'center' });
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#6f6a86';
      drawText(ctx, 'A is the house mix. your ears outrank it.', VW / 2, 334,
               { align: 'center' });
    },

    state: () => ({ row, col, sound: names[row], variant: variants[row][col],
                    picks: { ...picks() } }),
  };
}
