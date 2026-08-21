// WOW ZONE run-end. The endless mode's obituary: how far you got, what you
// banked, and the seed that dealt it.
//
// Same contract as win.js — everything here is already computed. play.js's
// wowBreakdown() folded the run up and main.js resolved `best` BEFORE this
// scene was built, so bouncing off this screen and back can never re-bank a
// score. No sticker and no fanfare: this is a death screen, and the ded jingle
// play.js fired on the corpse frame is still ringing when we arrive.
import { drawText, drawTextShadow } from '../../engine/font.js';
import { makeSharePrompt, shareTapBand } from '../shareui.js';

const VW = 640, VH = 360;

export function makeWowEnd({ breakdown, best, input, go, sfx, tapNeed }) {
  const { score, kills, coins, timeS, chunks, seed } = breakdown;
  // Ties count as records, same call win.js makes and for the same reason:
  // matching your own best still earns the line, and the alternative is a
  // second flag threaded through for one case.
  const record = score >= best && score > 0;
  let t = 0;

  // deaths is 1, always: the zone gives one life and the ONLY way onto this
  // screen is dying on it (play.js routes every other wow exit elsewhere), so
  // the share card reports the death that ended the run rather than a 0 that
  // would read as a clean sheet. wowBreakdown() has no deaths field for the
  // same reason — an endless level never increments player.deaths.
  const share = makeSharePrompt({ score, kills, deaths: 1, mode: 'wow' }, { sfx });

  // Same contract as win.js: the share line's y anchors both the draw and the
  // touch band, so the two can never drift apart.
  const SHARE_Y = 304;

  // Two-column ledger on the same LX/RX rails as win.js, so the two end screens
  // read as the same game rather than two different UIs.
  const LX = 170, RX = 470;
  const ROWS = [
    ['chunks cleared', `${chunks}/40`],
    ['kills ×100', `${kills * 100}`],
    ['coins ×10', `${coins * 10}`],
    ['time', `${timeS}s`],
  ];

  return {
    update(dt) {
      t += dt;
      share.update(dt, input);
      if (input.pressed('retry')) { sfx?.play('uiclick'); go('title'); }
      // Same touch split as win.js: share band around its line, everything
      // else is the primary action. Same 0.5s arming beat, same reason.
      const taps = input.taps?.() ?? [];
      if (t > 0.5 && taps.length) {
        const band = shareTapBand(SHARE_Y, tapNeed?.());
        if (taps[0].y >= band.top && taps[0].y <= band.bot) share.tap();
        else { sfx?.play('uiclick'); go('title'); }
      }
    },

    render(ctx) {
      ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, VW, VH);
      // Red-shifted wash instead of win.js's purple: same shape of screen,
      // unmistakably the other outcome at a glance.
      const g = ctx.createLinearGradient(0, 0, 0, VH);
      g.addColorStop(0, 'rgba(90,26,32,0.55)'); g.addColorStop(0.6, 'rgba(11,11,18,0)');
      g.addColorStop(1, 'rgba(11,11,18,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);

      drawTextShadow(ctx, 'WOW. U DED.', VW / 2, 36,
                     { align: 'center', scale: 3 }, '#e2413f', '#2a1c33');
      ctx.fillStyle = '#8a7db0';
      drawText(ctx, 'much endless. very brief.', VW / 2, 66, { align: 'center' });

      const T2 = { scale: 2 };
      let y = 112;
      for (const [label, val] of ROWS) {
        ctx.fillStyle = '#8a7db0'; drawText(ctx, label, LX, y, T2);
        ctx.fillStyle = '#e8e0d0'; drawText(ctx, val, RX, y, { ...T2, align: 'right' });
        y += 20;
      }

      ctx.strokeStyle = '#3a3350'; ctx.beginPath();
      ctx.moveTo(LX, y + 12); ctx.lineTo(RX, y + 12); ctx.stroke();

      ctx.fillStyle = '#eec548';
      drawText(ctx, 'WOW ZONE', LX, y + 26, { scale: 3 });
      drawText(ctx, `${score}`, RX, y + 26, { scale: 3, align: 'right' });

      ctx.fillStyle = '#8fa';
      drawText(ctx, 'BEST ZONE', LX, y + 56, T2);
      drawText(ctx, `${best}`, RX, y + 56, { ...T2, align: 'right' });

      if (record) {
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 5);
        ctx.fillStyle = '#eec548';
        drawText(ctx, 'very new record!', VW / 2, y + 80, { ...T2, align: 'center' });
        ctx.globalAlpha = 1;
      }

      // Seed line. Dim, small, and set apart — it is a fact about the run, not
      // a score. It is printed for a reason beyond debugging: the seed is the
      // ONLY thing that distinguishes one run from another, so it is what a
      // share string will carry (T4), and the number a player screenshots today
      // is the number they can hand someone tomorrow.
      ctx.fillStyle = '#6f6a86';
      drawText(ctx, `seed ${seed}`, VW / 2, 282, { align: 'center' });
      share.render(ctx, SHARE_Y);
      drawText(ctx, 'R = very again', VW / 2, 328, { ...T2, align: 'center' });
    },

    state: () => ({ finalScore: score, best, chunks, seed, ...share.state() }),
  };
}
