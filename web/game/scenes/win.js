// Results screen. Everything here is already-computed: breakdown comes from
// play.js's breakdown() (which folded timeBonus into score exactly once) and
// best is resolved by main.js BEFORE this scene is built, so the win scene
// never touches save — it only reads two numbers and lays them out.
const VW = 640, VH = 360;

export function makeWin({ breakdown, best, input, go }) {
  const { kills, coins, deaths, timeS, timeBonus, score } = breakdown;
  // main.js resolves `best` to max(previous, this run) before building us, so a
  // record is "we ARE the best". An exact tie with a previous best reads as a
  // record too — deliberate: matching your own best still earns the sparkle,
  // and the alternative is threading a second flag through for that one case.
  const record = score >= best && score > 0;
  let t = 0;

  // Two-column ledger: label left-aligned at LX, value right-aligned at RX, so
  // the numbers stack into a readable column instead of drifting with label
  // length. Kept inside the middle 340px so nothing hugs the frame edge.
  const LX = 170, RX = 470;
  const ROWS = [
    [`kills ×100`, `${kills}`, `${kills * 100}`],
    [`coins ×10`, `${coins}`, `${coins * 10}`],
    [`time ${timeS}s`, 'bonus', `${timeBonus}`],
  ];

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
    },

    state: () => ({ finalScore: breakdown.score, best }),
  };
}
