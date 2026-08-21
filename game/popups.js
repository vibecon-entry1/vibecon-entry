// Floating doge text: rises, fades over 0.8s. Pool of 8.
//
// Drawn on the 5x7 bitmap font (engine/font.js) rather than canvas fillText —
// the AA fringe of a 10px canvas font got magnified by the DPR-crisp world
// scale, so a popup was the softest thing on screen mid-fade. The font draws
// filled rects, so ctx.globalAlpha still fades it exactly as before.
import { drawText } from '../engine/font.js';

const LIFE = 0.8, RISE = 25;

export function makePopups() {
  const pool = Array.from({ length: 8 }, () => ({ on: false, x: 0, y: 0, t: 0, text: '' }));
  let cur = 0;
  return {
    spawn(x, y, text) {
      const p = pool[cur]; cur = (cur + 1) % pool.length;
      Object.assign(p, { on: true, x, y, t: 0, text });
    },
    update(dt) { for (const p of pool) if (p.on && (p.t += dt) > LIFE) p.on = false; },
    render(ctx) {
      ctx.fillStyle = '#eec548';
      for (const p of pool) {
        if (!p.on) continue;
        ctx.globalAlpha = 1 - p.t / LIFE;
        drawText(ctx, p.text.toUpperCase(), p.x, p.y - RISE * (p.t / LIFE), { align: 'center' });
      }
      ctx.globalAlpha = 1;
    },
  };
}
