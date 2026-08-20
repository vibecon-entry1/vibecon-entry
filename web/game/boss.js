// MEGA SAUCER boss: single hand-authored enemy, deterministic phase machine
// (no Math.random anywhere — timers are pure dt accumulation so replays/tape
// tests are reproducible). x/y are the boss CENTER (rendering anchor); hitTest
// and the slam contact box are both built around that same center, so callers
// never need to know about a separate feet point like the roster enemies do.
//
// Phase cycle (repeats forever): sweep(5s) -> spread(2s) -> sweep(5s) -> slam
// Slam itself is a mini state machine: descend -> hold(0.3s) -> rise, timed by
// distance/speed rather than a fixed clock, which nets ~0.97s at the given
// speeds (spec's "≈1.6s" is an upper-bound budget, not an exact duration).
const SWEEP_T = 5, SPREAD_T = 2;
const SWEEP_AMP = 140, SWEEP_PERIOD = 4, BOB_AMP = 8, BOB_PERIOD = 3;
const SPREAD_CD = 1.2;
const SLAM_DOWN_SPEED = 300, SLAM_HOLD = 0.3, SLAM_UP_SPEED = 200;
const HP_MAX = 40;
const HOME_OFFSET = 120;         // hover home is floorY - 120
const SLAM_DROP = 40;            // slam bottoms out at floorY - 40

export function makeBoss(x, floorY) {
  const homeX = x;
  const homeY = floorY - HOME_OFFSET;
  const slamY = floorY - SLAM_DROP;

  const b = {
    on: true,
    hp: HP_MAX,
    x, y: homeY,
    phase: 'sweep',
    sweepCount: 0,       // 0 = first sweep of the cycle, 1 = second (before slam)
    t: 0,                // time-in-phase (spread/sweep) or time-in-slam-stage
    fireCd: 0,
    slamStage: null,     // 'down' | 'hold' | 'up' while phase === 'slam'
  };

  function enterPhase(phase) {
    b.phase = phase;
    b.t = 0;
    b.fireCd = 0;
    if (phase === 'slam') b.slamStage = 'down';
  }

  function updateSweep(dt) {
    b.t += dt;
    b.x = homeX + Math.sin(b.t * (2 * Math.PI / SWEEP_PERIOD)) * SWEEP_AMP;
    b.y = homeY + Math.sin(b.t * (2 * Math.PI / BOB_PERIOD)) * BOB_AMP;
    if (b.t >= SWEEP_T) {
      if (b.sweepCount === 0) { b.sweepCount = 1; enterPhase('spread'); }
      else { b.sweepCount = 0; enterPhase('slam'); }
    }
  }

  function updateSpread(dt, enemyBullets) {
    b.t += dt;
    b.fireCd -= dt;
    if (b.fireCd <= 0) {
      b.fireCd += SPREAD_CD;
      for (const dx of [-0.5, 0, 0.5]) enemyBullets.spawn(b.x, b.y + 30, dx, 1);
    }
    if (b.t >= SPREAD_T) enterPhase('sweep');
  }

  function updateSlam(dt) {
    b.x = homeX;   // hold x through the whole slam
    if (b.slamStage === 'down') {
      b.y = Math.min(slamY, b.y + SLAM_DOWN_SPEED * dt);
      if (b.y >= slamY) { b.slamStage = 'hold'; b.t = 0; }
    } else if (b.slamStage === 'hold') {
      b.t += dt;
      if (b.t >= SLAM_HOLD) b.slamStage = 'up';
    } else { // 'up'
      b.y = Math.max(homeY, b.y - SLAM_UP_SPEED * dt);
      if (b.y <= homeY) { b.sweepCount = 0; enterPhase('sweep'); }
    }
  }

  function contactCheck(pb, onHurtPlayer) {
    if (!pb || !pb.w) return;
    const w = 190, h = 120;   // boss contact box, tightened to the visible sprite
    if (Math.abs(pb.x - b.x) < (pb.w + w) / 2 &&
        pb.y > b.y - h / 2 - pb.h && pb.y - pb.h < b.y + h / 2)
      onHurtPlayer(b.x);
  }

  return {
    get on() { return b.on; }, set on(v) { b.on = v; },
    get hp() { return b.hp; }, set hp(v) { b.hp = v; },
    hpMax: HP_MAX,          // exposed so HUD bars scale off the boss, not a literal
    get x() { return b.x; }, get y() { return b.y; },
    get phase() { return b.phase; }, get t() { return b.t; },

    update(dt, playerBody, enemyBullets, onHurtPlayer) {
      if (!b.on) return;
      if (b.phase === 'sweep') updateSweep(dt);
      else if (b.phase === 'spread') updateSpread(dt, enemyBullets);
      else if (b.phase === 'slam') updateSlam(dt);
      contactCheck(playerBody, onHurtPlayer);
    },

    hitTest(pt) {
      return Math.abs(pt.x - b.x) < 100 && Math.abs(pt.y - b.y) < 70;
    },

    hurt() {
      b.hp -= 1;
      if (b.hp <= 0) { b.hp = 0; b.on = false; return true; }
      return false;
    },
  };
}
