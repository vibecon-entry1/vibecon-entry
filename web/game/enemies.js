// Enemies: hopper (patrols, turns at ledges/walls), red hopper (faster, 2hp),
// saucer (hovers on a sine bob, drops bolts at a near player). Factory keeps a
// plain array; death goes through kill() so FX/score/refill hooks stay in the
// scene. Feet-anchored like the player.
import { TILE } from './chunks.js';

const KIND = {
  hopper:    { hp: 1, speed: 30,  w: 30, h: 36, anim: 'enemywalk' },
  redhopper: { hp: 2, speed: 55,  w: 30, h: 30, anim: 'enemywalk_red' },
  saucer:    { hp: 1, speed: 0,   w: 34, h: 26, anim: 'enemyfly' },
};
const SAUCER_RANGE = 180, SAUCER_CD = 1.6, SAUCER_BOB = 10;

export function makeEnemies(defs, level) {
  const list = defs.filter(d => KIND[d.type]).map(d => ({
    type: d.type, ...KIND[d.type],
    x: d.x, y: d.y, homeY: d.y - (d.type === 'saucer' ? 40 : 0),
    vx: KIND[d.type].speed, t: (d.x * 7919) % 6, fireCd: 0, on: true,
  }));

  const t = v => Math.floor(v / TILE);
  const groundAhead = (e) => level.solidAt(t(e.x + Math.sign(e.vx) * (e.w / 2 + 2)), t(e.y + 1));
  const wallAhead = (e) => level.solidAt(t(e.x + Math.sign(e.vx) * (e.w / 2 + 2)), t(e.y - e.h / 2));

  return {
    update(dt, playerBody, enemyBullets, onHurtPlayer) {
      for (const e of list) {
        if (!e.on) continue;
        e.t += dt;
        if (e.type === 'saucer') {
          e.y = e.homeY + Math.sin(e.t * 2.2) * SAUCER_BOB;
          e.fireCd = Math.max(0, e.fireCd - dt);
          const dx = playerBody.x - e.x;
          if (Math.abs(dx) < SAUCER_RANGE && e.fireCd === 0) {
            enemyBullets.spawn(e.x, e.y + 6, 0, 1);
            e.fireCd = SAUCER_CD;
          }
        } else {
          if (!groundAhead(e) || wallAhead(e)) e.vx = -e.vx;
          e.x += e.vx * dt;
        }
        // contact damage (AABB vs player, feet-anchored both)
        const pb = playerBody;
        if (pb.w && Math.abs(pb.x - e.x) < (pb.w + e.w) / 2 &&
            pb.y > e.y - e.h && pb.y - pb.h < e.y)
          onHurtPlayer(e.x);
      }
    },
    forEach(fn) { for (const e of list) if (e.on) fn(e); },
    hitTest(pt) {
      for (const e of list)
        if (e.on && Math.abs(pt.x - e.x) < e.w / 2 + 4 && pt.y > e.y - e.h - 4 && pt.y < e.y + 4)
          return e;
      return null;
    },
    kill(e, onKill) { if (e.on) { e.on = false; onKill?.(e); } },
    count() { return list.filter(e => e.on).length; },
  };
}
