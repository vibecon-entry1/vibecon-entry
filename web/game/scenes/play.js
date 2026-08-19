// Graybox play: GB1 + player + bullets + camera + debug HUD (pips, state).
import { GB1, TILE } from '../chunks.js';
import { makePlayer } from '../player.js';
import { makeBullets } from '../bullets.js';
import { makeCamera } from '../../engine/camera.js';
import { animFrame } from '../../engine/assets.js';
import { P } from '../physics.js';

const ANIM_FOR = {                       // state → atlas anim
  spawn: 'spawn', idle: 'stand', walk: 'run', air: 'run',
  slide: 'slide', duck: 'duck',
};

export function makePlay({ atlas, input, save, go }) {
  const level = GB1;
  const player = makePlayer(level.spawn);
  const bullets = makeBullets();
  const cam = makeCamera({ vw: 640, vh: 360 });
  cam.snap(0, Math.max(0, level.h - 360));
  let won = false;
  if (typeof window !== 'undefined' && window.__blast) window.__blast.P = P;  // live tuning hook

  return {
    update(dt) {
      if (input.pressed('retry')) { go('play'); return; }
      player.update(dt, input.actions(), level, bullets);
      bullets.update(dt, level);
      cam.follow(player.body.x, player.body.y, player.facing, dt, level);
      if (player.coyote > 0 && player.body.x > level.w - 48) won = true;   // grounded on the end pad (Plan 2: real ship)
    },
    render(ctx) {
      ctx.save(); cam.apply(ctx);
      // graybox tiles
      ctx.fillStyle = '#3a2f3f';
      for (let ty = 0; ty < level.hTiles; ty++)
        for (let tx = 0; tx < level.wTiles; tx++)
          if (level.solidAt(tx, ty)) ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      // checkpoints
      ctx.fillStyle = '#2c8';
      for (const c of level.checkpoints) ctx.fillRect(c.x - 2, c.y - 24, 4, 24);
      // player
      const anim = ANIM_FOR[player.state];
      atlas.drawFeet(ctx, anim, animFrame(atlas.anims[anim], player.stateT),
                     player.body.x, player.body.y, player.facing < 0);
      // muzzle flash at the recorded shot origin (mirrored for leftward shots)
      if (player.muzzle) {
        const m = player.muzzle;
        ctx.save();
        if (m.dx < 0) { ctx.translate(m.x, m.y); ctx.scale(-1, 1); ctx.translate(-m.x, -m.y); }
        atlas.drawCentered(ctx, 'blast_muzzle',
          animFrame(atlas.anims.blast_muzzle, m.t), m.x, m.y,
          m.dy ? Math.PI / 2 : 0);
        ctx.restore();
      }
      bullets.render(ctx, atlas);
      ctx.restore();
      // debug HUD: air-charge pips + state + won banner
      for (let i = 0; i < P.AIR_CHARGES; i++) {
        ctx.fillStyle = i < player.airCharges ? '#5cf' : '#334';
        ctx.fillRect(10 + i * 12, 10, 8, 12);
      }
      ctx.fillStyle = '#e8e0d0'; ctx.font = '10px monospace';
      ctx.fillText(`${player.state} deaths:${player.deaths}`, 10, 36);
      if (won) { ctx.font = '24px monospace'; ctx.fillText('much graybox. very win.', 200, 100); }
    },
    state: () => ({
      x: player.body.x, y: player.body.y, vx: player.body.vx, vy: player.body.vy,
      pstate: player.state, charges: player.airCharges, deaths: player.deaths,
      won, bullets: bullets.count(),
    }),
  };
}
