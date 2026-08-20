// The verb. States: spawn/idle/walk/slide/duck/air. Fire is context-sensitive,
// resolved in this order:
//   pinned under a ceiling → backward bolt + forward burst (capped at BURST_MAX)
//   grounded+down          → hop (from a slide: slide-hop, keeps slide speed)
//   airborne+down          → boost (costs air charge)
//   sliding (down released) → backward bolt + forward burst
//   otherwise              → forward bolt (free, no physics effect)
// Height growth (standing up) always goes through bodyFits — never embed in a
// ceiling; that includes the checkpoint respawn.
import { P, moveAndCollide, bodyFits } from './physics.js';

const STAND_H = 44, SLIDE_H = 24, DUCK_H = 32, W = 20;

export function makePlayer(spawnFeet) {
  const pl = {
    body: { x: spawnFeet.x, y: spawnFeet.y, w: W, h: STAND_H, vx: 0, vy: 0 },
    state: 'spawn', stateT: 0, facing: 1,
    airCharges: P.AIR_CHARGES, coyote: 0, fireCd: 0, slideT: 0,
    checkpoint: { ...spawnFeet }, deaths: 0, muzzle: null,
    hp: P.HP_MAX, iframes: 0,
    update, setState, hurt,
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

  // Beam back in at the checkpoint. Shared by pit death and hp-0 death; the
  // caller owns the deaths++ so a corpse that also slides into a pit can't
  // double-count. Height is bodyFits-guarded — never embed in a ceiling.
  function respawn(level) {
    const cp = pl.checkpoint, b = pl.body;
    Object.assign(b, { x: cp.x, y: cp.y, vx: 0, vy: 0,
                       h: bodyFits(level, cp.x, cp.y, W, STAND_H) ? STAND_H : SLIDE_H });
    pl.airCharges = P.AIR_CHARGES;
    pl.muzzle = null;
    pl.hp = P.HP_MAX;
    pl.iframes = P.IFRAMES;   // post-beam grace: checkpoint 1 sits inside a hopper patrol
    setState('spawn');
  }

  // Damage from the world (enemy contact, bolts). fromX drives the knockback
  // direction. Invulnerable during iframes, and while already dead, staggered, or beaming in.
  function hurt(fromX) {
    if (pl.iframes > 0 || pl.state === 'hit' || pl.state === 'ded' || pl.state === 'spawn') return;
    pl.hp--;
    pl.iframes = P.IFRAMES;
    pl.body.vx = (Math.sign(pl.body.x - fromX) || 1) * P.KNOCK_VX;
    pl.body.vy = P.KNOCK_VY;
    setState(pl.hp <= 0 ? 'ded' : 'hit');
  }

  function update(dt, act, level, bullets) {
    pl.stateT += dt; pl.fireCd = Math.max(0, pl.fireCd - dt);
    if (pl.muzzle && (pl.muzzle.t += dt) > 0.1) pl.muzzle = null;
    const b = pl.body;

    if (pl.state === 'spawn') {                       // beam-in: locked until done
      if (pl.stateT > 39 / 20) setState('idle');      // spawn anim = 39f @ 20fps
      return;
    }

    pl.iframes = Math.max(0, pl.iframes - dt);

    // ded/hit run BEFORE the honest ground probe below, so neither can fall into
    // input processing: both are physics-only poses the player cannot steer.
    if (pl.state === 'ded') {                         // corpse: 18f @ 12fps, then beam
      b.vy = Math.min(b.vy + P.GRAV * dt, P.MAX_FALL);
      moveAndCollide(b, level, dt);
      // pit-out shortcut: a corpse that falls past the level bottom respawns
      // immediately instead of waiting out the corpse timer. This is still a
      // single-count fast-path — respawn() sets state 'spawn', so this block
      // can't re-enter and double up the deaths++ / respawn() call.
      if (pl.stateT > 18 / 12 || b.y > level.h + 64) { pl.deaths++; respawn(level); }
      return;
    }
    if (pl.state === 'hit') {                         // stagger: brief, physics-only
      // HIT_T truncates the 8f hit anim (~0.5s) on purpose — feel beats anim length.
      if (pl.stateT > P.HIT_T) {
        setState(!bodyFits(level, b.x, b.y + 1, b.w, 1) ? 'idle' : 'air');
        // fall through: this frame gets normal handling (and its own physics step)
      } else {
        b.vy = Math.min(b.vy + P.GRAV * dt, P.MAX_FALL);
        const r = moveAndCollide(b, level, dt);
        if (r.onGround) pl.coyote = P.COYOTE;
        return;
      }
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

    // fire — context-sensitive. Ground-shots beat slide-fire so down+fire always
    // hops (slide-hop carries slide speed); burst = fire while sliding with down
    // released, or any fire while pinned under a ceiling (burst is the only shot
    // that makes sense there).
    if (act.fire && pl.fireCd === 0) {
      const pinned = pl.state === 'slide' && !bodyFits(level, b.x, b.y, b.w, STAND_H);
      if (pinned) {
        fire(bullets, -pl.facing, 0, b.x - pl.facing * 14, b.y - 12);
        b.vx = pl.facing * Math.min(Math.abs(b.vx) + P.BURST_VX, P.BURST_MAX);
      } else if (act.down && grounded) {
        fire(bullets, 0, 1, b.x, b.y - 6);
        b.vy = P.HOP_VY; pl.coyote = 0;
        if (pl.state === 'slide') setState('air');    // slide-hop keeps slide speed
      } else if (act.down && !grounded) {
        if (pl.airCharges > 0) {
          pl.airCharges--;
          fire(bullets, 0, 1, b.x, b.y - 6);
          b.vy = P.BOOST_VY;
        }
      } else if (pl.state === 'slide') {
        fire(bullets, -pl.facing, 0, b.x - pl.facing * 14, b.y - 12);
        b.vx = pl.facing * Math.min(Math.abs(b.vx) + P.BURST_VX, P.BURST_MAX);
      } else {
        fire(bullets, pl.facing, 0, b.x + pl.facing * 26, b.y - 22);
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
      respawn(level);
    }
    // checkpoint capture
    for (const c of level.checkpoints)
      if (Math.abs(b.x - c.x) < 12 && Math.abs(b.y - c.y) < 24) pl.checkpoint = { ...c };
  }

  return pl;
}
