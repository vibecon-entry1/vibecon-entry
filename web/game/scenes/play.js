// The real play scene: GAUNTLET level + player + enemies + coins + score +
// parallax art + culled tile render + HUD.
//
// Render order is load-bearing and reads bottom-up:
//   parallax (screen space, OUTSIDE the camera) → tiles → signs → checkpoints
//   → coins → enemies → player → muzzle → bolts → popups → [restore] → HUD.
import { buildGauntlet, buildWowZone, WOW_LEN, CHUNK_W, TILE } from '../chunks.js';
import { makePlayer } from '../player.js';
import { makeBullets } from '../bullets.js';
import { makeEnemies } from '../enemies.js';
import { makeCoins } from '../coins.js';
import { makeBoss } from '../boss.js';
import { makeScore } from '../score.js';
import { makePopups } from '../popups.js';
import { makeCamera } from '../../engine/camera.js';
import { animFrame, animDone } from '../../engine/assets.js';
import { P } from '../physics.js';
// HUD + pause text uses the 5x7 bitmap font (engine/font.js). In-world text
// (the sign boards, score popups) uses it too now, at 1x scale: canvas
// fillText anti-aliased into softness the crisp DPR-scaled world made obvious.
import { drawText, drawTextShadow, measure } from '../../engine/font.js';

const VW = 640, VH = 360;

const ANIM_FOR = {                       // state → atlas anim
  spawn: 'spawn', idle: 'stand', walk: 'run', air: 'duck',
  slide: 'slide', duck: 'duck',
  hit: 'hit', ded: 'dead',
};
// 'air' is the one state that does NOT play its anim: it holds a single tucked
// frame out of the duck cycle (see AIR_FRAME below). A/B'd in-game against the
// run loop it was the clear winner — a run cycle in mid-air reads as the same
// silhouette as running on the ground, so at a glance you can't tell you left
// it, whereas the tuck is unmistakably airborne and sits right under the boot
// thruster. duck frame 6 is the most compact of the eight (46px tall, knee
// fully up); frames 0/1/7 are the stand-up transitions.
const AIR_FRAME = 6;

const wrap = (v, m) => ((v % m) + m) % m;   // JS % keeps the sign; scrolling needs it positive

// One scene serves both modes. The split is deliberately narrow: WOW ZONE
// changes the LEVEL (seeded chunk order), the MUSIC pool, what a death means
// (run over, not respawn) and the HUD's progress readout. Everything else —
// the verb, the enemies, the scoring, the camera, the parallax — is the same
// game, which is the whole point of an endless mode built out of the campaign's
// own chunks. `mode` is the only branch key; `seed` is meaningless in gauntlet.
export function makePlay({ atlas, input, save, go, jukebox, sfx, toggleMute, xOn,
                           mode = 'gauntlet', seed = 0 }) {
  const wow = mode === 'wow';
  jukebox?.playPool(wow ? 'wow' : 'run');   // no-op if we're already on that pool (R-restart)
  // fresh per scene: R-restart re-seals any carved gate. In wow the same seed
  // is re-dealt, so R is "run that one again", not "roll a new one".
  const level = wow ? buildWowZone(seed) : buildGauntlet();
  const player = makePlayer(level.spawn);
  const enemies = makeEnemies(level.entities, level);
  const coins = makeCoins(level.entities);
  const score = makeScore();
  const popups = makePopups();
  const playerBolts = makeBullets();          // one pool per FACTION — never shared
  const enemyBolts = makeBullets();
  const cam = makeCamera({ vw: VW, vh: VH });
  const camY0 = Math.max(0, level.h - VH);    // resting camera height; parallax pivots off it
  // World y of the walked floor band — chunks.js parks 8 tile rows (3 floor +
  // 5 repeats) below it. That line, not the bottom of the viewport, is the
  // horizon the distant bands hang off; anchoring them to the screen buries
  // them under the floor slab.
  const restLine = (level.h - 8 * TILE) - camY0;   // horizon, in screen px, at rest
  cam.snap(0, camY0);
  let paused = false;
  // Scene-level freeze: a brief world-stall on a big hit lands harder than any
  // amount of shake alone. SET on trigger (Math.max), never accumulated, so
  // spamming kills in one frame can't stack a multi-second stall — the strongest
  // hit that frame wins and everything still ticks down at the normal rate.
  let hitstop = 0;
  // A fire input the stall ate, kept alive until the sim can actually act on
  // it. See the hitstop bail in update() for why one frame is not enough.
  let stallFire = 0;
  const STALL_FIRE_T = 0.2;
  // --- run stats + extraction ------------------------------------------------
  let timeS = 0;                 // run clock, seconds (paused during takeoff)
  // killCredited: roster kills banked since the LAST respawn — refundKills()
  // zeroes it in lockstep with score.js's own killEarned, so the breakdown's
  // kill tally never brags about points the ledger already took back.
  // bossKilled is tracked separately and never resets: the boss dies once,
  // the gate stays carved, and the tally should keep crediting it forever.
  let killCredited = 0, bossKilled = false;
  let takeoff = -1;              // -1 = not started; >= 0 = seconds elapsed
  let liftY = 0;                 // how far the ship (and rider) has risen, px
  let thrustT = 0.25;            // thrust-FX metronome (pre-armed: puff on frame 1)
  let thrustSide = 1;            // alternating nozzle
  let prevHp = P.HP_MAX; let prevState = 'spawn'; let prevDeaths = 0;
  // WOW+ escalation: one popup per flight that grows instead of spamming a new
  // popup per event. Counts the WOW+ events banked during the CURRENT flight
  // (reset the frame we land), capped at three '+'.
  let flightWows = 0;
  // Down-shot pose timer. The player state machine has no 'firing down' state
  // (a down-shot is an impulse on 'air'/'walk'/'idle', not a state), and adding
  // one would put a cosmetic beat in charge of physics. So this is a pure DRAW
  // override: a shot resets it, and while it runs the hero is drawn in the
  // gundown pose regardless of what state he is actually in.
  let gunDownT = 0;
  const GUN_DOWN_T = 0.15;
  // --- wow-zone state --------------------------------------------------------
  // chunkIndex is the chunk the player is standing in; maxChunk is the farthest
  // one the run ever reached (the number the run-end screen brags about).
  // WSTART is chunk 0, so both read as "chunks of the dealt 40 cleared".
  let chunkIndex = 0, maxChunk = 0;
  let dedT = 0;                  // seconds spent dead — the run-end fuse
  const DED_OUT = 1.2;           // corpse anim is 1.5s; cut before it finishes
  // --- afk fail-safe ---------------------------------------------------------
  // A run left alone forever is a run that never ends: the score keeps its slot,
  // the music keeps streaming, and a shared machine keeps a game open on it. So
  // the scene keeps its own idle clock, and walking away eventually ends the run
  // the same way a saucer would.
  //
  // Two rules that are deliberately harsher than they look:
  //   - PAUSE IS NOT A SHIELD. The clock is ticked before the pause bail, so
  //     Escape hides the world but does not stop the fuse. Pausing to go and do
  //     something else is exactly the case this exists for.
  //   - ANY input resets it. Not 'meaningful' input, not movement — every key
  //     the game reads, held or tapped, on any frame. The clock is asking "is
  //     anybody there", and a held key answers that question.
  // The extraction cutscene is the one stretch that does NOT tick: it drives
  // itself to the win screen on a 2.5s fuse and takes no input by design.
  const AFK_WARN = 120;          // seconds of nothing before the countdown shows
  const AFK_OUT = 300;           // ...and before the run is taken away
  let idleT = 0;                 // seconds since the last input of any kind
  let outT = -1;                 // -1 = not fired; >= 0 = seconds since it fired
  // Free-running scene clock for the decorative bands below. Deliberately its
  // own accumulator rather than timeS: that one is the RUN clock and stops for
  // the pause and the extraction, and ambient motion that freezes with the
  // world reads as a stall rather than as atmosphere.
  let ambT = 0;
  let deco = null;                // lazily built once, see decoOrb()
  // --- boss state ------------------------------------------------------------
  // bossSpawned is a ONE-WAY latch: it stays true through the boss's death AND
  // through a mid-fight real death, so the arena can never re-arm a second saucer.
  let boss = null, bossSpawned = false, bossAnimT = 0;
  // Summon phase bookkeeping. The cap is checked at SPAWN time against the live
  // summoned population, so a player who clears minions gets fresh ones on the
  // next cycle while a player who ignores them never faces more than MINION_CAP.
  let sawSummon = false;
  const fx = [];                          // explode puffs: { x, y, t } — t < 0 = staggered wait
  const MINION_CAP = 4;                   // live boss-summoned minions at once
  // Floor top at the trigger column, scanned out of the level rather than
  // hardcoded: the arena's authored row count is a chunks.js detail, and the
  // FLOOR_PAD repeat rows below it make an arithmetic guess easy to get wrong.
  const bossFloorY = wow ? 0 : (() => {
    const tx = Math.floor(level.bossTrigger / TILE);
    for (let ty = 0; ty < level.hTiles; ty++) if (level.solidAt(tx, ty)) return ty * TILE;
    return level.h;
  })();
  if (typeof window !== 'undefined' && window.__blast) window.__blast.P = P;  // live tuning hook

  // The boss's summon phase output. The boss emits defs; the scene decides what
  // actually lands — that split keeps boss.js free of any enemy-list knowledge.
  // Summoned minions go through enemies.spawnDef(), which makes them ordinary
  // roster members: hitTest/kill/contact-damage/sleep-gate all pick them up for
  // free. The only thing they do NOT get is revival (see enemies.reviveAll).
  function onSummon(defs) {
    let live = 0;
    enemies.forEach(e => { if (e.summoned) live++; });
    for (const d of defs) {
      if (live >= MINION_CAP) break;
      if (enemies.spawnDef(d)) {
        live++;
        fx.push({ x: d.x, y: d.y - 20, t: 0 });     // a puff so they don't just blink in
      }
    }
    if (!sawSummon) {
      sawSummon = true;
      // Parked well left of the boss for the same reason the reveal popup is:
      // during summon the boss sits at its hover home near the arena's right
      // wall, and text anchored there runs off the edge into the score HUD.
      popups.spawn(boss.x - 200, boss.y + 60, 'very minions.');
    }
  }

  // Everything that happens the moment the boss's last hp point lands. Shared
  // by the bolt-kill path and the ?test cheat so the two can never drift.
  function bossDeath() {
    cam.shake(10, 0.4);
    hitstop = Math.max(hitstop, 0.09);
    sfx?.play('bossdown');                              // in HERE so the ?test cheat sounds too
    score.add('boss');                                  // flat +500, not a roster kill
    bossKilled = true;                                  // ...but it still counts in the tally,
                                                         // permanently — refundKills never touches it
    for (const [tx, ty] of level.gate) level.carve(tx, ty);
    // Popup at the gate, not at the corpse: it points at what just changed.
    // gate.at(-1) — the BOTTOM tile of the wall (parseChunk records row-major,
    // so gate[0] is the top of a 14-row wall, ~200px above the fight and off
    // the top of the screen). The 140px left offset is the same trick the boss
    // reveal popup uses: from the kill position the camera is still short of
    // the arena's right edge, and text parked at the gate column runs off into
    // the score HUD.
    const [gx, gy] = level.gate.at(-1);
    popups.spawn(gx * TILE + 8 - 140, gy * TILE - 12, 'gate very open.');
    for (const [dx, dy, stagger] of [[0, 0, 0], [-50, 30, 0.15], [40, -20, 0.3]])
      fx.push({ x: boss.x + dx, y: boss.y + dy, t: -stagger });
  }

  // RE-ENTRY SAFETY / checkpoint trace. bossSpawned latches true at the trigger
  // and is never cleared, so neither the boss's death nor the player's can arm a
  // second saucer inside one scene (R-restart rebuilds the whole scene, which is
  // the only intended reset). The one scary case is a real death DURING the
  // fight: respawn() teleports to player.checkpoint, and C9's checkpoint sits at
  // tx1394 — BEYOND the gate at tx1390/1391 — so respawning there would drop the
  // player past a sealed gate with the boss still alive behind them.
  // It cannot happen: player.js only captures a checkpoint on TOUCH
  // (|dx| < 12 && |dy| < 24 against the marker), and the gate wall is solid
  // across EVERY row above the floor until bossDeath() carves it. The
  // player physically cannot reach tx1394 before the boss dies, so the live
  // checkpoint throughout the fight is the LAST pre-arena one, E20's at tx1250
  // — a mid-fight death walks you back through E21's breather and into the
  // arena again, with the same boss.
  // (checkpoint columns after the E1-E21 expansion: 98, 194, 290, 386, 530,
  //  674, 818, 962, 1106, 1250, 1394.)

  // --- test-only cheats. Gated on ?test so a normal player never sees them.
  // has('test'), not search.includes('test'): the loose form armed cheats for any
  // URL that merely CONTAINS the substring (?contest=1, #latest, a path segment).
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('test') &&
      typeof window !== 'undefined' && window.__blast) {
    window.__blast.cheat = {
      // The afk clock's real thresholds are 2 and 5 MINUTES, which no e2e can sit
      // through. This winds it forward directly so a spec can assert the
      // countdown and the death itself in a couple of seconds.
      idle(seconds) { idleT = seconds; },
      warp(x) {
        player.body.x = x;
        player.checkpoint = { x, y: player.body.y };
      },
      killBoss() {
        if (!boss || !boss.on) return;
        while (boss.on) if (boss.hurt()) bossDeath();
      },
      // Freeze the world exactly the way a kill does, for as long as the caller
      // wants. The real thing lasts 3 frames, which is too short to place a
      // keystroke inside from outside the page — this makes the window wide
      // enough for an e2e to tap a key squarely in the middle of it.
      stall(seconds) { hitstop = Math.max(hitstop, seconds); },
      // Drops the body straight through the level floor, which is what a pit
      // does. Used by the wow e2e to exercise the REAL pit path (level.endless
      // in player.js) rather than poking hp from outside it.
      pit() {
        player.body.y = level.h + 200;
        player.body.vy = 0;
      },
      warpPad() {
        player.body.x = level.shipPad.x - 40;
        player.body.y = level.shipPad.y;
        player.body.vx = 0; player.body.vy = 0;
        player.checkpoint = { x: player.body.x, y: player.body.y };
      },
    };
  }

  // Draw a full parallax cell with its top-left at (sx, sy). The atlas trims
  // transparent margins, so we go through drawCentered with the cell centre —
  // that re-applies the frame's ox/oy and lands the art where it was authored.
  const gateIsOpen = () => level.gate.every(([tx, ty]) => !level.solidAt(tx, ty));

  // Ship extraction cutscene. The world is FROZEN for its duration — no player
  // update, no enemies, no bolts — so the only things that move are the ship,
  // its rider, the thrust puffs and the camera.
  function updateTakeoff(dt) {
    takeoff += dt;
    liftY += 120 * dt;
    thrustT += dt;
    while (thrustT >= 0.25) {
      thrustT -= 0.25;
      fx.push({ x: level.shipPad.x + thrustSide * 40, y: level.shipPad.y - liftY + 20, t: 0 });
      thrustSide = -thrustSide;
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      fx[i].t += dt;
      if (animDone(atlas.anims.explode, fx[i].t)) fx.splice(i, 1);
    }
    popups.update(dt);
    cam.follow(level.shipPad.x, level.shipPad.y - liftY, 0, dt, level);
    if (takeoff >= 2.5) go('win', breakdown());
  }

  // The wow run's tally. Deliberately NOT breakdown(): a wow run has no time
  // bonus (there is no finish line to be fast to — you die when you die, and a
  // long run is a GOOD run), no deaths column (there is exactly one), and it
  // carries the seed and chunk count instead.
  function wowBreakdown() {
    return {
      score: score.value(),
      kills: killCredited + (bossKilled ? 1 : 0),
      coins: coins.total() - coins.remaining(),
      timeS: Math.floor(timeS),
      chunks: maxChunk,
      seed,
    };
  }

  // The gauntlet run's final tally. timeBonus is added to the score exactly
  // ONCE, here — score.value() never learns about it, so calling breakdown()
  // twice is safe.
  function breakdown() {
    const t = Math.floor(timeS);
    // Retuned for the 31-chunk campaign: a bigger pot that decays twice as fast,
    // so a brisk full run still banks thousands while a 5-minute stroll zeroes out.
    const timeBonus = Math.max(0, 6000 - t * 20);
    return {
      kills: killCredited + (bossKilled ? 1 : 0),
      coins: coins.total() - coins.remaining(),
      deaths: player.deaths,
      timeS: t,
      timeBonus,
      score: score.value() + timeBonus,
    };
  }

  // One tick of the idle clock. Reads the resolved action set rather than
  // hooking the keydown handler: that way a gamepad stick and the e2e's virtual
  // tape count as presence too, and a key HELD across many frames keeps the
  // clock at zero instead of only resetting it on the press edge.
  function idleTick(dt) {
    const act = input.actions();
    // touched(), not the held value: a key tapped and released between two
    // frames is still somebody being there.
    for (const k in act) if (act[k] || input.touched(k)) { idleT = 0; return; }
    idleT += dt;
    if (idleT >= AFK_OUT && outT < 0) afkOut();
  }

  // The fuse lands. Hearts do not enter into it — this is not damage, it is the
  // run being taken away, so hp goes to zero in one step whatever it held.
  //
  // The death jingle, the shake and the popup are raised HERE rather than left
  // to the hp-edge watcher in update(): that watcher sits below the pause bail,
  // and this can fire while the game is paused. prevState/prevHp are moved to
  // the post-death values in the same breath so the watcher cannot sound a
  // second 'ded' on the next unpaused frame.
  function afkOut() {
    outT = 0;
    player.hp = 0;
    player.iframes = 0;
    player.setState('ded');
    prevHp = 0; prevState = 'ded';
    popups.spawn(player.body.x, player.body.y - 20, 'rekt');
    sfx?.play('ded');
    cam.shake(8, 0.3);
  }

  // A 26px two-tone slate disc with a handful of white glints, dithered on a
  // checker so it reads as a sphere at this size without any shading maths.
  // Built ONCE into its own canvas: as loose fillRects it is ~530 draw calls a
  // frame for a thing that never changes.
  function decoOrb() {
    if (deco || typeof document === 'undefined') return deco;
    const R = 13, c = document.createElement('canvas');
    c.width = c.height = R * 2;
    const g = c.getContext('2d');
    for (let y = -R; y < R; y++) {
      for (let x = -R; x < R; x++) {
        if (x * x + y * y > R * R) continue;
        g.fillStyle = ((x + y) & 1) ? '#2c4370' : '#243a63';
        g.fillRect(x + R, y + R, 1, 1);
      }
    }
    for (const [gx, gy] of [[8, 5], [15, 4], [6, 9], [17, 11], [11, 16], [19, 8]]) {
      g.fillStyle = '#ffffff'; g.fillRect(gx, gy, 1, 1);
    }
    deco = c;
    return deco;
  }

  // The disc plus four thin beams that sweep around it. The beams are the one
  // stroked path in the whole render — at 12% alpha on a 1px line the softness
  // is the effect rather than a defect, and a rect-stepped ray at an arbitrary
  // angle would stair-step visibly.
  function drawDeco1(ctx, cx, cy) {
    const c = decoOrb();
    if (c) ctx.drawImage(c, Math.round(cx - 13), Math.round(cy - 13));
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#b2d9ff';
    ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const a = ambT * 0.25 + k * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11);
      ctx.lineTo(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Slow motes falling across the frame. Every mote's whole trajectory is a
  // function of its index and the clock — no array, no spawn bookkeeping, and
  // the same 24 specks every session.
  const DECO_COL = ['#982c2c', '#eec548', '#ffa900'];
  function drawDeco2(ctx) {
    for (let i = 0; i < 24; i++) {
      const sp = 16 + (i % 5) * 5;
      const y = wrap(i * 71 + ambT * sp, VH + 16) - 8;
      const x = wrap(i * 173 + Math.sin(ambT * 0.5 + i * 1.7) * 14, VW);
      ctx.fillStyle = DECO_COL[i % 3];
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  }

  function drawLayer(ctx, name, sx, sy) {
    const a = atlas.anims[name];
    atlas.drawCentered(ctx, name, a.frames[0], sx + a.cw / 2, sy + a.ch / 2);
  }

  // --- single props -----------------------------------------------------------
  // The parallax strips TILE: they are 640 wide and the render wraps them, so
  // anything drawn into one exists again every 640px of layer travel. A prop
  // that is supposed to be a landmark — one of it, in one place — therefore
  // cannot live in the strip. It gets its own draw here instead: one call, at a
  // fixed coordinate in the LAYER's own space, with the band's parallax factor
  // applied exactly the way band() applies it. So it drifts with its band and
  // hides behind it, but there is only ever the one.
  //
  // Coordinates are layer-space (world x * the band's factor), and each was
  // picked by scrolling to it: PROPS[0] rides the far mesas and comes up around
  // the middle of the run, PROPS[1] rides the nearer rocks out where the level
  // stops being polite. The y is the same offset inside the band each one had
  // when it was painted into the strip, so the composition — how much of it the
  // rock swallows — is unchanged.
  const PROPS = [
    { name: 'prop1', x: 2900, fx: 0.30, fy: 0.12, bias: 4,  bh: 120, y: 7 },
    { name: 'prop2', x: 9700, fx: 0.60, fy: 0.20, bias: 10, bh: 80,  y: 56 },
  ];

  function drawProp(ctx, p, drift) {
    const sx = Math.round(p.x - cam.x * p.fx);
    if (sx > VW || sx + atlas.anims[p.name].cw < 0) return;   // off-screen: skip
    drawLayer(ctx, p.name, sx, restLine + p.bias - p.bh + drift(p.fy) + p.y);
  }

  return {
    update(dt) {
      ambT += dt;
      // The idle clock runs FIRST, above every bail below it — pause, hitstop
      // and the retry check included. See the AFK_* block up top for why.
      if (takeoff < 0) idleTick(dt);
      if (outT >= 0) {
        outT += dt;
        // Same beat the wow run-end uses: cut while the corpse is still on its
        // last frame. In wow that is the normal run-end screen (the best score
        // banks in main.js exactly as it would after any other death); in the
        // gauntlet there is no end screen to go to, so the whole board starts
        // over from nothing — score, deaths and carved gate alike.
        if (outT >= DED_OUT) { go(wow ? 'wowend' : 'play', wow ? wowBreakdown() : { mode, seed }); return; }
      }
      // retry wins over everything, takeoff included: a deliberate choice —
      // R during the extraction cutscene restarts the run rather than making
      // the player sit out 2.5s of ship they've already earned.
      if (input.pressed('retry')) { go('play', { mode, seed }); return; }
      // Mute is checked BEFORE the pause bail: silencing the game while it's
      // paused is exactly when you want to reach for it.
      // One switch for both engines — main.js owns it (see toggleMute there).
      if (input.pressed('mute')) toggleMute?.();
      if (input.pressed('pause')) { paused = !paused; jukebox?.setDuck(paused); }
      if (paused) return;                                // freeze EVERYTHING, clock included
      if (takeoff >= 0) { updateTakeoff(dt); return; }   // world frozen: input ignored
      // Brief world stall — render still runs. The player's hands do NOT stall
      // with it, and player.update reads `fire` as a HELD state, so every frame
      // this bail skips is a frame that never sees the key. Traced on the real
      // keyboard path (X tapped ~30ms, 130ms apart, down a slide chain over
      // hoppers): six taps, five bolts. The missing one is the burst the player
      // swears they pressed.
      //
      // TWO ways a stall eats a tap, and the fix has to survive both:
      //   1. the tap starts AND ends inside the freeze — no live frame ever
      //      sees `fire` true at all;
      //   2. the tap outlives the freeze, but fireCd DIDN'T tick while frozen
      //      (player.update is what decays it), so the barrel is still hot on
      //      the first live frame and the shot is dropped there instead.
      // So the stall doesn't latch for one frame, it latches for a SHORT FUSE
      // (>= the 0.12s cooldown it just froze) and the fuse is cleared the moment
      // a bolt actually leaves. Pause is the one bail that still eats input,
      // deliberately.
      if (hitstop > 0) {
        hitstop -= dt;
        // pressed(), not held: only a press EDGE that the freeze is about to
        // eat gets latched. A key still down from the shot that CAUSED the
        // stall has no edge here, so the kill you just made can't hand you a
        // free extra bolt on the way out of its own hitstop.
        if (input.pressed('fire')) stallFire = STALL_FIRE_T;
        return;
      }
      timeS += dt;
      const wasAirborne = player.coyote === 0;
      gunDownT = Math.max(0, gunDownT - dt);
      // Make-good for anything the stall ate. The override is spread ON TOP of
      // the live set, so a key that is genuinely still down is unaffected, and
      // nothing here can set the fuse — only a frozen frame does — so an
      // ordinary tap on a hot barrel behaves exactly as it always has.
      stallFire = Math.max(0, stallFire - dt);
      const acts = stallFire > 0 ? { ...input.actions(), fire: true } : input.actions();
      const shotsBefore = playerBolts.fired();
      player.update(dt, acts, level, playerBolts);
      if (playerBolts.fired() !== shotsBefore) stallFire = 0;   // the tap landed
      // Every respawn revives the roster and refunds every point a kill has
      // earned since the last one — soft (pit heart-loss) AND real death
      // alike. Tracked off the DEATHS COUNTER edge, not the 'ded' state edge:
      // a soft pit respawn never touches 'ded' at all (player.js hands off to
      // 'ded' only when the pit takes the LAST heart), so watching the state
      // edge would miss it entirely. player.js guarantees exactly one
      // deaths++ per respawn (soft pit: immediate; real death: the ded
      // block's corpse-timer/pit-out path), so this fires once per respawn,
      // never double-fires, and needs no `!wow` guard of its own — an
      // endless (wow) level never increments player.deaths (see
      // player.js's `level.endless` branches), so a wow death can never
      // reach here; it resolves through dedT/wowend below instead, and the
      // scene is discarded either way. Summoned boss minions get swept out
      // by reviveAll() too — a mid-fight pit dunk clears them, by design.
      if (player.deaths !== prevDeaths) {
        prevDeaths = player.deaths;
        score.refundKills();
        killCredited = 0;
        enemies.reviveAll();
      }
      // A muzzle still at t === 0 after the update is one fired THIS frame;
      // dy marks it as the down-shot (hop, boost or the pinned variant).
      if (player.muzzle && player.muzzle.dy && player.muzzle.t === 0) gunDownT = GUN_DOWN_T;
      // SFX are derived HERE, not raised by the player: player.js is engine-pure
      // and importing an audio module into it would put a browser dependency in
      // the middle of the sim (and in every offline physics harness). The scene
      // already watches the same edges for the camera and the gun-down pose, so
      // reading the fresh muzzle for a fourth reason costs nothing.
      //
      // The muzzle carries enough to tell the four fire paths apart exactly:
      //   dy === 1, was on the ground → hop
      //   dy === 1, was in the air    → boost (the air-charge burn)
      //   dy === 0, dx opposes facing → burst (the slide chord fires BACKWARD)
      //   dy === 0, dx  along facing  → pew
      // wasAirborne is sampled BEFORE player.update() on purpose: the hop zeroes
      // coyote as it fires, so a post-update read would call every hop a boost.
      if (player.muzzle && player.muzzle.t === 0) {
        const m = player.muzzle;
        sfx?.play(m.dy ? (wasAirborne ? 'boost' : 'hop')
                       : m.dx === -player.facing ? 'burst' : 'pew');
      }
      // contact gate: hurt() owns damage authority via iframes; the dummy body
      // is a perf skip so overlapping-frame AABB checks stop during the stagger.
      enemies.update(dt, player.iframes > 0 ? { x: player.body.x, y: -9999, w: 0 } : player.body,
                     enemyBolts, fromX => player.hurt(fromX));
      playerBolts.update(dt, level);
      enemyBolts.update(dt, level);

      // Boss trigger: crossing 8 tiles into C8 arms the fight, once and forever.
      if (!wow && !bossSpawned && player.body.x > level.bossTrigger) {
        bossSpawned = true;
        boss = makeBoss(level.bossTrigger + 200, bossFloorY);
        // Offset left/low of the boss center on purpose: at the trigger the camera
        // is still 300px short of the arena's right side, and a popup parked at
        // boss.x ran off the screen edge into the score HUD.
        popups.spawn(boss.x - 130, boss.y - 70, 'MEGA SAUCER. very rude.');
      }
      if (boss && boss.on) {
        // The scene owns the ANIM clock: boss.t is time-in-PHASE and resets on
        // every phase change, so driving the 2f loop off it would stutter.
        bossAnimT += dt;
        boss.update(dt, player.iframes > 0 ? { x: player.body.x, y: -9999, w: 0 } : player.body,
                    enemyBolts, fromX => player.hurt(fromX), onSummon);
      }
      for (let i = fx.length - 1; i >= 0; i--) {
        fx[i].t += dt;
        if (animDone(atlas.anims.explode, fx[i].t)) fx.splice(i, 1);
      }

      playerBolts.forEachHittable(b => {
        if (boss && boss.on && boss.hitTest(b)) {
          playerBolts.kill(b);
          sfx?.play('bosshit');
          if (boss.hurt()) bossDeath();     // bossdown rings from inside bossDeath
          return;
        }
        const e = enemies.hitTest(b);
        if (!e) return;
        playerBolts.kill(b);
        if (--e.hp > 0) return;
        enemies.kill(e, dead => {
          // Minions get their OWN pop rather than a layered one: a boss summon
          // dying and a roster grunt dying must be tellable apart by ear during
          // the fight, and two overlapping zaps just read as one muddy zap.
          sfx?.play(e.summoned ? 'minionpop' : 'killpop');
          const airborne = player.coyote === 0;
          score.onKill(airborne);
          killCredited++;
          player.airCharges = P.AIR_CHARGES;            // kills refill the tank
          popups.spawn(dead.x, dead.y - 30, '+100');
          cam.shake(5, 0.2);
          hitstop = Math.max(hitstop, 0.05);
        });
      });

      enemyBolts.forEachHittable(b => {
        const pb = player.body;
        if (Math.abs(b.x - pb.x) < pb.w / 2 + 4 && b.y > pb.y - pb.h && b.y < pb.y) {
          enemyBolts.kill(b);
          player.hurt(b.x);
        }
      });

      coins.update(dt, player.body, c => {
        sfx?.play('coin'); score.add('coin'); popups.spawn(c.x, c.y, '+10');
      });

      if (wasAirborne && player.coyote > 0) { score.onLand(); flightWows = 0; }
      const evs = score.takeEvents();
      if (evs.length) {
        flightWows = Math.min(flightWows + evs.length, 3);
        popups.spawn(player.body.x, player.body.y - 60, 'WOW' + '+'.repeat(flightWows));
      }
      popups.update(dt);

      cam.follow(player.body.x, player.body.y, player.facing, dt, level);
      // Damage is read off the hp EDGE rather than hooked into player.hurt(),
      // so contact damage, enemy bolts and boss bolts all sound the same with
      // one call site. A hit that kills is silent here — the death jingle below
      // owns that frame.
      if (player.hp < prevHp && player.state !== 'ded') {
        sfx?.play('hurt'); cam.shake(3, 0.15); hitstop = Math.max(hitstop, 0.03);
      }
      // real death: on top of the roster/ledger reset the deaths-counter edge
      // above already applies, a real death pays a flat 100 wow — and, since
      // dock() no longer floors, that can push the score negative if little
      // was banked. Coins stay collected either way.
      if (player.state === 'ded' && prevState !== 'ded') {
        sfx?.play('ded');
        cam.shake(8, 0.3);
        // Only the gauntlet has a run left to charge a fee on. In wow this
        // death IS the run: docking 100 wow off the final tally would be
        // charging a fee on the way out the door.
        if (!wow) score.dock(100);
      }
      prevHp = player.hp; prevState = player.state;
      if (wow) {
        // chunkIndex is where you ARE (the HUD counter, which may go down if
        // you walk back left); maxChunk is the high-water mark the run-end
        // screen reports, so backtracking can never un-earn a chunk.
        chunkIndex = Math.max(0, Math.min(WOW_LEN,
          Math.floor(player.body.x / (CHUNK_W * TILE))));
        maxChunk = Math.max(maxChunk, chunkIndex);
        // Run over. The corpse beat is watched HERE rather than hooked off
        // player.js's respawn timer because in an endless level player.js has
        // no respawn to fire (level.endless) — the scene owns the ending.
        // DED_OUT is a touch under the 1.5s corpse anim so the cut lands while
        // the body is still on its last frame, not after it starts idling.
        if (player.state === 'ded') dedT += dt;
        if (dedT >= DED_OUT) { go('wowend', wowBreakdown()); return; }
      }
      // Extraction: stand on the pad with the gate carved open and the ship goes.
      if (!wow && takeoff < 0 && gateIsOpen() && player.coyote > 0 &&
          Math.abs(player.body.x - level.shipPad.x) < 24) {
        takeoff = 0;
        jukebox?.stopMusic();
        jukebox?.playOneShot('fanfare');   // fanfare rings through the takeoff into the win screen
      }
    },

    render(ctx) {
      // (1) parallax — screen space, drawn BEFORE cam.apply. Every offset is
      // rounded so the bands land on whole pixels and never shimmer against the
      // tiles. Vertical factors are deliberately far gentler than horizontal
      // ones: the horizon should breathe when you fly, not swing.
      const drift = f => -Math.round((cam.y - camY0) * f);
      // each band is authored 640 wide, so it is drawn twice to cover the seam
      const band = (name, fx, fy, bias) => {
        const a = atlas.anims[name];
        const ox = -Math.round(wrap(cam.x * fx, VW));
        const oy = restLine + bias - a.ch + drift(fy);   // cell BOTTOM sits `bias` below the horizon
        drawLayer(ctx, name, ox, oy);
        drawLayer(ctx, name, ox + VW, oy);
      };
      const sox = -Math.round(wrap(cam.x * 0.10, VW));
      drawLayer(ctx, 'par_stars', sox, drift(0.05));      // sky: pinned to the top
      drawLayer(ctx, 'par_stars', sox + VW, drift(0.05));
      // Hangs in the same far sky as the stars, on the same slow factors, so it
      // sits behind every band that follows and drifts with them.
      if (xOn?.()) { drawDeco1(ctx, sox + 96, 52 + drift(0.05));
                     drawDeco1(ctx, sox + VW + 96, 52 + drift(0.05)); }
      // Props go down BEFORE their band, so the band occludes them the same way
      // the strip art did when they were painted underneath it.
      drawProp(ctx, PROPS[0], drift);
      band('par_mesas', 0.30, 0.12, 4);
      // far-ground haze under the near band: with the camera riding high the
      // real floor drops away faster than the parallax does, and without this
      // you get a strip of starfield wedged between the rocks and the ground.
      const rocksBottom = restLine + 10 + drift(0.20);
      ctx.fillStyle = '#2a1c33';
      ctx.fillRect(0, rocksBottom - 20, VW, VH - rocksBottom + 20);
      drawProp(ctx, PROPS[1], drift);
      band('par_rocks', 0.60, 0.20, 10);

      ctx.save(); cam.apply(ctx);

      // (2) tiles, culled to the visible window. Frame 0 = sunlit surface (no
      // solid directly above), frame 1 = fill. Edge frames 2/3 stay unused.
      const tx0 = Math.max(0, Math.floor(cam.x / TILE));
      const tx1 = Math.min(level.wTiles - 1, Math.floor((cam.x + VW) / TILE));
      const ty0 = Math.max(0, Math.floor(cam.y / TILE));
      const ty1 = Math.min(level.hTiles - 1, Math.floor((cam.y + VH) / TILE));
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          if (!level.solidAt(tx, ty)) continue;
          const f = level.solidAt(tx, ty - 1) ? 1 : 0;
          atlas.drawCentered(ctx, 'tiles', atlas.anims.tiles.frames[f],
                             tx * TILE + 8, ty * TILE + 8);
        }

      // (2b) floor depth bands: the walked floor is FLOOR_PAD repeat rows of
      // the same flat tile (chunks.js), which reads as a dead purple slab
      // rather than ground receding into shadow. Three stepped darkening
      // bands over the tile texture (world coords, drawn OVER the tiles we
      // just placed) fake depth without new art. floorLineWorldY is the same
      // horizon restLine anchors to, just left in world space (no camY0
      // subtraction) since we're inside cam.apply here.
      const floorLineWorldY = level.h - 8 * TILE;
      const bandX0 = cam.x, bandX1 = cam.x + VW;
      const bandStops = [floorLineWorldY + 2 * TILE, floorLineWorldY + 5 * TILE,
                          floorLineWorldY + 8 * TILE, level.h];
      const bandAlphas = [0.15, 0.3, 0.45];
      for (let i = 0; i < bandAlphas.length; i++) {
        ctx.fillStyle = `rgba(0,0,0,${bandAlphas[i]})`;
        ctx.fillRect(bandX0, bandStops[i], bandX1 - bandX0, bandStops[i + 1] - bandStops[i]);
      }

      // (3) signs: a post carrying a board sized to its own text. The dark
      // board matters — these read over tiles and over sky depending on where
      // the chunk put them, and bare green text loses against the rock.
      // Text is authored lowercase (doge voice) but the font is caps-only, so
      // it's upshifted at draw — the glyphs fold caps anyway, this just keeps
      // measure() and drawText() looking at the same string.
      for (const sg of level.signs) {
        const upper = sg.text.toUpperCase();
        const bw = Math.round(measure(upper)) + 8;
        ctx.fillStyle = '#5b4a3a'; ctx.fillRect(sg.x - 2, sg.y - 20, 4, 20);      // post
        ctx.fillStyle = '#1b1420'; ctx.fillRect(sg.x - bw / 2, sg.y - 32, bw, 13); // board
        ctx.fillStyle = '#8a7358'; ctx.fillRect(sg.x - bw / 2, sg.y - 32, bw, 1);  // lit top edge
        ctx.fillStyle = '#8fa'; drawText(ctx, upper, sg.x, sg.y - 29, { align: 'center' });
      }

      // (4) checkpoints
      for (const c of level.checkpoints) {
        ctx.fillStyle = '#186'; ctx.fillRect(c.x - 2, c.y - 26, 4, 26);
        ctx.fillStyle = '#2c8'; ctx.fillRect(c.x + 2, c.y - 26, 10, 7);
      }

      // (5) coins — culled to the camera window ±VW. There are 151 coins on the
      // 31-chunk level and drawCentered is not free; only the ones anywhere near
      // the viewport are worth a draw call.
      const coinX0 = cam.x - VW, coinX1 = cam.x + 2 * VW;
      coins.forEach(c => {
        if (c.x < coinX0 || c.x > coinX1) return;
        atlas.drawCentered(ctx, 'coin', animFrame(atlas.anims.coin, c.t), c.x, c.y);
      });

      // (6) enemies
      enemies.forEach(e => atlas.drawFeet(ctx, e.anim,
        animFrame(atlas.anims[e.anim], e.t), e.x, e.y, e.vx < 0));

      // (6b) MEGA SAUCER — the 64px enemyfly_red cell blown up 3x to arena scale,
      // plus a floating hp bar. Both hang off boss.x/boss.y (the CENTER anchor).
      if (boss && boss.on) {
        ctx.save();
        ctx.translate(boss.x, boss.y);
        ctx.scale(3, 3);
        atlas.drawCentered(ctx, 'enemyfly_red',
                           animFrame(atlas.anims.enemyfly_red, bossAnimT), 0, 0);
        ctx.restore();
        // 80px above center, not the spec's 110: the 3x cell is 192px tall but the
        // art inside it only reaches ~62px above center, and at 110 the bar floated
        // in dead space AND clipped the top of the viewport against the HUD.
        const bw = 48, bx = Math.round(boss.x - bw / 2), by = Math.round(boss.y - 80);
        ctx.fillStyle = '#1b1420'; ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
        ctx.fillStyle = '#e2413f'; ctx.fillRect(bx, by, Math.round(bw * (boss.hp / boss.hpMax)), 4);
      }

      // (6c) death FX: explode puffs. Negative t = still waiting out its stagger.
      for (const f of fx) {
        if (f.t < 0) continue;
        atlas.drawCentered(ctx, 'explode', animFrame(atlas.anims.explode, f.t), f.x, f.y);
      }

      // (6d) the ship. Always drawn on its pad — before the gate opens it is
      // simply hundreds of tiles off to the right, so no gating is needed.
      // No ship in wow — there is no extraction to earn, and level.shipPad is
      // null because no wow chunk carries a 'T'.
      if (level.shipPad)
        atlas.drawFeet(ctx, 'ship', takeoff >= 0 ? animFrame(atlas.anims.ship, takeoff)
                                                 : atlas.anims.ship.frames[0],
                       level.shipPad.x, level.shipPad.y - liftY);

      // (7) player — blink through iframes, but a corpse always stays visible.
      // NO separate rider during takeoff: the 'ship' art already carries a dog
      // in the canopy, so drawing the player on top of it (tried at
      // shipPad.y - liftY - 8, per the original spec) rendered a second doge
      // floating through the fuselage. Once the ship lifts, the pilot in the
      // canopy IS the player.
      const flicker = player.iframes > 0 && player.state !== 'ded' &&
                      Math.floor(player.iframes * 12) % 2;
      if (!flicker && takeoff < 0) {
        // gundown wins over the state's own anim for GUN_DOWN_T after a
        // down-shot — but never over the two poses that ARE the story of the
        // frame (staggered, dead), which would otherwise be silently replaced.
        const posed = gunDownT > 0 && player.state !== 'ded' &&
                      player.state !== 'hit' && player.state !== 'spawn';
        const anim = posed ? 'gundown' : ANIM_FOR[player.state];
        atlas.drawFeet(ctx, anim,
                       posed ? atlas.anims.gundown.frames[0]
                             : player.state === 'air' ? atlas.anims.duck.frames[AIR_FRAME]
                             : animFrame(atlas.anims[anim], player.stateT),
                       player.body.x, player.body.y, player.facing < 0);
      }

      // (7b) ROCKET BOOTS. The down-shot is the game's whole vertical verb, and
      // the player reads it as thrust coming out of the feet — so while the body
      // is actually rising we burn a scaled-up muzzle flame straight down under
      // the boots. This is pure FX: nothing about it touches physics or state.
      // The muzzle anim is NOT looped through here: it is a 3-frame IGNITION
      // (a 3px spark, a 10px ring, then the full burst-plus-streak), so
      // animFrame'ing it spends two thirds of every cycle drawing almost
      // nothing. A thruster wants the last frame held; the flicker comes from
      // pulsing the plume's length instead, which also keeps the bright core
      // welded to the boots rather than blinking out.
      // Rotated +PI/2 the burst's streak trails straight DOWN, which is what
      // sells it as exhaust rather than an upward shot. The scale is applied
      // OUTSIDE drawCentered's own rotate, so it acts on world axes: x fattens
      // the plume, y shortens the (very long, very thin) bolt streak into a
      // cone. Uniform scaling here drew a 40px laser line down to the floor.
      if (takeoff < 0 && player.state !== 'ded' && player.body.vy < -40) {
        const burst = atlas.anims.blast_muzzle.frames[2];
        const pulse = 0.62 + 0.12 * (Math.floor(player.stateT * 24) % 2);
        ctx.save();
        ctx.translate(Math.round(player.body.x), Math.round(player.body.y + 6));
        ctx.scale(2.6, pulse);
        atlas.drawCentered(ctx, 'blast_muzzle', burst, 0, 0, Math.PI / 2);
        ctx.restore();
      }

      // (8) muzzle flash at the recorded shot origin (mirrored for leftward
      // shots). DOWN-shots are skipped: their recorded origin sits 6px above the
      // feet, right on top of the boot flame above, and the two stacked flames
      // read as one fat smear rather than a thruster. The boots own that beat now.
      if (player.muzzle && !player.muzzle.dy) {
        const m = player.muzzle;
        ctx.save();
        if (m.dx < 0) { ctx.translate(m.x, m.y); ctx.scale(-1, 1); ctx.translate(-m.x, -m.y); }
        atlas.drawCentered(ctx, 'blast_muzzle',
          animFrame(atlas.anims.blast_muzzle, m.t), m.x, m.y, 0);
        ctx.restore();
      }

      // (9) bolts, both factions
      playerBolts.render(ctx, atlas);
      enemyBolts.render(ctx, atlas);

      // (10) popups ride in world space so they stick to what scored them
      popups.render(ctx);

      ctx.restore();

      if (xOn?.()) drawDeco2(ctx);

      // (11) HUD
      for (let i = 0; i < P.HP_MAX; i++)
        atlas.drawCentered(ctx, 'heart', atlas.anims.heart.frames[i < player.hp ? 0 : 1],
                           10 + i * 12 + 5, 10 + 5);
      for (let i = 0; i < P.AIR_CHARGES; i++)
        atlas.drawCentered(ctx, 'pip', atlas.anims.pip.frames[i < player.airCharges ? 0 : 1],
                           10 + i * 10 + 4, 24 + 6);
      ctx.fillStyle = '#eec548';
      // 608, not 630: the shell layer's sound button occupies x 615..637 at the
      // top-right corner (see main.js), and at 630 the score ran straight under
      // the speaker glyph. Caught in the branding pass's visual check.
      // y is now the TOP of the 14px-tall text box (scale 2), not a baseline.
      drawText(ctx, `wow ${score.value()}`, 608, 8, { scale: 2, align: 'right' });
      // Wow's progress readout, under the score. The gauntlet has signs, a boss
      // and a ship to tell you where you are; wow is 40 anonymous chunks, so the
      // counter IS the sense of progress.
      if (wow) {
        ctx.fillStyle = '#8fa';
        drawText(ctx, `CHUNK ${chunkIndex}/${WOW_LEN}`, 608, 26, { scale: 2, align: 'right' });
      }

      // (12) pause veil, over the HUD and everything else.
      if (paused) {
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, VW, VH);
        // Plate behind the text: a 55% dim alone isn't enough to keep 'such
        // pause.' legible over the player sprite and a lit sign board, which
        // is exactly where the camera tends to be when you hit Escape.
        ctx.fillStyle = 'rgba(11,11,18,.88)'; ctx.fillRect(160, 138, 320, 74);
        ctx.fillStyle = '#3a3350';
        ctx.fillRect(160, 138, 320, 1); ctx.fillRect(160, 211, 320, 1);   // top+bottom rule
        drawTextShadow(ctx, 'such pause.', VW / 2, 152, { align: 'center', scale: 4 },
                       '#eec548', '#2a1c33');
        ctx.fillStyle = '#8fa';
        drawText(ctx, 'Esc resume  ·  R restart', VW / 2, 190, { align: 'center', scale: 2 });
      }

      // (13) the afk countdown, drawn LAST — after the pause veil, on purpose.
      // The veil is 55% black over the whole frame, so anything drawn under it
      // would be the one warning in the game you can hide by pressing Escape.
      if (idleT >= AFK_WARN && outT < 0) {
        const left = Math.max(0, AFK_OUT - idleT);
        const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
        // Under half a minute the readout goes to the damage red and breathes,
        // ~1.4 Hz. The pulse is alpha rather than scale: a growing string on a
        // centred baseline shimmers against the pixel grid, and the point is to
        // catch a returning eye, not to redraw the layout every frame.
        const hot = left < 30;
        if (hot) ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(idleT * 4.4));
        const col = hot ? '#e2413f' : '#eec548';
        drawTextShadow(ctx, 'very afk.', VW / 2, 6, { align: 'center', scale: 2 },
                       col, '#2a1c33');
        drawTextShadow(ctx, `${mm}:${String(ss).padStart(2, '0')}`, VW / 2, 24,
                       { align: 'center', scale: 3 }, col, '#2a1c33');
        ctx.globalAlpha = 1;
      }
    },

    state: () => ({
      x: player.body.x, y: player.body.y, vx: player.body.vx, vy: player.body.vy,
      h: player.body.h,                       // pose/hitbox height: 44 stand, 32 duck, 24 slide
      pstate: player.state, charges: player.airCharges, deaths: player.deaths,
      hp: player.hp, iframes: player.iframes,
      paused, hitstop, bullets: playerBolts.count(), shots: playerBolts.fired(),
      score: score.value(), enemies: enemies.count(), coins: coins.remaining(),
      bossOn: !!(boss && boss.on), bossHp: boss ? boss.hp : -1, bossSpawned,
      // bossPhase is observability-only (headless fight probes assert that a
      // player actually LIVES to see spread/slam now that hp is 40).
      bossPhase: boss && boss.on ? boss.phase : null,
      minions: (() => { let n = 0; enemies.forEach(e => { if (e.summoned) n++; }); return n; })(),
      gateOpen: gateIsOpen(),
      timeS: Math.floor(timeS), killCount: killCredited + (bossKilled ? 1 : 0), takeoff: takeoff >= 0,
      mode, seed, chunkIndex, maxChunk,
      idleT, countdownOn: idleT >= AFK_WARN && outT < 0,
    }),
  };
}
