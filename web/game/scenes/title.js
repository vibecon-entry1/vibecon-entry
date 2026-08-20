// Title + intro cards. The first thing a player sees, and the only scene that
// isn't the game: dark sky, a procedural starfield, the logo, and a pulsing
// prompt. X walks the intro one line at a time, then hands off to play.
//
// No atlas dependency on purpose — the parallax star band is authored 640 wide
// and pinned to the play camera, and dragging the whole atlas in just to reuse
// it would couple the title to asset loading order for a field of dots. These
// stars are generated once from a fixed seed, so the sky is stable across
// reloads and screenshots are diffable.
const VW = 640, VH = 360;

const INTRO = [
  'aliens very rude.',
  'ship is that way.',
  'much blast.',
];

const LEGEND = [
  // Spelled DOWN rather than an arrow glyph: canvas monospace has no ↓ and the
  // fallback face renders it as a stray comma-height mark.
  'arrows/WASD move  ·  X fire  ·  DOWN+X hop  ·  DOWN+move slide',
  'Esc pause  ·  R restart',
];

// `save` is read-only here: the title only ever DISPLAYS the banked best.
// main.js's win-scene factory is still the one and only writer.
export function makeTitle({ input, go, save }) {
  // phase: 'title' → 'intro0' → 'intro1' → 'intro2' → play
  let phase = 'title';
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

      ctx.textAlign = 'center';
      if (phase === 'title') {
        ctx.fillStyle = '#2a1c33';                       // drop shadow slab
        ctx.font = 'bold 28px monospace';
        ctx.fillText('SUCH BLAST', VW / 2 + 2, 132 + 2);
        ctx.fillStyle = '#eec548';
        ctx.fillText('SUCH BLAST', VW / 2, 132);

        ctx.font = '9px monospace'; ctx.fillStyle = '#8a7db0';
        ctx.fillText('a very mars. much escape.', VW / 2, 152);

        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 4);
        ctx.font = '12px monospace'; ctx.fillStyle = '#8fa';
        ctx.fillText('MUST START — press X', VW / 2, 214);
        ctx.globalAlpha = 1;

        // Banked best, under the start prompt. Hidden entirely on a fresh save:
        // 'BEST WOW: 0' reads as a taunt, not a record.
        const best = save?.data?.best?.gauntlet ?? 0;
        if (best > 0) {
          ctx.font = '10px monospace'; ctx.fillStyle = '#eec548';
          ctx.fillText(`BEST WOW: ${best}`, VW / 2, 236);
        }

        ctx.font = '8px monospace'; ctx.fillStyle = '#6f6a86';
        LEGEND.forEach((l, i) => ctx.fillText(l, VW / 2, 320 + i * 13));
      } else {
        // intro card: one line, doge-paced, with a quiet advance hint.
        ctx.font = 'bold 20px monospace';
        ctx.fillStyle = '#2a1c33'; ctx.fillText(INTRO[intro], VW / 2 + 2, 180 + 2);
        ctx.fillStyle = '#e8e0d0'; ctx.fillText(INTRO[intro], VW / 2, 180);
        ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 4);
        ctx.font = '9px monospace'; ctx.fillStyle = '#8fa';
        ctx.fillText('press X', VW / 2, 300);
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';
    },

    state: () => ({ phase }),
  };
}
