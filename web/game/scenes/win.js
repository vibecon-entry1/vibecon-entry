// Results screen. Everything here is already-computed: breakdown comes from
// play.js's breakdown() (which folded timeBonus into score exactly once) and
// best is resolved by main.js BEFORE this scene is built, so the win scene
// never touches save — it only reads two numbers and lays them out.
import { getSticker, BRAND } from '../../engine/sticker.js';

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

export function makeWin({ breakdown, best, input, go }) {
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

  // Two-column ledger: label left-aligned at LX, value right-aligned at RX, so
  // the numbers stack into a readable column instead of drifting with label
  // length. Kept inside the middle 340px so nothing hugs the frame edge.
  const LX = 170, RX = 470;
  const ROWS = [
    [`kills ×100`, `${kills}`, `${kills * 100}`],
    [`coins ×10`, `${coins}`, `${coins * 10}`],
    [`time ${timeS}s`, 'bonus', `${timeBonus}`],
  ];

  // Vignette → art → sparkles → confetti.
  function drawSticker(ctx) {
    softPlate(ctx, ST_CX, ST_CY, ST.size * 0.72);
    sticker.draw(ctx, ST.x, ST.y, ST.size);

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

  return {
    update(dt) {
      t += dt;
      if (input.pressed('retry')) go('title');
    },

    render(ctx) {
      ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, VW, VH);
      const g = ctx.createLinearGradient(0, 0, 0, VH);
      g.addColorStop(0, 'rgba(60,36,72,0.55)'); g.addColorStop(0.6, 'rgba(11,11,18,0)');
      g.addColorStop(1, 'rgba(11,11,18,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);   // full height: a short rect leaves a seam

      ctx.textAlign = 'center';
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#2a1c33'; ctx.fillText('MUCH MARS. VERY HOME.', VW / 2 + 2, 52 + 2);
      ctx.fillStyle = '#eec548'; ctx.fillText('MUCH MARS. VERY HOME.', VW / 2, 52);

      // ledger
      ctx.font = '11px monospace';
      let y = 122;
      for (const [label, mid, val] of ROWS) {
        ctx.textAlign = 'left'; ctx.fillStyle = '#8a7db0';
        ctx.fillText(label, LX, y);
        ctx.textAlign = 'center'; ctx.fillStyle = '#5c5470';
        ctx.fillText(mid, (LX + RX) / 2 + 20, y);
        ctx.textAlign = 'right'; ctx.fillStyle = '#e8e0d0';
        ctx.fillText(val, RX, y);
        y += 20;
      }
      // deaths is informational: it already cost the run 100 wow each, live.
      ctx.textAlign = 'left'; ctx.fillStyle = '#8a7db0';
      ctx.fillText(`deaths ${deaths}`, LX, y);
      ctx.textAlign = 'right'; ctx.fillStyle = deaths ? '#e2413f' : '#8fa';
      ctx.fillText(deaths ? 'very ouch' : 'no ouch. wow.', RX, y);

      ctx.strokeStyle = '#3a3350'; ctx.beginPath();
      ctx.moveTo(LX, y + 12); ctx.lineTo(RX, y + 12); ctx.stroke();

      ctx.textAlign = 'left'; ctx.font = 'bold 16px monospace'; ctx.fillStyle = '#eec548';
      ctx.fillText('TOTAL WOW', LX, y + 38);
      ctx.textAlign = 'right'; ctx.fillText(`${score}`, RX, y + 38);

      ctx.font = '10px monospace'; ctx.fillStyle = '#8fa';
      ctx.textAlign = 'left'; ctx.fillText('BEST WOW', LX, y + 62);
      ctx.textAlign = 'right'; ctx.fillText(`${best}`, RX, y + 62);

      ctx.textAlign = 'center';
      if (record) {
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 5);
        ctx.font = '10px monospace'; ctx.fillStyle = '#eec548';
        ctx.fillText('very new record!', VW / 2, y + 82);
        ctx.globalAlpha = 1;
      }

      ctx.font = '11px monospace'; ctx.fillStyle = '#6f6a86';
      ctx.fillText('R = very again', VW / 2, 336);
      ctx.textAlign = 'left';

      drawSticker(ctx);
    },

    state: () => ({ finalScore: breakdown.score, best, sticker: pickName }),
  };
}
