// The real play scene: GAUNTLET level + player + enemies + coins + score +
// parallax art + culled tile render + HUD.
//
// Render order is load-bearing and reads bottom-up:
//   parallax (screen space, OUTSIDE the camera) → tiles → signs → checkpoints
//   → coins → enemies → player → muzzle → bolts → popups → [restore] → HUD.
import { buildGauntlet, buildWowZone, WOW_LEN, CHUNK_W, TILE } from '../chunks.js';
import { pickTileFrame, floraIndexAt, hash2 } from '../tiles.js';
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

// Tutorial boards, translated into thumbs. Keyed by the authored keyboard
// string (chunks.js SIGN_TEXTS) and applied at the sign draw only while the
// touch UI is live — same doge voice, near the same length so every board
// still sits its post the same way.
const TOUCH_SIGNS = {
  'press X. very pew.':
    'tap FIRE side. very pew.',
  'hold DOWN + X. shoot ground. trust me bro.':
    'drag FIRE down. shoot ground. trust me bro.',
  'DOWN+X in air = boost. 3 pips. kills refill.':
    'drag FIRE down in air = boost. 3 pips. kills refill.',
  'DOWN+move = slide. wait a beat, THEN X = zoom zoom.':
    'drag down-forward = slide. wait a beat, THEN FIRE = zoom zoom.',
};

// One scene serves both modes. The split is deliberately narrow: WOW ZONE
// changes the LEVEL (seeded chunk order), the MUSIC pool, what a death means
// (run over, not respawn) and the HUD's progress readout. Everything else —
// the verb, the enemies, the scoring, the camera, the parallax — is the same
// game, which is the whole point of an endless mode built out of the campaign's
// own chunks. `mode` is the only branch key; `seed` is meaningless in gauntlet.
export function makePlay({ atlas, input, save, go, jukebox, sfx, toggleMute, xOn, touchUI,
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
  // --- area dressing ---------------------------------------------------------
  // The wow zone wears its own sky and tileset outright; the gauntlet swaps to
  // the boss sky across the arena via the dread blend below. All three skies
  // are full atlas cells (the swap mechanism the integration notes left open:
  // cells, not draw-time tints — a tint can't move the banding).
  const skyName = wow ? 'sky_wow' : 'par_stars';
  const tilesName = wow ? 'tiles_wow' : 'tiles';
  // Boss-arena dread, 0..1 off the CAMERA's x so it can't pop: ramps in over
  // the ~5 screens before the arena floor starts, holds 1 through the fight
  // (the camera physically can't pass gateX-VW/2 while the gate wall stands),
  // and ramps back out on the victory lap so the ship moment gets the sunset
  // back. Gauntlet-only — wow has no arena.
  const arenaX = wow ? 0 : level.bossTrigger - 8 * TILE;
  const gateX = wow ? 0 : level.gate[0][0] * TILE;
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const dread = wow ? () => 0
    : cx => clamp01((cx - (arenaX - 560)) / 360) *
            (1 - clamp01((cx - (gateX - 260)) / 300));
  // Day's-end progression (juice pass V1): 0 at the spawn, 1 at the ship pad.
  // Pure f(camera x) like dread above, so it can never pop and two machines on
  // the same frame agree. It drives ONLY render dressing (sun height + a warm
  // sky glaze below); the glaze is scaled by (1 - dread) so the two
  // progressions compose — dread owns the arena, the sunset owns the road.
  const runEnd = !wow && level.shipPad ? Math.max(1, level.shipPad.x) : 1;
  const sunset = wow ? () => 0 : cx => clamp01(cx / runEnd);
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
  let afkSec = -1;               // last countdown second an afktick sounded on
  // Free-running scene clock for the decorative bands below. Deliberately its
  // own accumulator rather than timeS: that one is the RUN clock and stops for
  // the pause and the extraction, and ambient motion that freezes with the
  // world reads as a stall rather than as atmosphere.
  let ambT = 0;
  let deco = null;                // lazily built once, see decoOrb()
  // --- tile render cache -----------------------------------------------------
  // The visible tile window only changes when the camera crosses a 16px tile
  // boundary, but the per-tile draw loop used to run all ~400 drawImage calls
  // every frame — the single largest block in the phone profile. The window
  // lives in a cache canvas and the whole pass is ONE blit; on a boundary
  // crossing the overlap is copied across (ping-pong pair — a canvas cannot
  // safely self-copy with overlap) and only the newly exposed cells are drawn,
  // so no frame ever pays for the full window twice. Sized for the worst-case
  // window (+1 tile each axis for the partial edges).
  let tileCanvas = null, tileScratch = null, tileWin = null;
  let voidGrad = null;            // pit-void gradient strip, baked on first render
  let haloCanvas = null;          // boss separation halo, baked on first use
  let tileEpoch = 0;              // bumped by the one thing that edits tiles: the gate carve
  // --- boss state ------------------------------------------------------------
  // bossSpawned is a ONE-WAY latch: it stays true through the boss's death AND
  // through a mid-fight real death, so the arena can never re-arm a second saucer.
  let boss = null, bossSpawned = false, bossAnimT = 0;
  // Summon phase bookkeeping. The cap is checked at SPAWN time against the live
  // summoned population, so a player who clears minions gets fresh ones on the
  // next cycle while a player who ignores them never faces more than MINION_CAP.
  let sawSummon = false;
  const fx = [];                          // explode puffs: { x, y, t } — t < 0 = staggered wait
  // --- juice particles (V2) --------------------------------------------------
  // Landing/slide dust and enemy-pop debris. PURE RENDER DRESSING: nothing in
  // here is ever read by the sim, and the randomness is a render-side
  // mulberry32 seeded off the spawn coordinate + a scene-local spawn counter —
  // never Math.random, never sim state, so two machines running the same tape
  // kick up the same dust. Fixed pool, ring-overwritten: the budget can never
  // grow, a burst frame just recycles the oldest speck.
  const PART_MAX = 64;
  const parts = Array.from({ length: PART_MAX },
    () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0, grav: 0, cols: null }));
  let partIdx = 0, partSpawns = 0;
  const mulberry32 = s => () => {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  // Exact palette entries (assets-wow/production/PALETTE.json): sandy floor
  // tones for dust, the enemies' dark-red-to-ember family for shards.
  const DUST_COLS = ['#b76028', '#cd611a', '#ea9f3a'];
  const DEBRIS_COLS = ['#4f1212', '#7d3118', '#e46016', '#94261d'];
  /** kind: dust drifts up and dies fast; debris pops out and falls. */
  function spawnParts(kind, x, y, n, kickX = 0) {
    const rnd = mulberry32(hash2(Math.round(x), Math.round(y)) ^ partSpawns++);
    for (let i = 0; i < n; i++) {
      const p = parts[partIdx]; partIdx = (partIdx + 1) % PART_MAX;
      p.on = true; p.t = 0;
      p.x = x + (rnd() - 0.5) * 14;
      p.y = y - rnd() * 4;
      if (kind === 0) {                    // dust puff
        p.vx = (rnd() - 0.5) * 46 + kickX;
        p.vy = -14 - rnd() * 26;
        p.grav = -30;                      // buoyant: it thins as it lifts
        p.life = 0.28 + rnd() * 0.16;
        p.cols = DUST_COLS;
      } else {                             // debris shard
        p.vx = (rnd() - 0.5) * 170;
        p.vy = -60 - rnd() * 120;
        p.grav = 520;
        p.life = 0.34 + rnd() * 0.2;
        p.cols = DEBRIS_COLS;
      }
    }
  }
  function tickParts(dt) {
    for (const p of parts) {
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.life) { p.on = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
    }
  }
  /** 3-frame life: 3px → 2px → 1px, fading over the last third. Culled. */
  function drawParts(ctx) {
    const px0 = cam.x - 8, px1 = cam.x + VW + 8;
    let dimmed = false;
    for (const p of parts) {
      if (!p.on || p.x < px0 || p.x > px1) continue;
      const ph = p.t / p.life;                       // 0..1 through its life
      const size = ph < 0.34 ? 3 : ph < 0.67 ? 2 : 1;
      if (ph >= 0.67 && !dimmed) { ctx.globalAlpha = 0.6; dimmed = true; }
      else if (ph < 0.67 && dimmed) { ctx.globalAlpha = 1; dimmed = false; }
      ctx.fillStyle = p.cols[(p.x * 7 + p.y * 3 & 0x7fffffff) % p.cols.length | 0];
      ctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
    }
    if (dimmed) ctx.globalAlpha = 1;
  }
  let slideDustT = 0;                     // slide-trail emitter metronome
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
    tileEpoch++;                                        // carved tiles: cached window is stale
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
      // Wind the free-running ambient clock (flyer schedule rides on it): the
      // scheduling windows are ~22s, which is real-time nobody sits through.
      amb(seconds) { ambT = seconds; },
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
    tickParts(dt);                 // leftover dust settles during the cutscene
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
    // Raw touch presence first: a finger inside the move deadzone (or a tap
    // still settling) emits no action for the loop below to see, but a thumb
    // on the glass answers "is anybody there" as surely as a held key.
    if (input.touchActive?.()) { idleT = 0; afkSec = -1; return; }
    const act = input.actions();
    // touched(), not the held value: a key tapped and released between two
    // frames is still somebody being there.
    for (const k in act) if (act[k] || input.touched(k)) { idleT = 0; afkSec = -1; return; }
    idleT += dt;
    // SFX v2: one dry tick per countdown second while the warning is up —
    // keyed off the same ceil the readout draws, so tick and digit agree.
    // Sits HERE (above the pause bail, like the clock itself) because the
    // countdown renders over the pause veil: what you can see, you can hear.
    // afkSec resets with the clock, so each incident starts its own count.
    if (idleT >= AFK_WARN && outT < 0) {
      const sec = Math.ceil(AFK_OUT - idleT);
      if (sec !== afkSec) { afkSec = sec; sfx?.play('afktick'); }
    }
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
  // Retuned for the sunset palette: the old red/gold specks vanished into a
  // world that is gold wall to wall. Pink / ice / warm white carry the disco.
  const DECO_COL = ['#ff5ad9', '#aee6ff', '#fffdf0'];
  function drawDeco2(ctx) {
    for (let i = 0; i < 24; i++) {
      const sp = 16 + (i % 5) * 5;
      const y = wrap(i * 71 + ambT * sp, VH + 16) - 8;
      const x = wrap(i * 173 + Math.sin(ambT * 0.5 + i * 1.7) * 14, VW);
      ctx.fillStyle = DECO_COL[i % 3];
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  }

  // Draw a full parallax cell with its top-left at (sx, sy). The atlas trims
  // transparent margins, so we go through drawCentered with the cell centre —
  // that re-applies the frame's ox/oy and lands the art where it was authored.
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
  // The production landmarks ride the same two bands. Placement had to adapt
  // to the new strips: the painted rock ridge is opaque nearly to its top
  // edge (the old one was sparse triangles), so anything drawn behind it
  // simply ceased to exist. Split by `front`:
  //   back  — behind its band, occluded by it (prop1 peeking over a mesa
  //           gap, the spire's tip over the far ridge);
  //   front — after its band, feet on the haze shelf between the rocks and
  //           the playfield (arch, wreck, and prop2 — which keeps its exact
  //           world x and in-band y offset; only the draw order moved, or
  //           the new opaque ridge would have swallowed it whole).
  const PROPS = [
    { name: 'prop_spire', x: 1504, fx: 0.30, fy: 0.12, bias: 4,  bh: 120, y: 46 },
    // prop1's anchor nudged a few strip px left onto a measured FLAT stretch
    // of the new skyline (opaque top edge at strip row 9 across its whole
    // footprint, measured programmatically) with its feet two px into the
    // crest — the old y left it hovering over a gap in the repainted ridge.
    { name: 'prop1',      x: 2858, fx: 0.30, fy: 0.12, bias: 4,  bh: 120, y: -17 },
    { name: 'prop_arch',  x: 4650, fx: 0.60, fy: 0.20, bias: 10, bh: 80,  y: 22, front: true },
    { name: 'prop_wreck', x: 6200, fx: 0.60, fy: 0.20, bias: 10, bh: 80,  y: 38, front: true },
    { name: 'prop2',      x: 9700, fx: 0.60, fy: 0.20, bias: 10, bh: 80,  y: 56, front: true },
  ];
  const MESA_PROPS = PROPS.filter(p => p.fx === 0.30);
  const ROCK_PROPS = PROPS.filter(p => p.fx === 0.60 && !p.front);
  const SHELF_PROPS = PROPS.filter(p => p.front);

  // LANDMARK-RARE (fix round, user request): the ancient-monument family —
  // half-buried statue head, weathered obelisk, megalithic gate, fossil
  // ribcage. Unlike the one-of-each PROPS above these repeat across the
  // whole run (gauntlet AND wow), but SPARSELY: a coordinate hash gates
  // roughly one 512px shelf strip in four, so one drifts past every few
  // screens. Pure function of the strip index — the same ruins every
  // session, per the determinism rule. All four are soft, clearly inanimate
  // silhouettes on the far shelf; they never overlap the playfield.
  const LANDMARKS = ['prop_head', 'prop_obelisk', 'prop_mgate', 'prop_ribs'];

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
      // Juice particles (V2): tick the pool, breathe the slide trail. Render
      // dressing only — see the pool block up top.
      tickParts(dt);
      if (player.state === 'slide' && player.coyote > 0) {
        slideDustT += dt;
        while (slideDustT >= 0.06) {
          slideDustT -= 0.06;
          // Heel-side, kicked opposite the travel so the trail streams behind.
          spawnParts(0, player.body.x - player.facing * 10, player.body.y, 2,
                     -player.facing * 30);
        }
      } else slideDustT = 0;

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
          spawnParts(1, dead.x, dead.y - 14, 6);      // V2: pop debris shards
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

      if (wasAirborne && player.coyote > 0) {
        score.onLand(); flightWows = 0;
        spawnParts(0, player.body.x, player.body.y, 6);   // V2: landing dust
      }
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
        // SFX v2: the ship's engine roar under the fanfare. Rendered
        // rumble-forward on purpose so the two never fight; its ~3s tail
        // rings past the 2.5s cutscene into the win screen's silence.
        sfx?.play('takeoff');
      }
    },

    render(ctx) {
      // (1) parallax — screen space, drawn BEFORE cam.apply. Every offset is
      // rounded so the bands land on whole pixels and never shimmer against the
      // tiles. Vertical factors are deliberately far gentler than horizontal
      // ones: the horizon should breathe when you fly, not swing.
      const drift = f => -Math.round((cam.y - camY0) * f);
      // each band is authored 640 wide, so it is drawn twice to cover the seam
      // Bands draw as the exact visible slice (two source-rect cuts across
      // the wrap seam), like the sky: the draw-the-cell-twice seam pattern
      // rasterized a second full strip for nothing. The production strips are
      // untrimmed 640-wide cells, so source math is direct.
      const band = (name, fx, fy, bias) => {
        const a = atlas.anims[name], f = atlas.frames[a.frames[0]];
        const oy = restLine + bias - a.ch + drift(fy);   // cell BOTTOM sits `bias` below the horizon
        const off = Math.round(wrap(cam.x * fx, VW));
        const w1 = Math.min(VW, a.cw - off);
        ctx.drawImage(atlas.img, f.x + off, f.y, w1, a.ch, 0, oy, w1, a.ch);
        if (w1 < VW) ctx.drawImage(atlas.img, f.x, f.y, VW - w1, a.ch, w1, oy, VW - w1, a.ch);
      };
      const sox = -Math.round(wrap(cam.x * 0.10, VW));
      const dr = dread(cam.x);
      // OVERDRAW BUDGET. The old starfield sky was mostly transparent pixels
      // and rasterized for almost nothing; the production skies are opaque
      // 640x360 cells, and a naive draw-twice-for-the-seam pattern doubles
      // their raster cost. So the sky is drawn as exactly the VISIBLE slice:
      // two source-rect cuts that stitch the wrap seam edge to edge, cropped
      // at the haze line below which the haze fill + floor cover every pixel
      // anyway. hazeTop is computed here (it belongs to the rocks band drawn
      // later) because the sky needs the crop line first. The sky sits pinned
      // to the top of the frame: its old 0.05 vertical drift is gone, which
      // with an OPAQUE sky would have opened a bare strip above it in flight.
      const hazeTop = restLine + 10 + drift(0.20) - 20;
      const drawSky = (name) => {
        const a = atlas.anims[name], f = atlas.frames[a.frames[0]];
        const h = Math.min(a.ch, Math.max(0, hazeTop));
        const off = Math.round(wrap(cam.x * 0.10, VW));
        const w1 = Math.min(VW, a.cw - off);
        ctx.drawImage(atlas.img, f.x + off, f.y, w1, h, 0, 0, w1, h);
        if (w1 < VW) ctx.drawImage(atlas.img, f.x, f.y, VW - w1, h, w1, 0, VW - w1, h);
      };
      // Arena dread: the boss sky fades over the sunset as the camera closes
      // on the arena and back out on the victory lap — a blend, never a pop.
      // At the blend's ENDS only one sky is drawn: the whole boss fight sits
      // at dr === 1, and doubled sky raster there is exactly the kind of cost
      // the perf gate exists to catch.
      drawSky(dr >= 1 ? 'sky_boss' : skyName);
      if (dr > 0 && dr < 1) {
        ctx.globalAlpha = dr;
        drawSky('sky_boss');
        ctx.globalAlpha = 1;
      }
      // The sun. A single-placement cameo — NEVER baked into (or wrapped with)
      // the tiling sky strip. It gets its own near-zero parallax because the
      // sun is at optical infinity: the one placement drifts ~160px over the
      // whole run and never leaves the sky. The dread blend swallows it whole
      // before the arena (the boss sky has no sun by design).
      const su = sunset(cam.x);
      if (!wow && dr < 1) {
        ctx.globalAlpha = 1 - dr;
        // The sun SINKS with run progress (juice pass V1): 64px of drop across
        // the full gauntlet, slow enough to never read as movement, plain
        // enough that the pad's sky is visibly later in the day than the
        // spawn's. It slides down BEHIND the mesa band, which is the sunset.
        drawLayer(ctx, 'sun', Math.round(356 - cam.x * 0.007),
                  44 + Math.round(su * 64) + drift(0.05));
        ctx.globalAlpha = 1;
      }
      // Warm dusk glaze over the sky slice (V1): a dark-red wash (palette
      // #38060f) that deepens toward the pad, so the run ends redder and a
      // touch darker. Scaled by (1 - dread): the boss sky arrives unglazed,
      // exactly as authored, and gets the sunset back on the victory lap.
      if (!wow) {
        const warm = su * (1 - dr) * 0.26;
        if (warm > 0.01 && hazeTop > 0) {
          ctx.fillStyle = `rgba(56,6,15,${warm.toFixed(3)})`;
          ctx.fillRect(0, 0, VW, Math.min(360, hazeTop));
        }
      }
      // Ambient flyer (juice pass V4): a rare distant silhouette crossing the
      // upper sky. The SCHEDULE is a hash of the time-segment index — one
      // ~22s window in three carries a crossing, height/direction/flap all
      // dealt off the same hash — so every session sees the same birds at the
      // same moments and two machines agree. Screen-space, high in the sky
      // band (y < ~100, far above the playfield), 7px of dark silhouette:
      // unmistakably scenery, not a threat. Faded out with the dread blend so
      // nothing shares the boss's sky, and gauntlet-only (wow keeps its own
      // untouched sky).
      if (!wow && dr < 0.5) {
        const SEG = 22;
        const k = Math.floor(ambT / SEG);
        const h = hash2(k, 6011);
        if (h % 3 === 0) {
          const p = (ambT - k * SEG) / SEG;             // 0..1 across the window
          const dir = (h >>> 3) & 1 ? 1 : -1;
          const bx = Math.round(dir > 0 ? -8 + p * (VW + 16) : VW + 8 - p * (VW + 16));
          const by = Math.round(24 + (h >>> 4) % 64 +
                                Math.sin(ambT * 0.9 + k) * 3);   // lazy glide bob
          const flap = Math.floor(ambT * 2.6) % 2;      // slow two-frame wingbeat
          ctx.globalAlpha = (1 - dr * 2) * 0.8;
          ctx.fillStyle = '#38060f';
          ctx.fillRect(bx - 1, by, 3, 1);               // body
          if (flap) { ctx.fillRect(bx - 3, by - 1, 2, 1); ctx.fillRect(bx + 2, by - 1, 2, 1); }
          else      { ctx.fillRect(bx - 3, by + 1, 2, 1); ctx.fillRect(bx + 2, by + 1, 2, 1); }
          // Some windows deal a companion trailing behind and slightly above.
          if ((h >>> 9) & 1) {
            ctx.fillRect(bx - dir * 11 - 1, by - 5, 3, 1);
            if (!flap) { ctx.fillRect(bx - dir * 11 - 3, by - 6, 2, 1);
                         ctx.fillRect(bx - dir * 11 + 2, by - 6, 2, 1); }
            else      { ctx.fillRect(bx - dir * 11 - 3, by - 4, 2, 1);
                         ctx.fillRect(bx - dir * 11 + 2, by - 4, 2, 1); }
          }
          ctx.globalAlpha = 1;
        }
      }
      // Hangs in the same far sky, on the same slow factors, so it sits behind
      // every band that follows and drifts with them.
      if (xOn?.()) { drawDeco1(ctx, sox + 96, 52 + drift(0.05));
                     drawDeco1(ctx, sox + VW + 96, 52 + drift(0.05)); }
      // Props go down BEFORE their band, so the band occludes them the same way
      // the strip art did when they were painted underneath it.
      for (const p of MESA_PROPS) drawProp(ctx, p, drift);
      band('par_mesas', 0.30, 0.12, 4);
      // far-ground haze under the near band: with the camera riding high the
      // real floor drops away faster than the parallax does, and without this
      // you get a strip of bare sky wedged between the rocks and the ground.
      const rocksBottom = restLine + 10 + drift(0.20);
      // Capped at the floor slab's screen line (the world tiles + pit-void
      // strip are opaque from there down), not the screen bottom: the old
      // full-height fill was ~120 rows of pure overdraw at rest camera.
      ctx.fillStyle = '#3b190f';
      ctx.fillRect(0, rocksBottom - 20, VW,
                   Math.min(VH, level.h - 8 * TILE - cam.y + 1) - rocksBottom + 20);
      for (const p of ROCK_PROPS) drawProp(ctx, p, drift);
      band('par_rocks', 0.60, 0.20, 10);
      // Ancient landmarks: feet on the haze shelf, drawn BEFORE the
      // single-placement shelf props so those keep the front of the stage —
      // and skipped anywhere near one (the layer-space guard), so a repeating
      // ruin can never crowd a landmark that exists exactly once.
      // One ruin per 2048px super-strip of the shelf layer (~every 3-4
      // screens of world travel), at a hashed offset inside it — a plain
      // per-strip hash gate clumped badly (an 8-screen empty gap, then three
      // of the same monument in a row at the pad; measured before shipping).
      for (let k = Math.max(0, Math.floor(cam.x * 0.60 / 2048) - 1), n = 0; n < 3; k++, n++) {
        const h = hash2(k, 7877);
        const lx = k * 2048 + h % 1600;
        if (SHELF_PROPS.some(p => Math.abs(lx - p.x) < 170)) continue;
        const sx = Math.round(lx - cam.x * 0.60);
        if (sx < -60 || sx > VW + 60) continue;
        const name = LANDMARKS[(h >>> 11) % LANDMARKS.length];
        atlas.drawFeet(ctx, name, atlas.anims[name].frames[0], sx, rocksBottom - 4);
      }
      for (const p of SHELF_PROPS) drawProp(ctx, p, drift);
      // Mid-band flora: sparse silhouettes rooted on the haze shelf between
      // the rock band and the playfield, riding the rocks' parallax. Pure
      // function of the strip index k — the same desert every session.
      for (let k = Math.max(0, Math.floor(cam.x * 0.60 / 256) - 1), n = 0; n < 5; k++, n++) {
        const h = hash2(k, 4211);
        if (h % 3 === 0) continue;                     // gaps in the hedge
        const name = 'flora_' + [1, 0, 5, 2, 1, 5][h % 6];
        const sx = Math.round(k * 256 + (h >>> 8) % 160 - cam.x * 0.60);
        if (sx < -30 || sx > VW + 30) continue;
        atlas.drawFeet(ctx, name, atlas.anims[name].frames[0], sx, rocksBottom - 12);
      }

      ctx.save(); cam.apply(ctx);

      // (2) tiles, culled to the visible window and CACHED (see tileCanvas up
      // top). Frame choice is pickTileFrame (tiles.js): surface/fill plus the
      // pit-edge, pit-wall, underside-lip and worn-variant frames of the
      // 10-frame production set. It is a pure function of the coordinate and
      // the (carve-epoch-guarded) neighbourhood, so cached cells stay valid.
      const tx0 = Math.max(0, Math.floor(cam.x / TILE));
      const tx1 = Math.min(level.wTiles - 1, Math.floor((cam.x + VW) / TILE));
      const ty0 = Math.max(0, Math.floor(cam.y / TILE));
      const ty1 = Math.min(level.hTiles - 1, Math.floor((cam.y + VH) / TILE));
      const w = tileWin;
      if ((!w || w.tx0 !== tx0 || w.ty0 !== ty0 || w.tx1 !== tx1 || w.ty1 !== ty1 ||
           w.epoch !== tileEpoch) && typeof document !== 'undefined') {
        if (!tileCanvas) {
          const cw = (Math.ceil(VW / TILE) + 1) * TILE, ch = (Math.ceil(VH / TILE) + 1) * TILE;
          tileCanvas = document.createElement('canvas');
          tileScratch = document.createElement('canvas');
          tileCanvas.width = tileScratch.width = cw;
          tileCanvas.height = tileScratch.height = ch;
        }
        // The pit-void gradient the cache paints under its cells. Uniform in
        // x, so a 16px-wide strip is enough; sliced per cell row below.
        const floorTy = level.hTiles - 8;
        if (!voidGrad) {
          voidGrad = document.createElement('canvas');
          voidGrad.width = TILE; voidGrad.height = 8 * TILE;
          const vg = voidGrad.getContext('2d');
          const lg = vg.createLinearGradient(0, 0, 0, voidGrad.height);
          lg.addColorStop(0, '#3b190f');
          lg.addColorStop(0.45, '#27030b');
          lg.addColorStop(1, '#010800');
          vg.fillStyle = lg;
          vg.fillRect(0, 0, TILE, voidGrad.height);
        }
        // Depth-band darkening for a floor row: the walked slab reads as a
        // dead flat wall without it. All the stops are tile-aligned, so it
        // decomposes per cell and BAKES — as does the pit void — which is why
        // neither costs a per-frame pass any more (the perf probe priced the
        // live full-width fills at ~2ms a frame at 4x throttle).
        // Retuned for the masonry tileset (fix round): the direction sheet
        // fades its stonework to near-black by the fourth course, and the
        // old gentle .15/.30 ramp left eight rows of full-brightness blocks
        // — busier than the approved look and worse for sprite pop.
        const bandAlpha = ty => ty < floorTy + 2 ? 0 : ty < floorTy + 3 ? 0.18
                              : ty < floorTy + 5 ? 0.38 : ty < floorTy + 8 ? 0.55 : 0.7;
        const g = tileScratch.getContext('2d');
        // Per-cell decals over the fill frames, retuned for the masonry
        // tileset (fix round): the fill frames repeat the same stone every
        // 16px, so this stamps coordinate-hashed weathering ON the block
        // body (mottle inside the 1..13 interior, clear of the mortar seams)
        // plus the odd ember pip glowing IN a seam. Deterministic per
        // coordinate, exact palette entries only, baked into the cache so it
        // costs nothing per frame.
        const decal = (tx, ty, cx, cy) => {
          let h = hash2(tx + 0x9e37, ty);
          const px = (col, x, y, w2) => { g.fillStyle = col; g.fillRect(cx + x, cy + y, w2, 1); };
          for (let i = 0, nd = 1 + (h & 1); i < nd; i++) {   // block mottle
            h = hash2(h, i);
            px('#4f1212', 2 + h % 11, 3 + (h >>> 4) % 10, 1 + (h >>> 8) % 2);
          }
          h = hash2(h, 77);                                   // a lighter scuff
          if ((h >>> 12) % 3 === 0) px('#70140d', 2 + (h >>> 16) % 11, 3 + (h >>> 20) % 10, 2);
          h = hash2(h, 9);                                    // ember pip in a seam
          if (h % 4 === 0) {
            const inRight = (h >>> 4) & 1;                    // right column vs bottom row
            px((h >>> 8) & 1 ? '#e46016' : '#cb5316',
               inRight ? 15 : 2 + h % 12, inRight ? 2 + h % 12 : 15, 1);
          }
        };
        g.clearRect(0, 0, tileScratch.width, tileScratch.height);
        // Same-epoch window shift: copy the overlap, draw only exposed cells.
        // An epoch change (gate carve) invalidates the pixels, so it redraws
        // the full window — once, on the frame the gate opens.
        const shift = w && w.epoch === tileEpoch;
        if (shift) g.drawImage(tileCanvas, (w.tx0 - tx0) * TILE, (w.ty0 - ty0) * TILE);
        for (let ty = ty0; ty <= ty1; ty++)
          for (let tx = tx0; tx <= tx1; tx++) {
            if (shift && tx >= w.tx0 && tx <= w.tx1 && ty >= w.ty0 && ty <= w.ty1) continue;
            const cx = (tx - tx0) * TILE, cy = (ty - ty0) * TILE;
            // Void behind the cell: solid tiles cover it; pit columns keep it,
            // which turns a hole in the floor into depth instead of a window
            // onto the parallax haze.
            if (ty >= floorTy)
              g.drawImage(voidGrad, 0, (ty - floorTy) * TILE, TILE, TILE, cx, cy, TILE, TILE);
            if (level.solidAt(tx, ty)) {
              const f = pickTileFrame(level, tx, ty);
              atlas.drawCentered(g, tilesName, atlas.anims[tilesName].frames[f],
                                 cx + 8, cy + 8);
              if (f === 1 || f === 7) decal(tx, ty, cx, cy);
            }
            const ba = bandAlpha(ty);
            if (ba) { g.fillStyle = `rgba(0,0,0,${ba})`; g.fillRect(cx, cy, TILE, TILE); }
          }
        [tileCanvas, tileScratch] = [tileScratch, tileCanvas];
        tileWin = { tx0, ty0, tx1, ty1, epoch: tileEpoch };
      }
      if (tileCanvas) ctx.drawImage(tileCanvas, tx0 * TILE, ty0 * TILE);

      // (2c) ground flora: decor scattered along the walked floor, a pure
      // function of the world column (tiles.js floraIndexAt) — deterministic,
      // non-colliding, and it only grows on intact floor so pit lips and
      // corridors stay readable. Drawn over the depth bands (feet on the lit
      // floor line, above where the bands start) and under everything alive.
      const floorTy = level.hTiles - 8;
      for (let ftx = tx0; ftx <= tx1 + 1; ftx++) {
        let fi = floraIndexAt(level, ftx, floorTy);
        if (fi < 0) continue;
        // The arena floor keeps its decor LOW: a knee-high shrub dresses the
        // fight, a 34px cactus in the dive lane reads as cover the game does
        // not honour. Still deterministic — the remap is a pure function of
        // the same index.
        if (!wow && ftx * TILE > arenaX - 200 && ftx * TILE < gateX + 100 &&
            fi !== 3 && fi !== 4 && fi !== 6 && fi !== 7) fi = [3, 6, 7, 4][fi % 4];
        const fname = 'flora_' + fi;
        atlas.drawFeet(ctx, fname, atlas.anims[fname].frames[0],
                       ftx * TILE + 8 + (hash2(ftx, 51) % 7) - 3, floorTy * TILE);
      }

      // (3) signs: a post carrying a board sized to its own text. The dark
      // board matters — these read over tiles and over sky depending on where
      // the chunk put them, and bare green text loses against the rock.
      // Text is authored lowercase (doge voice) but the font is caps-only, so
      // it's upshifted at draw — the glyphs fold caps anyway, this just keeps
      // measure() and drawText() looking at the same string.
      for (const sg of level.signs) {
        // Touch players get the same board in their own verbs. Swapped AT
        // DRAW, keyed by the authored string: level data never changes, so
        // chunks.js's signTexts-count invariant and wow's stripped-signs rule
        // are untouched, and a keyboard mid-run stays word-for-word as
        // authored. Signs with no key names in them fall through unmapped.
        const text = touchUI?.() ? (TOUCH_SIGNS[sg.text] ?? sg.text) : sg.text;
        const upper = text.toUpperCase();
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

      // (6) enemies — draw only the camera window (+80: comfortably past the
      // widest 42px enemy cell).
      // The roster is 40+ and the sleeping off-screen majority was a solid
      // block of wasted drawImage calls in the phone profile. Sim untouched:
      // enemies.update keeps its own 1400px sleep gate.
      const ex0 = cam.x - 80, ex1 = cam.x + VW + 80;
      enemies.forEach(e => {
        if (e.x < ex0 || e.x > ex1) return;
        atlas.drawFeet(ctx, e.anim, animFrame(atlas.anims[e.anim], e.t), e.x, e.y, e.vx < 0);
      });

      // (6b) MEGA SAUCER — the 64px enemyfly_red cell blown up 3x to arena scale,
      // plus a floating hp bar. Both hang off boss.x/boss.y (the CENTER anchor).
      if (boss && boss.on) {
        // Separation halo, proposed off the arena-mock feedback: against the
        // near-black boss sky the 3x red dome read as a flat blob. A faint
        // warm radial behind it (render-only — the sprite is untouched)
        // restores the silhouette. Baked ONCE into its own canvas: a live
        // createRadialGradient fill every frame was a measurable chunk of the
        // arena's frame budget on the perf probe.
        if (!haloCanvas && typeof document !== 'undefined') {
          haloCanvas = document.createElement('canvas');
          haloCanvas.width = haloCanvas.height = 210;
          const hg = haloCanvas.getContext('2d');
          const halo = hg.createRadialGradient(105, 105, 12, 105, 105, 105);
          halo.addColorStop(0, 'rgba(249,210,129,0.22)');
          halo.addColorStop(1, 'rgba(249,210,129,0)');
          hg.fillStyle = halo;
          hg.fillRect(0, 0, 210, 210);
        }
        if (haloCanvas)
          ctx.drawImage(haloCanvas, Math.round(boss.x - 105), Math.round(boss.y - 105));
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
      // (6c2) juice particles: dust + debris, under the player so a puff can
      // never sit ON the hero and muddy a read. Pool-capped and culled.
      drawParts(ctx);

      // (6d) the ship. Always drawn on its pad — before the gate opens it is
      // simply hundreds of tiles off to the right, so no gating is needed.
      // No ship in wow — there is no extraction to earn, and level.shipPad is
      // null because no wow chunk carries a 'T'.
      //
      // PARKED GROUNDING (user screenshot fix). The ship cell's shared feet
      // line (feetY) is the max art bottom across the 18-frame hover loop —
      // set by the mid-cycle exhaust frames. The parked frame's own art
      // bottom sits higher, so anchoring it at feetY hovered the whole ship
      // above the pad, its skid resting exactly on the dark haze shelf the
      // parallax pass paints behind the floor lip — which read as a ship sunk
      // in a pit void, un-sinking only when a jump shifted the bands. The
      // correction is MEASURED from the shipped atlas (parked frame's real
      // bottom vs feetY), never hardcoded, and melts to zero over the first
      // ~0.1s of takeoff so the authored lift/bob keeps its own anchors.
      // Draw order stays: the ship goes down AFTER the tile-cache blit that
      // bakes the pit-void gradient and the floor depth bands, so nothing in
      // the terrain pass can cover it — the pad e2e probes exactly that band.
      if (level.shipPad) {
        const sa = atlas.anims.ship, sf = atlas.frames[sa.frames[0]];
        const ground = Math.max(0, sa.feetY - (sf.oy + sf.h));
        const sink = takeoff >= 0 ? Math.max(0, ground - liftY) : ground;
        atlas.drawFeet(ctx, 'ship', takeoff >= 0 ? animFrame(atlas.anims.ship, takeoff)
                                                 : atlas.anims.ship.frames[0],
                       level.shipPad.x, level.shipPad.y - liftY + sink);
      }

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
      //
      // ART-ORIGIN CORRECTION (fix-round, user screenshot): the blast_muzzle
      // cell is authored with its flash CORE ~15px LEFT of the cell centre
      // (the streak side owns the rest of the cell), so drawCentered at the
      // recorded barrel tip parked the visible core back on the gun sprite.
      // The correction is measured from the shipped atlas frame (spark
      // frame's art centre vs cell centre), never hardcoded, and applied
      // along the shot direction so both facings land the core on the tip.
      if (player.muzzle && !player.muzzle.dy) {
        const m = player.muzzle;
        const muz = atlas.anims.blast_muzzle, mf0 = atlas.frames[muz.frames[0]];
        const mx = m.x + m.dx * (muz.cw / 2 - (mf0.ox + mf0.w / 2));
        const my = m.y + muz.ch / 2 - (mf0.oy + mf0.h / 2);
        ctx.save();
        if (m.dx < 0) { ctx.translate(mx, my); ctx.scale(-1, 1); ctx.translate(-mx, -my); }
        atlas.drawCentered(ctx, 'blast_muzzle',
          animFrame(atlas.anims.blast_muzzle, m.t), mx, my, 0);
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
      // 608, not 630: the shell layer's sound button occupies x 615..637 at the
      // top-right corner (see main.js), and at 630 the score ran straight under
      // the speaker glyph. Caught in the branding pass's visual check.
      // y is now the TOP of the 14px-tall text box (scale 2), not a baseline.
      // Plated and shadowed since the sky overhaul: gold on the pale-gold sky
      // band was invisible bare, and thin on a shadow alone. Same page-black
      // plate family as the shell buttons; it stretches to cover the wow
      // progress line when there is one.
      const scoreTxt = `wow ${score.value()}`;
      const chunkTxt = wow ? `CHUNK ${chunkIndex}/${WOW_LEN}` : '';
      const spw = Math.max(measure(scoreTxt, 2), wow ? measure(chunkTxt, 2) : 0) + 10;
      ctx.fillStyle = 'rgba(11,11,18,0.45)';
      ctx.fillRect(613 - spw, 4, spw, wow ? 38 : 22);
      drawTextShadow(ctx, scoreTxt, 608, 8, { scale: 2, align: 'right' },
                     '#eec548', '#3b190f');
      // Wow's progress readout, under the score. The gauntlet has signs, a boss
      // and a ship to tell you where you are; wow is 40 anonymous chunks, so the
      // counter IS the sense of progress.
      if (wow) {
        drawTextShadow(ctx, `CHUNK ${chunkIndex}/${WOW_LEN}`, 608, 26,
                       { scale: 2, align: 'right' }, '#8fa', '#3b190f');
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
      slideT: player.slideT,                  // e2e drives the chord off ESTABLISHED, not a stopwatch
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
      // Juice-pass observability: live particles in the render pool (V2).
      parts: parts.reduce((n, p) => n + (p.on ? 1 : 0), 0),
    }),
  };
}
