// The real play scene: GAUNTLET level + player + enemies + coins + score +
// parallax art + culled tile render + HUD.
//
// Render order is load-bearing and reads bottom-up:
//   parallax (screen space, OUTSIDE the camera) → tiles → signs → checkpoints
//   → coins → enemies → player → muzzle → bolts → popups → [restore] → HUD.
import { GAUNTLET, TILE } from '../chunks.js';
import { makePlayer } from '../player.js';
import { makeBullets } from '../bullets.js';
import { makeEnemies } from '../enemies.js';
import { makeCoins } from '../coins.js';
import { makeScore } from '../score.js';
import { makePopups } from '../popups.js';
import { makeCamera } from '../../engine/camera.js';
import { animFrame } from '../../engine/assets.js';
import { P } from '../physics.js';

const VW = 640, VH = 360;

const ANIM_FOR = {                       // state → atlas anim
  spawn: 'spawn', idle: 'stand', walk: 'run', air: 'run',
  slide: 'slide', duck: 'duck',
  hit: 'hit', ded: 'dead',
};

const wrap = (v, m) => ((v % m) + m) % m;   // JS % keeps the sign; scrolling needs it positive

export function makePlay({ atlas, input, save, go }) {
  const level = GAUNTLET;
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
  let won = false;
  // WOW+ escalation: one popup per flight that grows instead of spamming a new
  // popup per event. Counts the WOW+ events banked during the CURRENT flight
  // (reset the frame we land), capped at three '+'.
  let flightWows = 0;
  if (typeof window !== 'undefined' && window.__blast) window.__blast.P = P;  // live tuning hook

  // Draw a full parallax cell with its top-left at (sx, sy). The atlas trims
  // transparent margins, so we go through drawCentered with the cell centre —
  // that re-applies the frame's ox/oy and lands the art where it was authored.
  function drawLayer(ctx, name, sx, sy) {
    const a = atlas.anims[name];
    atlas.drawCentered(ctx, name, a.frames[0], sx + a.cw / 2, sy + a.ch / 2);
  }

  return {
    update(dt) {
      if (input.pressed('retry')) { go('play'); return; }
      const wasAirborne = player.coyote === 0;
      player.update(dt, input.actions(), level, playerBolts);
      // contact gate: hurt() owns damage authority via iframes; the dummy body
      // is a perf skip so overlapping-frame AABB checks stop during the stagger.
      enemies.update(dt, player.iframes > 0 ? { x: -9999, y: -9999, w: 0 } : player.body,
                     enemyBolts, fromX => player.hurt(fromX));
      playerBolts.update(dt, level);
      enemyBolts.update(dt, level);

      playerBolts.forEachHittable(b => {
        const e = enemies.hitTest(b);
        if (!e) return;
        playerBolts.kill(b);
        if (--e.hp > 0) return;
        enemies.kill(e, dead => {
          const airborne = player.coyote === 0;
          score.onKill(airborne);
          player.airCharges = P.AIR_CHARGES;            // kills refill the tank
          popups.spawn(dead.x, dead.y - 30, '+100');
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
      if (player.coyote > 0 && player.body.x > level.w - 48) won = true;   // grounded on the end pad
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

      // (7) player — blink through iframes, but a corpse always stays visible
      const flicker = player.iframes > 0 && player.state !== 'ded' &&
                      Math.floor(player.iframes * 12) % 2;
      if (!flicker) {
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
      ctx.fillStyle = '#e8e0d0';
      ctx.fillText(`${player.state} deaths:${player.deaths}`, 10, 50);
      if (won) {
        ctx.font = '24px monospace'; ctx.textAlign = 'center';
        ctx.fillText('much gauntlet. very win.', VW / 2, 100);
        ctx.textAlign = 'left';
      }
    },

    state: () => ({
      x: player.body.x, y: player.body.y, vx: player.body.vx, vy: player.body.vy,
      pstate: player.state, charges: player.airCharges, deaths: player.deaths,
      hp: player.hp, iframes: player.iframes,
      won, bullets: playerBolts.count(),
      score: score.value(), enemies: enemies.count(), coins: coins.remaining(),
    }),
  };
}
