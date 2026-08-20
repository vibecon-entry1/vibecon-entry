// Title + intro cards. The first thing a player sees, and the only scene that
// isn't the game: dark sky, a procedural starfield, the logo, and a pulsing
// prompt. X walks the intro one line at a time, then hands off to play.
//
// No atlas dependency on purpose — the parallax star band is authored 640 wide
// and pinned to the play camera, and dragging the whole atlas in just to reuse
// it would couple the title to asset loading order for a field of dots. These
// stars are generated once from a fixed seed, so the sky is stable across
// reloads and screenshots are diffable.
import { getSticker, BRAND } from '../../engine/sticker.js';
// Screen text goes through the 5x7 bitmap font, not canvas fillText: see the
// header of engine/font.js for why. Everything below positions by the TOP of
// the text box, so the old fillText baselines were each shifted up by the
// glyph height at that scale.
import { drawText, drawTextShadow, measure } from '../../engine/font.js';

const VW = 640, VH = 360;

// RocketRide, parked in the bottom-right corner. Sized and placed so the whole
// bob range clears the centred legend block (which ends around x=470) and the
// spark trail still has ~20px of sky below it to fall through.
const RR = { x: 522, y: 228, size: 112, bob: 4 };

// Thruster sparks: four 2px embers that fall out from under the rocket and
// respawn at the top of their own little track. Phases are FIXED, not random,
// for the same reason the starfield is seeded — the title screen has to be
// diffable between screenshots.
const SPARKS = [
  { dx: 34, phase: 0.00, speed: 0.85, len: 34, c: '#eec548' },
  { dx: 46, phase: 0.37, speed: 1.05, len: 30, c: '#aee6ff' },
  { dx: 56, phase: 0.62, speed: 0.72, len: 38, c: '#eec548' },
  { dx: 42, phase: 0.85, speed: 1.25, len: 26, c: '#ffe100' },
];

// The stickers are fly-THROUGH animations: the doge rockets in from off-frame
// and out again, so for a good part of every loop the 512px source is almost
// entirely transparent. A hard-edged rounded rect behind that reads as an empty
// UI box waiting for content — verified on screen, it looked broken. A radial
// falloff gives the art the same contrast against the starfield while having no
// edge to look empty: when the frame is bare, there is simply a slightly darker
// patch of sky.
function softPlate(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(11,11,18,0.72)');
  g.addColorStop(0.62, 'rgba(11,11,18,0.55)');
  g.addColorStop(1, 'rgba(11,11,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

const INTRO = [
  'aliens very rude.',
  'ship is that way.',
  'much blast.',
];

const LEGEND = [
  // Spelled DOWN rather than an arrow glyph: the pixel font has no ↓ either,
  // and an unauthored glyph renders as a tofu box by design.
  'arrows/WASD move  ·  X fire  ·  DOWN+X hop  ·  DOWN+move slide',
  'Esc pause  ·  R restart  ·  M mute',
];

// `save` is read-only here: the title only ever DISPLAYS the banked best.
// main.js's win-scene factory is still the one and only writer.
export function makeTitle({ input, go, save, jukebox, toggleDisplay }) {
  // The title pool starts the moment this scene exists. Before the player's
  // first keypress the jukebox just records the intent and main.js's unlock
  // listener starts it — so the music comes up on the same press that walks the
  // first intro card, not a scene later.
  jukebox?.playPool('title');

  // Cached: bouncing off the title and back (R from the win screen) must not
  // open a second decoder for the same 512px cartoon.
  const rocket = getSticker(BRAND.rocketride);

  // The corner mascot. Vignette first (so the cartoon's dark linework doesn't
  // dissolve into the starfield), then the art, then the embers on top.
  function drawRocket(ctx, t) {
    const bob = Math.round(Math.sin(t * 1.1) * RR.bob);
    softPlate(ctx, RR.x + RR.size / 2, RR.y + RR.size / 2 + bob, RR.size * 0.66);
    rocket.draw(ctx, RR.x, RR.y + bob, RR.size);

    // Embers. Each rides a 0..1 sawtooth down its own `len`-pixel track and
    // fades out over the last third, so respawn is a fade-in, not a pop.
    for (const s of SPARKS) {
      const u = (t * s.speed + s.phase) % 1;
      const y = RR.y + bob + RR.size - 8 + u * s.len;
      ctx.globalAlpha = u < 0.15 ? u / 0.15 : (u > 0.7 ? (1 - u) / 0.3 : 1);
      ctx.fillStyle = s.c;
      ctx.fillRect(RR.x + s.dx, Math.round(y), 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  // phase: 'title' → 'intro0' → 'intro1' → 'intro2' → play
  let phase = 'title';
  // Mirrors main.js's display mode purely so the settings line has something to
  // print; main.js stays the owner of both fit() and the save write.
  let display = save?.data?.display ?? 'crisp';
  let t = 0;
  let intro = -1;

  // Deterministic star field: a tiny LCG, not Math.random, so every boot draws
  // the same sky (and so screenshots are diffable).
  const stars = [];
  let seed = 1337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 140; i++)
    stars.push({ x: rnd() * VW, y: rnd() * VH, r: rnd() < 0.15 ? 2 : 1,
                 tw: rnd() * Math.PI * 2, dim: 0.35 + rnd() * 0.65 });

  return {
    update(dt) {
      t += dt;
      if (input.pressed('mute')) jukebox?.toggleMute();
      // D is also WASD's 'right', which means nothing on the title screen —
      // see the KEYMAP note in engine/input.js. Handled ONLY here: no other
      // scene reads 'display', so walking right in play can never re-fit the
      // canvas mid-jump.
      if (input.pressed('display')) display = toggleDisplay?.() ?? display;
      if (!input.pressed('fire')) return;
      intro++;
      if (intro >= INTRO.length) { go('play'); return; }
      phase = `intro${intro}`;
    },

    render(ctx) {
      ctx.fillStyle = '#080610'; ctx.fillRect(0, 0, VW, VH);
      // ground haze: the same purple the play scene's far band sits on, so the
      // cut to gameplay doesn't flash a different planet.
      const g = ctx.createLinearGradient(0, VH - 120, 0, VH);
      g.addColorStop(0, 'rgba(42,28,51,0)'); g.addColorStop(1, 'rgba(42,28,51,1)');
      ctx.fillStyle = g; ctx.fillRect(0, VH - 120, VW, 120);

      for (const s of stars) {
        ctx.globalAlpha = s.dim * (0.55 + 0.45 * Math.sin(t * 1.7 + s.tw));
        ctx.fillStyle = '#cfe6ff';
        ctx.fillRect(Math.round(s.x), Math.round(s.y), s.r, s.r);
      }
      ctx.globalAlpha = 1;

      const C = { align: 'center' };
      if (phase === 'title') {
        drawTextShadow(ctx, 'SUCH BLAST', VW / 2, 104, { ...C, scale: 4 }, '#eec548', '#2a1c33');

        ctx.fillStyle = '#8a7db0';
        drawText(ctx, 'a very mars. much escape.', VW / 2, 146, C);

        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 4);
        ctx.fillStyle = '#8fa';
        drawText(ctx, 'MUST START — press X', VW / 2, 206, { ...C, scale: 2 });
        ctx.globalAlpha = 1;

        // Banked best, under the start prompt. Hidden entirely on a fresh save:
        // 'BEST WOW: 0' reads as a taunt, not a record.
        const best = save?.data?.best?.gauntlet ?? 0;
        if (best > 0) {
          ctx.fillStyle = '#eec548';
          drawText(ctx, `BEST WOW: ${best}`, VW / 2, 230, { ...C, scale: 2 });
        }

        // Settings line, above the control legend and set apart from it by
        // colour: the key name is lit like the other prompts, the current value
        // is not, so the eye lands on the thing you can press.
        const label = `DISPLAY: ${display.toUpperCase()} · press D`;
        const lx = VW / 2 - measure(label) / 2;
        ctx.fillStyle = '#6f6a86';
        drawText(ctx, label, lx, 300);
        ctx.fillStyle = '#8fa';
        drawText(ctx, display.toUpperCase(), lx + measure('DISPLAY: '), 300);

        ctx.fillStyle = '#6f6a86';
        LEGEND.forEach((l, i) => drawText(ctx, l, VW / 2, 316 + i * 11, C));

        drawRocket(ctx, t);
      } else {
        // intro card: one line, doge-paced, with a quiet advance hint.
        drawTextShadow(ctx, INTRO[intro], VW / 2, 160, { ...C, scale: 3 }, '#e8e0d0', '#2a1c33');
        ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 4);
        ctx.fillStyle = '#8fa';
        drawText(ctx, 'press X', VW / 2, 294, C);
        ctx.globalAlpha = 1;
      }
    },

    state: () => ({ phase }),   // display is reported by main.js, its owner
  };
}
