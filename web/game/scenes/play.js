// The real play scene: GAUNTLET level + player + enemies + coins + score +
// parallax art + culled tile render + HUD.
//
// Render order is load-bearing and reads bottom-up:
//   parallax (screen space, OUTSIDE the camera) → tiles → signs → checkpoints
//   → coins → enemies → player → muzzle → bolts → popups → [restore] → HUD.
import { buildGauntlet, TILE } from '../chunks.js';
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

const VW = 640, VH = 360;

const ANIM_FOR = {                       // state → atlas anim
  spawn: 'spawn', idle: 'stand', walk: 'run', air: 'run',
  slide: 'slide', duck: 'duck',
  hit: 'hit', ded: 'dead',
};

const wrap = (v, m) => ((v % m) + m) % m;   // JS % keeps the sign; scrolling needs it positive

export function makePlay({ atlas, input, save, go }) {
  const level = buildGauntlet();   // fresh per scene: R-restart re-seals any carved gate
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
  // --- run stats + extraction ------------------------------------------------
  let timeS = 0;                 // run clock, seconds (paused during takeoff)
  let killCount = 0;             // roster kills + the boss
  let takeoff = -1;              // -1 = not started; >= 0 = seconds elapsed
  let liftY = 0;                 // how far the ship (and rider) has risen, px
  let thrustT = 0.25;            // thrust-FX metronome (pre-armed: puff on frame 1)
  let thrustSide = 1;            // alternating nozzle
  let prevHp = P.HP_MAX; let prevState = 'spawn';
  // WOW+ escalation: one popup per flight that grows instead of spamming a new
  // popup per event. Counts the WOW+ events banked during the CURRENT flight
  // (reset the frame we land), capped at three '+'.
  let flightWows = 0;
  // --- boss state ------------------------------------------------------------
  // bossSpawned is a ONE-WAY latch: it stays true through the boss's death AND
  // through a mid-fight real death, so the arena can never re-arm a second saucer.
  let boss = null, bossSpawned = false, bossAnimT = 0;
  const fx = [];                          // explode puffs: { x, y, t } — t < 0 = staggered wait
  // Floor top at the trigger column, scanned out of the level rather than
  // hardcoded: the arena's authored row count is a chunks.js detail, and the
  // FLOOR_PAD repeat rows below it make an arithmetic guess easy to get wrong.
  const bossFloorY = (() => {
    const tx = Math.floor(level.bossTrigger / TILE);
    for (let ty = 0; ty < level.hTiles; ty++) if (level.solidAt(tx, ty)) return ty * TILE;
    return level.h;
  })();
  if (typeof window !== 'undefined' && window.__blast) window.__blast.P = P;  // live tuning hook

  // Everything that happens the moment the boss's last hp point lands. Shared
  // by the bolt-kill path and the ?test cheat so the two can never drift.
  function bossDeath() {
    cam.shake(10, 0.4);
    score.add('boss');                                  // flat +500, not a roster kill
    killCount++;                                        // ...but it still counts in the tally
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
  // tx386 — BEYOND the gate at tx382/383 — so respawning there would drop the
  // player past a sealed gate with the boss still alive behind them.
  // It cannot happen: player.js only captures a checkpoint on TOUCH
  // (|dx| < 12 && |dy| < 24 against the marker), and the gate wall is solid
  // across EVERY row above the floor until bossDeath() carves it. The
  // player physically cannot reach tx386 before the boss dies, so the live
  // checkpoint throughout the fight is #3 at tx290 (C7) — a mid-fight death
  // walks you back to C7 and into the arena again, with the same boss.
  // (checkpoint columns: 98, 194, 290, 386.)

  // --- test-only cheats. Gated on ?test so a normal player never sees them.
  // has('test'), not search.includes('test'): the loose form armed cheats for any
  // URL that merely CONTAINS the substring (?contest=1, #latest, a path segment).
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('test') &&
      typeof window !== 'undefined' && window.__blast) {
    window.__blast.cheat = {
      warp(x) {
        player.body.x = x;
        player.checkpoint = { x, y: player.body.y };
      },
      killBoss() {
        if (!boss || !boss.on) return;
        while (boss.on) if (boss.hurt()) bossDeath();
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

  // The run's final tally. timeBonus is added to the score exactly ONCE, here —
  // score.value() never learns about it, so calling breakdown() twice is safe.
  function breakdown() {
    const t = Math.floor(timeS);
    const timeBonus = Math.max(0, 3000 - t * 10);
    return {
      kills: killCount,
      coins: 50 - coins.remaining(),
      deaths: player.deaths,
      timeS: t,
      timeBonus,
      score: score.value() + timeBonus,
    };
  }

  function drawLayer(ctx, name, sx, sy) {
    const a = atlas.anims[name];
    atlas.drawCentered(ctx, name, a.frames[0], sx + a.cw / 2, sy + a.ch / 2);
  }

  return {
    update(dt) {
      // retry wins over everything, takeoff included: a deliberate choice —
      // R during the extraction cutscene restarts the run rather than making
      // the player sit out 2.5s of ship they've already earned.
      if (input.pressed('retry')) { go('play'); return; }
      if (input.pressed('pause')) paused = !paused;
      if (paused) return;                                // freeze EVERYTHING, clock included
      if (takeoff >= 0) { updateTakeoff(dt); return; }   // world frozen: input ignored
      timeS += dt;
      const wasAirborne = player.coyote === 0;
      player.update(dt, input.actions(), level, playerBolts);
      // contact gate: hurt() owns damage authority via iframes; the dummy body
      // is a perf skip so overlapping-frame AABB checks stop during the stagger.
      enemies.update(dt, player.iframes > 0 ? { x: player.body.x, y: -9999, w: 0 } : player.body,
                     enemyBolts, fromX => player.hurt(fromX));
      playerBolts.update(dt, level);
      enemyBolts.update(dt, level);

      // Boss trigger: crossing 8 tiles into C8 arms the fight, once and forever.
      if (!bossSpawned && player.body.x > level.bossTrigger) {
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
                    enemyBolts, fromX => player.hurt(fromX));
      }
      for (let i = fx.length - 1; i >= 0; i--) {
        fx[i].t += dt;
        if (animDone(atlas.anims.explode, fx[i].t)) fx.splice(i, 1);
      }

      playerBolts.forEachHittable(b => {
        if (boss && boss.on && boss.hitTest(b)) {
          playerBolts.kill(b);
          if (boss.hurt()) bossDeath();
          return;
        }
        const e = enemies.hitTest(b);
        if (!e) return;
        playerBolts.kill(b);
        if (--e.hp > 0) return;
        enemies.kill(e, dead => {
          const airborne = player.coyote === 0;
          score.onKill(airborne);
          killCount++;
          player.airCharges = P.AIR_CHARGES;            // kills refill the tank
          popups.spawn(dead.x, dead.y - 30, '+100');
          cam.shake(5, 0.2);
        });
      });

      enemyBolts.forEachHittable(b => {
        const pb = player.body;
        if (Math.abs(b.x - pb.x) < pb.w / 2 + 4 && b.y > pb.y - pb.h && b.y < pb.y) {
          enemyBolts.kill(b);
          player.hurt(b.x);
        }
      });

      coins.update(dt, player.body, c => { score.add('coin'); popups.spawn(c.x, c.y, '+10'); });

      if (wasAirborne && player.coyote > 0) { score.onLand(); flightWows = 0; }
      const evs = score.takeEvents();
      if (evs.length) {
        flightWows = Math.min(flightWows + evs.length, 3);
        popups.spawn(player.body.x, player.body.y - 60, 'WOW' + '+'.repeat(flightWows));
      }
      popups.update(dt);

      cam.follow(player.body.x, player.body.y, player.facing, dt, level);
      if (player.hp < prevHp && player.state !== 'ded') cam.shake(3, 0.15);
      // real death: the board resets around you — every enemy back at its spawn,
      // and the run pays 100 wow for it (floored at 0). Coins stay collected.
      if (player.state === 'ded' && prevState !== 'ded') {
        cam.shake(8, 0.3);
        score.dock(100);
        enemies.reviveAll();
      }
      prevHp = player.hp; prevState = player.state;
      // Extraction: stand on the pad with the gate carved open and the ship goes.
      if (takeoff < 0 && gateIsOpen() && player.coyote > 0 &&
          Math.abs(player.body.x - level.shipPad.x) < 24) takeoff = 0;
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
      band('par_mesas', 0.30, 0.12, 4);
      // far-ground haze under the near band: with the camera riding high the
      // real floor drops away faster than the parallax does, and without this
      // you get a strip of starfield wedged between the rocks and the ground.
      const rocksBottom = restLine + 10 + drift(0.20);
      ctx.fillStyle = '#2a1c33';
      ctx.fillRect(0, rocksBottom - 20, VW, VH - rocksBottom + 20);
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
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      for (const sg of level.signs) {
        const bw = Math.round(ctx.measureText(sg.text).width) + 8;
        ctx.fillStyle = '#5b4a3a'; ctx.fillRect(sg.x - 2, sg.y - 20, 4, 20);      // post
        ctx.fillStyle = '#1b1420'; ctx.fillRect(sg.x - bw / 2, sg.y - 32, bw, 13); // board
        ctx.fillStyle = '#8a7358'; ctx.fillRect(sg.x - bw / 2, sg.y - 32, bw, 1);  // lit top edge
        ctx.fillStyle = '#8fa'; ctx.fillText(sg.text, sg.x, sg.y - 23);
      }
      ctx.textAlign = 'left';

      // (4) checkpoints
      for (const c of level.checkpoints) {
        ctx.fillStyle = '#186'; ctx.fillRect(c.x - 2, c.y - 26, 4, 26);
        ctx.fillStyle = '#2c8'; ctx.fillRect(c.x + 2, c.y - 26, 10, 7);
      }

      // (5) coins
      coins.forEach(c => atlas.drawCentered(ctx, 'coin',
        animFrame(atlas.anims.coin, c.t), c.x, c.y));

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
        const anim = ANIM_FOR[player.state];
        atlas.drawFeet(ctx, anim, animFrame(atlas.anims[anim], player.stateT),
                       player.body.x, player.body.y, player.facing < 0);
      }

      // (8) muzzle flash at the recorded shot origin (mirrored for leftward shots)
      if (player.muzzle) {
        const m = player.muzzle;
        ctx.save();
        if (m.dx < 0) { ctx.translate(m.x, m.y); ctx.scale(-1, 1); ctx.translate(-m.x, -m.y); }
        atlas.drawCentered(ctx, 'blast_muzzle',
          animFrame(atlas.anims.blast_muzzle, m.t), m.x, m.y,
          m.dy ? Math.PI / 2 : 0);
        ctx.restore();
      }

      // (9) bolts, both factions
      playerBolts.render(ctx, atlas);
      enemyBolts.render(ctx, atlas);

      // (10) popups ride in world space so they stick to what scored them
      popups.render(ctx);

      ctx.restore();

      // (11) HUD
      for (let i = 0; i < P.HP_MAX; i++)
        atlas.drawCentered(ctx, 'heart', atlas.anims.heart.frames[i < player.hp ? 0 : 1],
                           10 + i * 12 + 5, 10 + 5);
      for (let i = 0; i < P.AIR_CHARGES; i++)
        atlas.drawCentered(ctx, 'pip', atlas.anims.pip.frames[i < player.airCharges ? 0 : 1],
                           10 + i * 10 + 4, 24 + 6);
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#eec548';
      ctx.fillText(`wow ${score.value()}`, 630, 18);
      ctx.textAlign = 'left';

      // (12) pause veil, over the HUD and everything else.
      if (paused) {
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, VW, VH);
        // Plate behind the text: a 55% dim alone isn't enough to keep 'such
        // pause.' legible over the player sprite and a lit sign board, which
        // is exactly where the camera tends to be when you hit Escape.
        ctx.fillStyle = 'rgba(11,11,18,.88)'; ctx.fillRect(160, 138, 320, 74);
        ctx.fillStyle = '#3a3350';
        ctx.fillRect(160, 138, 320, 1); ctx.fillRect(160, 211, 320, 1);   // top+bottom rule
        ctx.textAlign = 'center';
        ctx.font = 'bold 26px monospace';
        ctx.fillStyle = '#2a1c33'; ctx.fillText('such pause.', VW / 2 + 2, 176 + 2);
        ctx.fillStyle = '#eec548'; ctx.fillText('such pause.', VW / 2, 176);
        ctx.font = '10px monospace'; ctx.fillStyle = '#8fa';
        ctx.fillText('Esc resume  ·  R restart', VW / 2, 200);
        ctx.textAlign = 'left';
      }
    },

    state: () => ({
      x: player.body.x, y: player.body.y, vx: player.body.vx, vy: player.body.vy,
      pstate: player.state, charges: player.airCharges, deaths: player.deaths,
      hp: player.hp, iframes: player.iframes,
      paused, bullets: playerBolts.count(),
      score: score.value(), enemies: enemies.count(), coins: coins.remaining(),
      bossOn: !!(boss && boss.on), bossHp: boss ? boss.hp : -1, bossSpawned,
      // bossPhase is observability-only (headless fight probes assert that a
      // player actually LIVES to see spread/slam now that hp is 40).
      bossPhase: boss && boss.on ? boss.phase : null,
      gateOpen: gateIsOpen(),
      timeS: Math.floor(timeS), killCount, takeoff: takeoff >= 0,
    }),
  };
}
