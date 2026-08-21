// Results screen. Everything here is already-computed: breakdown comes from
// play.js's breakdown() (which folded timeBonus into score exactly once) and
// best is resolved by main.js BEFORE this scene is built, so the win scene
// never touches save — it only reads two numbers and lays them out.
import { getSticker, BRAND } from '../../engine/sticker.js';
// Ledger + headings go through the 5x7 bitmap font (engine/font.js); y values
// below are the TOP of each text box, where they used to be baselines.
import { drawText, drawTextShadow } from '../../engine/font.js';
// Share is the same flow on both end screens — see shareui.js for the KeyS /
// 'down' key note and for why the game never touches the network.
import { makeSharePrompt, shareTapBand } from '../shareui.js';

const VW = 640, VH = 360;

// The sticker sits in the empty right-hand third, clear of the ledger (which
// lives between x=170 and x=470) and clear of the centred headline above it.
const ST = { x: 486, y: 116, size: 120 };
const ST_CX = ST.x + ST.size / 2, ST_CY = ST.y + ST.size / 2;

const PICKS = ['wagmi', 'popper', 'rocketride'];

// Same softPlate as title.js — duplicated rather than promoted to a shared
// module for the reason spelled out there: it is six lines, and the two scenes
// have no other geometry in common.
function softPlate(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(11,11,18,0.72)');
  g.addColorStop(0.62, 'rgba(11,11,18,0.55)');
  g.addColorStop(1, 'rgba(11,11,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

// Backdrop strip: one untrimmed full-width atlas cell (sky/mesas/rocks),
// pinned by its top edge. Same direct source math as play.js's band() — the
// production strips are authored 640 wide, so at rest there is no seam to
// stitch. Duplicated in wowend.js under the softPlate rule above: four lines,
// and the two scenes share no other geometry.
function strip(ctx, atlas, name, dy) {
  const a = atlas.anims[name], f = atlas.frames[a.frames[0]];
  ctx.drawImage(atlas.img, f.x, f.y, f.w, f.h, f.ox, dy + f.oy, f.w, f.h);
}

// Sparkle emitter: eight motes on lazy elliptical orbits around the sticker.
// Phases/radii/rates are a fixed table rather than Math.random — the reward
// screen should look the same in every screenshot, and "random" here would buy
// nothing but undiffable artifacts. (The PICK is random; the FX are not.)
const SPARKS = [
  { r: 68, ry: 58, ph: 0.00, rate: 0.55, size: 3, c: '#eec548' },
  { r: 74, ry: 50, ph: 0.80, rate: -0.42, size: 2, c: '#ffffff' },
  { r: 62, ry: 66, ph: 1.70, rate: 0.68, size: 2, c: '#eec548' },
  { r: 78, ry: 44, ph: 2.55, rate: -0.60, size: 3, c: '#ffffff' },
  { r: 66, ry: 62, ph: 3.40, rate: 0.48, size: 2, c: '#ffe100' },
  { r: 72, ry: 54, ph: 4.20, rate: -0.72, size: 2, c: '#eec548' },
  { r: 60, ry: 70, ph: 5.05, rate: 0.63, size: 3, c: '#ffffff' },
  { r: 76, ry: 48, ph: 5.85, rate: -0.50, size: 2, c: '#aee6ff' },
];

const CONFETTI_T = 1.2;                       // burst lifetime, seconds
const CONFETTI_COLORS = ['#eec548', '#ffffff', '#aee6ff', '#8fa', '#e2413f', '#ffa900'];

/** 20 pieces of confetti, laid out from a fixed seed. Popper only. */
function makeConfetti() {
  let seed = 90210;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: 20 }, () => ({
    x: ST.x + rnd() * ST.size,
    y: ST.y + 6 + rnd() * 30,
    vx: (rnd() - 0.5) * 70,
    vy: -40 - rnd() * 90,                     // pops UP first, then gravity wins
    c: CONFETTI_COLORS[Math.floor(rnd() * CONFETTI_COLORS.length)],
  }));
}
const CONFETTI_G = 520;                       // px/s^2

export function makeWin({ atlas, breakdown, best, input, go, sfx, tapNeed }) {
  const { kills, coins, deaths, timeS, timeBonus, score } = breakdown;
  // main.js resolves `best` to max(previous, this run) before building us, so a
  // record is "we ARE the best". An exact tie with a previous best reads as a
  // record too — deliberate: matching your own best still earns the sparkle,
  // and the alternative is threading a second flag through for that one case.
  const record = score >= best && score > 0;
  let t = 0;

  // One sticker per win, rolled at scene construction. Plain Math.random is
  // fine here in a way it wouldn't be anywhere in the sim: this decides which
  // picture gets drawn and nothing else — it never touches score, save, or any
  // state a replay would need to reproduce.
  const pickName = PICKS[Math.floor(Math.random() * PICKS.length)];
  const sticker = getSticker(BRAND[pickName]);
  // Popper is a party popper; it gets a one-shot burst on entry. The other two
  // don't, so `confetti` stays null and the whole path costs nothing.
  const confetti = pickName === 'popper' ? makeConfetti() : null;

  const share = makeSharePrompt({ score, kills, deaths, mode: 'gauntlet' }, { sfx });

  // The share line's y (top of its scale-2 text box) — the touch band in
  // update() derives its centre from this, so moving the line moves the button.
  const SHARE_Y = 304;

  // Two-column ledger: label left-aligned at LX, value right-aligned at RX, so
  // the numbers stack into a readable column instead of drifting with label
  // length. Kept inside the middle 340px so nothing hugs the frame edge.
  const LX = 170, RX = 470;
  const ROWS = [
    [`kills ×100`, `${kills}`, `${kills * 100}`],
    [`coins ×10`, `${coins}`, `${coins * 10}`],
    [`time ${timeS}s`, 'bonus', `${timeBonus}`],
  ];

  // In-buffer layers: vignette → sparkles → confetti. The sticker art itself
  // is drawn in drawStickerOverlay below, at device resolution post-blit — see
  // main.js's render() for why (squash-then-stretch through the 640x360
  // buffer was what made these soft).
  function drawSticker(ctx) {
    softPlate(ctx, ST_CX, ST_CY, ST.size * 0.72);

    for (const s of SPARKS) {
      const a = s.ph + t * s.rate;
      const x = ST_CX + Math.cos(a) * s.r;
      const y = ST_CY + Math.sin(a * 1.3 + s.ph) * s.ry;
      // Twinkle keyed off the same angle, so a mote dims as it swings behind.
      ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(a * 2.1 + s.ph));
      ctx.fillStyle = s.c;
      ctx.fillRect(Math.round(x), Math.round(y), s.size, s.size);
    }
    ctx.globalAlpha = 1;

    if (confetti && t < CONFETTI_T) {
      // Closed-form position from scene time: no per-piece integration state to
      // keep, and the burst is identical whatever framerate it's rendered at.
      const fade = t > CONFETTI_T - 0.35 ? (CONFETTI_T - t) / 0.35 : 1;
      for (const c of confetti) {
        ctx.globalAlpha = fade;
        ctx.fillStyle = c.c;
        ctx.fillRect(Math.round(c.x + c.vx * t),
                     Math.round(c.y + c.vy * t + 0.5 * CONFETTI_G * t * t), 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Overlay: the sticker itself, drawn at device resolution post-blit.
  function drawStickerOverlay(sctx, S) {
    sticker.drawScaled(sctx, S, ST.x, ST.y, ST.size);
  }

  return {
    update(dt) {
      t += dt;
      share.update(dt, input);
      // No entry sting: the fanfare started at takeoff and is still ringing
      // through this screen. The only sound here are the buttons.
      if (input.pressed('retry')) { sfx?.play('uiclick'); go('title'); }
      // Touch path: a 44-virtual-px band around the share line is the share
      // button; a tap anywhere else is the primary action, same as R. Armed
      // after half a second so a fire thumb still held from the run's last
      // moment can't skip the screen it just earned.
      const taps = input.taps?.() ?? [];
      if (t > 0.5 && taps.length) {
        const band = shareTapBand(SHARE_Y, tapNeed?.());
        if (taps[0].y >= band.top && taps[0].y <= band.bot) share.tap();
        else { sfx?.play('uiclick'); go('title'); }
      }
    },

    render(ctx) {
      // Late-afternoon Mars, same planet the run just crossed: the production
      // sky and skyline drawn dimmed under a dusk wash (palette #16040f
      // family), with the tally on a dark plate. The backdrop is scenery, not
      // content — it stays quiet so the numbers stay the loudest thing here.
      ctx.fillStyle = '#16040f'; ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = 0.72;
      strip(ctx, atlas, 'par_stars', 0);            // the gauntlet's sunset sky
      strip(ctx, atlas, 'par_mesas', VH - 120);
      strip(ctx, atlas, 'par_rocks', VH - 80);
      ctx.globalAlpha = 1;
      const g = ctx.createLinearGradient(0, 0, 0, VH);
      g.addColorStop(0, 'rgba(22,4,15,0.30)'); g.addColorStop(1, 'rgba(22,4,15,0.66)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);   // full height: a short rect leaves a seam
      // The plate the tally sits on: full-width, same page-black family as the
      // title's legend band, spanning the ledger through the hint line.
      ctx.fillStyle = 'rgba(11,4,8,0.62)';
      ctx.fillRect(0, 96, VW, 248);

      drawTextShadow(ctx, 'MUCH MARS. VERY HOME.', VW / 2, 36,
                     { align: 'center', scale: 3 }, '#eec548', '#2a1c33');

      // ledger. Every row is scale 2 (14px tall); the old 20px row pitch is
      // kept so the block occupies the same slab of screen as before.
      const T2 = { scale: 2 };
      let y = 112;
      for (const [label, mid, val] of ROWS) {
        ctx.fillStyle = '#8a7db0'; drawText(ctx, label, LX, y, T2);
        ctx.fillStyle = '#5c5470'; drawText(ctx, mid, (LX + RX) / 2 + 20, y, { ...T2, align: 'center' });
        ctx.fillStyle = '#e8e0d0'; drawText(ctx, val, RX, y, { ...T2, align: 'right' });
        y += 20;
      }
      // deaths is informational: it already cost the run 100 wow each, live.
      ctx.fillStyle = '#8a7db0'; drawText(ctx, `deaths ${deaths}`, LX, y, T2);
      ctx.fillStyle = deaths ? '#e2413f' : '#8fa';
      drawText(ctx, deaths ? 'very ouch' : 'no ouch. wow.', RX, y, { ...T2, align: 'right' });

      ctx.strokeStyle = '#3a3350'; ctx.beginPath();
      ctx.moveTo(LX, y + 22); ctx.lineTo(RX, y + 22); ctx.stroke();

      ctx.fillStyle = '#eec548';
      drawText(ctx, 'TOTAL WOW', LX, y + 36, { scale: 3 });
      drawText(ctx, `${score}`, RX, y + 36, { scale: 3, align: 'right' });

      ctx.fillStyle = '#8fa';
      drawText(ctx, 'BEST WOW', LX, y + 66, T2);
      drawText(ctx, `${best}`, RX, y + 66, { ...T2, align: 'right' });

      if (record) {
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 5);
        ctx.fillStyle = '#eec548';
        drawText(ctx, 'very new record!', VW / 2, y + 90, { ...T2, align: 'center' });
        ctx.globalAlpha = 1;
      }

      share.render(ctx, SHARE_Y);

      // The WOW ZONE hint rides the same line as R. Reaching this screen IS
      // what unlocks the zone (main.js banks wowUnlocked before building this
      // scene), so the hint is unconditional here — and it exists because
      // playtesters pressed W right HERE and concluded the unlock was broken:
      // W is a title-screen key, correctly, and nothing said so.
      ctx.fillStyle = '#6f6a86';
      drawText(ctx, 'R = very again  ·  W on title = WOW ZONE', VW / 2, 328,
               { ...T2, align: 'center' });

      drawSticker(ctx);
    },

    renderOverlay(sctx, S) { drawStickerOverlay(sctx, S); },

    state: () => ({ finalScore: breakdown.score, best, sticker: pickName,
                    ...share.state() }),
  };
}
