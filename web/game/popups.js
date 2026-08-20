// Floating doge text: rises, fades over 0.8s. Pool of 8.
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
      ctx.font = '10px monospace';
      for (const p of pool) {
        if (!p.on) continue;
        ctx.globalAlpha = 1 - p.t / LIFE;
        ctx.fillStyle = '#eec548';
        ctx.fillText(p.text, p.x - p.text.length * 3, p.y - RISE * (p.t / LIFE));
      }
      ctx.globalAlpha = 1;
    },
  };
}
