// Pooled projectile bolts. dir = (dx,dy) unit-ish; rendering rotates the
// horizontal bolt art for vertical shots (90° stays pixel-crisp).
// One instance per FACTION (player vs enemies) — never share a pool.
import { TILE } from './chunks.js';
import { animFrame } from '../engine/assets.js';

const MAX = 32, SPEED = 380, LIFE = 0.6;

export function makeBullets() {
  const pool = Array.from({ length: MAX }, () => ({ on: false, x: 0, y: 0, dx: 0, dy: 0, t: 0 }));
  const pops = [];                               // {x, y, t} blast_pop anims
  let cursor = 0, fired = 0;

  return {
    spawn(x, y, dx, dy, bonus = 0) {   // bonus: shooter momentum inherited along (dx,dy)
      const b = pool[cursor]; cursor = (cursor + 1) % MAX; fired++;
      Object.assign(b, { on: true, x, y, dx, dy, t: 0, spd: SPEED + bonus });
    },
    update(dt, level) {
      for (const b of pool) {
        if (!b.on) continue;
        b.t += dt;
        b.x += b.dx * b.spd * dt; b.y += b.dy * b.spd * dt;
        const solid = level.solidAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE));
        if (solid || b.t > LIFE) {
          if (solid) pops.push({ x: b.x, y: b.y, t: 0 });
          b.on = false;
        }
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t += dt;
        if (pops[i].t > 0.3) pops.splice(i, 1);
      }
    },
    forEachHittable(fn) { for (const b of pool) if (b.on) fn(b); },   // Plan 2: enemy collision
    kill(b) {                                     // the ONLY external kill path
      if (!b.on) return;
      b.on = false;
      pops.push({ x: b.x, y: b.y, t: 0 });
    },
    count() { return pool.filter(b => b.on).length; },
    // Lifetime spawn tally — observability only (tests assert shots actually left
    // the barrel; live bolts expire too fast to count reliably from outside).
    fired() { return fired; },
    pops() { return pops; },
    render(ctx, atlas) {
      for (const b of pool) {
        if (!b.on) continue;
        const rot = b.dy > 0 ? Math.PI / 2 : b.dy < 0 ? -Math.PI / 2 : 0;
        const a = atlas.anims.blast_bolt;
        ctx.save();
        if (b.dx < 0) { ctx.translate(b.x, b.y); ctx.scale(-1, 1); ctx.translate(-b.x, -b.y); }
        atlas.drawCentered(ctx, 'blast_bolt', animFrame(a, b.t), b.x, b.y, rot);
        ctx.restore();
      }
      for (const p of pops) {
        // Source art reads oversized/artifact-like at native scale (~30px
        // saturated red blob) — half scale reads as a quick spark instead.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(0.5, 0.5);
        atlas.drawCentered(ctx, 'blast_pop', animFrame(atlas.anims.blast_pop, p.t), 0, 0, 0);
        ctx.restore();
      }
    },
  };
}
