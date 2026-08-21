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

// One live enemy from a def. Shared by the authored roster and by runtime
// spawnDef() summons so a boss-summoned minion is byte-identical to a chunk one
// (same fields, same wiring, same kill/hitTest/contact paths) — the ONLY
// difference is the `summoned` flag, which reviveAll() reads.
function initEnemy(d, summoned = false) {
  return {
    type: d.type, ...KIND[d.type],
    // hopper y is a hard floor-alignment invariant from chunk data — never corrected at runtime
    x: d.x, y: d.y, homeY: d.y - (d.type === 'saucer' ? 40 : 0),
    vx: KIND[d.type].speed, t: (d.x * 7919) % 6, fireCd: 0, on: true, summoned,
    // spawn snapshot: everything reviveAll() has to undo. hp is mutated by bolt
    // hits (redhoppers take two), x drifts along the patrol, saucer y rides the bob.
    spawn: { x: d.x, y: d.y, hp: KIND[d.type].hp, vx: KIND[d.type].speed },
  };
}

export function makeEnemies(defs, level) {
  let list = defs.filter(d => KIND[d.type]).map(d => initEnemy(d));

  const t = v => Math.floor(v / TILE);
  const groundAhead = (e) => level.solidAt(t(e.x + Math.sign(e.vx) * (e.w / 2 + 2)), t(e.y + 1));
  const wallAhead = (e) => level.solidAt(t(e.x + Math.sign(e.vx) * (e.w / 2 + 2)), t(e.y - e.h / 2));

  return {
    update(dt, playerBody, enemyBullets, onHurtPlayer) {
      for (const e of list) {
        if (!e.on) continue;
        if (Math.abs(playerBody.x - e.x) > 1400) continue;   // offscreen enemies sleep (pacing + perf)
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
    // Bolt-vs-enemy overlap. The TOP slop is 14, not the 4 used on the sides
    // and underneath: the forward bolt leaves the barrel at body.y - 30 (true
    // gun height), which is above a hopper's 24px head when the hero is at a
    // hop apex. The extra 10px of upward tolerance is what buys the same
    // airborne-shot effectiveness the old, visually-wrong y-22 origin gave for
    // free. Asymmetric on purpose — widening the bottom would let a bolt kill
    // through the floor.
    hitTest(pt) {
      for (const e of list)
        if (e.on && Math.abs(pt.x - e.x) < e.w / 2 + 4 && pt.y > e.y - e.h - 14 && pt.y < e.y + 4)
          return e;
      return null;
    },
    kill(e, onKill) { if (e.on) { e.on = false; onKill?.(e); } },
    // Push a live enemy into the roster mid-run (boss summon). Returns the
    // enemy so callers can pop FX off it; null for an unknown kind.
    spawnDef(d) {
      if (!KIND[d.type]) return null;
      const e = initEnemy(d, true);
      list.push(e);
      return e;
    },
    // Real death rewinds the whole roster, not just the corpses: an enemy you
    // merely walked past has drifted off its spawn, so the retry would otherwise
    // start from a scrambled board. Full roster, no partial restore.
    reviveAll() {
      // Summoned minions are NOT part of the authored roster: they were a boss
      // phase's output, not level content, so a real death deletes them outright
      // rather than reviving them (otherwise every retry compounds the arena).
      list = list.filter(e => !e.summoned);
      for (const e of list) {
        e.on = true;
        e.hp = e.spawn.hp;
        e.x = e.spawn.x; e.y = e.spawn.y;
        e.vx = e.spawn.vx;
        e.fireCd = 0;
      }
    },
    count() { return list.filter(e => e.on).length; },
  };
}
