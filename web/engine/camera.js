// Camera: exponential follow + facing lookahead + vertical deadzone + shake.
export function makeCamera({ vw, vh, lookahead = 40, kx = 8, ky = 6, deadY = 24 }) {
  const cam = {
    x: 0, y: 0, shakeT: 0, shakeMag: 0,
    snap(x, y) { cam.x = x; cam.y = y; },
    follow(tx, ty, facing, dt, bounds) {
      const gx = tx + facing * lookahead - vw / 2;
      cam.x += (gx - cam.x) * (1 - Math.exp(-kx * dt));
      const gy = ty - vh / 2;
      const dy = gy - cam.y;
      if (Math.abs(dy) > deadY) cam.y += (dy - Math.sign(dy) * deadY) * (1 - Math.exp(-ky * dt));
      cam.x = Math.min(Math.max(cam.x, 0), Math.max(0, bounds.w - vw));
      cam.y = Math.min(Math.max(cam.y, 0), Math.max(0, bounds.h - vh));
      if (cam.shakeT > 0) cam.shakeT -= dt;
    },
    shake(mag, dur) { cam.shakeMag = mag; cam.shakeT = dur; },
    apply(ctx, rng = Math.random) {
      const s = cam.shakeT > 0 ? cam.shakeMag * (cam.shakeT * 4) : 0;
      ctx.translate(-Math.round(cam.x + (rng() - 0.5) * s), -Math.round(cam.y + (rng() - 0.5) * s));
    },
  };
  return cam;
}
