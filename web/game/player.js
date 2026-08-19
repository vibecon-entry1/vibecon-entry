// The verb. States: spawn/idle/walk/slide/duck/air. Fire is context-sensitive:
//   grounded+down  → hop      | airborne+down → boost (costs air charge)
//   during slide   → backward bolt + forward burst (capped at BURST_MAX)
//   otherwise      → forward bolt (free, no physics effect)
// Height growth (standing up) always goes through bodyFits — never embed in a ceiling.
import { P, moveAndCollide, bodyFits } from './physics.js';

const STAND_H = 44, SLIDE_H = 24, DUCK_H = 32, W = 20;

export function makePlayer(spawnFeet) {
  const pl = {
    body: { x: spawnFeet.x, y: spawnFeet.y, w: W, h: STAND_H, vx: 0, vy: 0 },
    state: 'spawn', stateT: 0, facing: 1,
    airCharges: P.AIR_CHARGES, coyote: 0, fireCd: 0, slideT: 0,
    checkpoint: { ...spawnFeet }, deaths: 0, muzzle: null,
    update, setState,
  };

  function setState(s) { if (pl.state !== s) { pl.state = s; pl.stateT = 0; } }

  function fire(bullets, dx, dy, fromX, fromY) {
    bullets.spawn(fromX, fromY, dx, dy);
    pl.muzzle = { t: 0, dx, dy, x: fromX, y: fromY };
    pl.fireCd = P.FIRE_CD;
  }

  function tryStand(level) {
    if (bodyFits(level, pl.body.x, pl.body.y, pl.body.w, STAND_H)) {
      pl.body.h = STAND_H;
      return true;
    }
    return false;
  }

  const clampMag = (v, m) => Math.max(-m, Math.min(m, v));

  function update(dt, act, level, bullets) {
    pl.stateT += dt; pl.fireCd = Math.max(0, pl.fireCd - dt);
    if (pl.muzzle && (pl.muzzle.t += dt) > 0.1) pl.muzzle = null;
    const b = pl.body;

    if (pl.state === 'spawn') {                       // beam-in: locked until done
      if (pl.stateT > 39 / 20) setState('idle');      // spawn anim = 39f @ 20fps
      return;
    }

    // honest ground truth for THIS frame (coyote alone is one frame stale)
    const onGround = !bodyFits(level, b.x, b.y + 1, b.w, 1);
    if (onGround) pl.coyote = P.COYOTE;

    // horizontal intent + facing
    const dir = (act.right ? 1 : 0) - (act.left ? 1 : 0);
    if (dir !== 0 && pl.state !== 'slide') pl.facing = dir;

    const grounded = pl.coyote > 0;
    const wantSlide = grounded && act.down && dir !== 0 && pl.state !== 'slide';
    const wantDuck = grounded && act.down && dir === 0 && pl.state !== 'slide';

    if (pl.state === 'slide') {
      pl.slideT += dt;
      b.vx = Math.max(0, Math.abs(b.vx) - P.SLIDE_DECAY * dt) * Math.sign(b.vx || pl.facing);
      if (!grounded) {
        if (bodyFits(level, b.x, b.y, b.w, STAND_H))
          setState('air');                            // fell off mid-slide; height restored below
        // else: pinned airborne — hold the slide pose so stateT stays continuous
      } else if ((pl.slideT > P.SLIDE_MIN && (!act.down || dir === 0)) ||
                 Math.abs(b.vx) < 8) {
        if (tryStand(level)) setState('idle');        // pinned under ceiling → keep sliding
      }
    } else if (wantSlide) {
      b.h = SLIDE_H; pl.slideT = 0; setState('slide');
      b.vx = pl.facing * Math.max(Math.abs(b.vx), P.SLIDE_SPEED);
    } else if (wantDuck) {
      b.h = DUCK_H; setState('duck');
      b.vx = Math.max(0, Math.abs(b.vx) - P.FRICTION * dt) * Math.sign(b.vx);
    } else {
      if (pl.state === 'duck') {
        if (tryStand(level)) setState('idle');        // pinned → stay ducked
      }
      if (pl.state !== 'duck') {
        const drag = (onGround ? P.FRICTION : P.AIR_DRAG) * dt;
        if (dir !== 0 && Math.sign(b.vx) === dir && Math.abs(b.vx) > P.RUN)
          b.vx = Math.max(P.RUN, Math.abs(b.vx) - drag) * dir;      // keep launch/burst speed
        else if (dir !== 0) b.vx = clampMag(b.vx + dir * P.RUN_ACCEL * dt, P.RUN);
        else b.vx = Math.max(0, Math.abs(b.vx) - drag) * Math.sign(b.vx);
      }
    }

    // fire — context-sensitive
    if (act.fire && pl.fireCd === 0) {
      if (pl.state === 'slide') {
        fire(bullets, -pl.facing, 0, b.x - pl.facing * 14, b.y - 12);
        b.vx = pl.facing * Math.min(Math.abs(b.vx) + P.BURST_VX, P.BURST_MAX);
      } else if (act.down && grounded) {
        fire(bullets, 0, 1, b.x, b.y - 6);
        b.vy = P.HOP_VY; pl.coyote = 0;
      } else if (act.down && !grounded) {
        if (pl.airCharges > 0) {
          pl.airCharges--;
          fire(bullets, 0, 1, b.x, b.y - 6);
          b.vy = P.BOOST_VY;
        }
      } else {
        fire(bullets, pl.facing, 0, b.x + pl.facing * 26, b.y - 30);
      }
    }

    // gravity + integrate
    b.vy = Math.min(b.vy + P.GRAV * dt, P.MAX_FALL);
    const res = moveAndCollide(b, level, dt);
    if (res.onGround) {
      pl.coyote = P.COYOTE;
      if (pl.airCharges < P.AIR_CHARGES) pl.airCharges = P.AIR_CHARGES;
      if (pl.state !== 'slide' && pl.state !== 'duck')
        setState(Math.abs(b.vx) > 10 || dir !== 0 ? 'walk' : 'idle');
    } else {
      pl.coyote = Math.max(0, pl.coyote - dt);
      if (pl.state !== 'slide' && pl.coyote === 0 && bodyFits(level, b.x, b.y, b.w, STAND_H))
        setState('air');   // pinned airborne keeps its shrunken pose (mirror of the slide guard)
    }

    // shrunken hitbox outside slide/duck (fell out of a slide): restore when clear
    if (b.h < STAND_H && pl.state !== 'slide' && pl.state !== 'duck' && !tryStand(level))
      setState(b.h <= SLIDE_H ? 'slide' : 'duck');   // pinned: pose must match the box

    // pit death → respawn beam at checkpoint
    if (b.y > level.h + 64) {
      pl.deaths++;
      Object.assign(b, { x: pl.checkpoint.x, y: pl.checkpoint.y, vx: 0, vy: 0, h: STAND_H });
      pl.airCharges = P.AIR_CHARGES;
      pl.muzzle = null;
      setState('spawn');
    }
    // checkpoint capture
    for (const c of level.checkpoints)
      if (Math.abs(b.x - c.x) < 12 && Math.abs(b.y - c.y) < 24) pl.checkpoint = { ...c };
  }

  return pl;
}
