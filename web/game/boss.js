// MEGA SAUCER boss: single hand-authored enemy, deterministic phase machine
// (no Math.random anywhere — timers are pure dt accumulation so replays/tape
// tests are reproducible). x/y are the boss CENTER (rendering anchor); hitTest
// and the slam contact box are both built around that same center, so callers
// never need to know about a separate feet point like the roster enemies do.
//
// Phase cycle (repeats forever):
//   sweep(5s) -> spread(2s) -> sweep(5s) -> slam -> sweep(5s) -> summon(1s)
// Slam itself is a mini state machine: descend -> hold(0.3s) -> rise, timed by
// distance/speed rather than a fixed clock, which nets ~0.97s at the given
// speeds (spec's "≈1.6s" is an upper-bound budget, not an exact duration).
// Summon is the "smaller enemy drops" beat: the boss parks and coughs two
// minions onto the arena floor. The boss itself owns NO enemy list — it just
// emits defs through onSummon and lets the scene decide what to do with them
// (cap, popup, FX), the same way spread emits bolts through enemyBullets.
const SWEEP_T = 5, SPREAD_T = 2;
const SWEEP_AMP = 140, SWEEP_PERIOD = 4, BOB_AMP = 8, BOB_PERIOD = 3;
const SPREAD_CD = 1.2;
const SLAM_DOWN_SPEED = 300, SLAM_HOLD = 0.3, SLAM_UP_SPEED = 200;
const SUMMON_T = 1;
const SUMMON_DX = 80;            // minions land this far either side of the boss
const HP_MAX = 40;
const HOME_OFFSET = 120;         // hover home is floorY - 120
const SLAM_DROP = 40;            // slam bottoms out at floorY - 40

export function makeBoss(x, floorY) {
  const homeX = x;
  const groundY = floorY;          // minions are FEET-anchored to the arena floor
  const homeY = floorY - HOME_OFFSET;
  const slamY = floorY - SLAM_DROP;

  const b = {
    on: true,
    hp: HP_MAX,
    x, y: homeY,
    phase: 'sweep',
    // which sweep of the cycle we're in: 0 -> spread, 1 -> slam, 2 -> summon.
    sweepCount: 0,
    t: 0,                // time-in-phase (spread/sweep) or time-in-slam-stage
    fireCd: 0,
    slamStage: null,     // 'down' | 'hold' | 'up' while phase === 'slam'
    summoned: false,     // one-shot latch: onSummon fires once per summon phase
  };

  function enterPhase(phase) {
    b.phase = phase;
    b.t = 0;
    b.fireCd = 0;
    if (phase === 'slam') b.slamStage = 'down';
    if (phase === 'summon') b.summoned = false;
  }

  function updateSweep(dt) {
    b.t += dt;
    b.x = homeX + Math.sin(b.t * (2 * Math.PI / SWEEP_PERIOD)) * SWEEP_AMP;
    b.y = homeY + Math.sin(b.t * (2 * Math.PI / BOB_PERIOD)) * BOB_AMP;
    if (b.t >= SWEEP_T) {
      const next = ['spread', 'slam', 'summon'][b.sweepCount];
      b.sweepCount = (b.sweepCount + 1) % 3;
      enterPhase(next);
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
      if (b.y <= homeY) enterPhase('sweep');
    }
  }

  // Hold station and drop two minions. onSummon is optional so the 4-arg
  // callers in the unit tests (and any future headless probe) never crash.
  function updateSummon(dt, onSummon) {
    b.x = homeX;                   // parked: the tell that something else is coming
    b.t += dt;
    if (!b.summoned) {
      b.summoned = true;
      onSummon?.([
        { type: 'hopper', x: b.x - SUMMON_DX, y: groundY },
        { type: 'saucer', x: b.x + SUMMON_DX, y: groundY },
      ]);
    }
    if (b.t >= SUMMON_T) enterPhase('sweep');
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

    update(dt, playerBody, enemyBullets, onHurtPlayer, onSummon) {
      if (!b.on) return;
      if (b.phase === 'sweep') updateSweep(dt);
      else if (b.phase === 'spread') updateSpread(dt, enemyBullets);
      else if (b.phase === 'slam') updateSlam(dt);
      else if (b.phase === 'summon') updateSummon(dt, onSummon);
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
