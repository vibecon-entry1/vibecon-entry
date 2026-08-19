// Tuning constants (the M2 feel-gate surface) + axis-separated AABB vs tiles.
// Body: x = center, y = FEET. Max speeds keep displacement < TILE per step.
import { TILE } from './chunks.js';

export const P = {
  GRAV: 900, MAX_FALL: 560,
  RUN: 150, RUN_ACCEL: 1400, FRICTION: 1600,
  HOP_VY: -290, BOOST_VY: -320, BURST_VX: 130,
  COYOTE: 0.09, AIR_CHARGES: 3, FIRE_CD: 0.12,
  SLIDE_MIN: 0.25, SLIDE_SPEED: 200, SLIDE_DECAY: 260,
};

const EPS = 0.001;

export function moveAndCollide(b, level, dt) {
  const out = { onGround: false, hitCeil: false, hitWall: false };
  const t = v => Math.floor(v / TILE);

  // X axis
  let nx = b.x + b.vx * dt;
  const top = () => b.y - b.h + EPS, bot = () => b.y - EPS;
  if (b.vx > 0) {
    const edge = nx + b.w / 2, tx = t(edge);
    for (let ty = t(top()); ty <= t(bot()); ty++)
      if (level.solidAt(tx, ty)) { nx = tx * TILE - b.w / 2; b.vx = 0; out.hitWall = true; break; }
  } else if (b.vx < 0) {
    const edge = nx - b.w / 2, tx = t(edge);
    for (let ty = t(top()); ty <= t(bot()); ty++)
      if (level.solidAt(tx, ty)) { nx = (tx + 1) * TILE + b.w / 2; b.vx = 0; out.hitWall = true; break; }
  }
  b.x = nx;

  // Y axis
  let ny = b.y + b.vy * dt;
  const left = t(b.x - b.w / 2 + EPS), right = t(b.x + b.w / 2 - EPS);
  if (b.vy > 0) {
    const ty = t(ny);
    for (let tx = left; tx <= right; tx++)
      if (level.solidAt(tx, ty)) { ny = ty * TILE; b.vy = 0; out.onGround = true; break; }
  } else if (b.vy < 0) {
    const ty = t(ny - b.h);
    for (let tx = left; tx <= right; tx++)
      if (level.solidAt(tx, ty)) { ny = (ty + 1) * TILE + b.h; b.vy = 0; out.hitCeil = true; break; }
  } else {
    // resting check: probe one EPS below feet
    const ty = t(b.y + EPS);
    for (let tx = left; tx <= right; tx++)
      if (level.solidAt(tx, ty)) { out.onGround = true; break; }
  }
  b.y = ny;
  return out;
}
