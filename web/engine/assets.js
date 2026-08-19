// Atlas loading + animation math + the two draw anchors (feet / centered).
export function animFrame(anim, t) {
  const n = anim.frames.length;
  const i = Math.floor(t * anim.fps);
  return anim.frames[anim.loop ? i % n : Math.min(i, n - 1)];
}

export function animDone(anim, t) {
  return !anim.loop && t * anim.fps >= anim.frames.length;
}

async function fetchRetry(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (r.ok) return r;
      err = new Error(`${r.status} ${url}`);
    } catch (e) { err = e; } finally { clearTimeout(timer); }
    if (i < tries - 1) await new Promise(res => setTimeout(res, 300 * (i + 1)));
  }
  throw err;
}

export async function loadAtlas(base = 'assets/') {
  const meta = await (await fetchRetry(base + 'atlas.json')).json();
  const blob = await (await fetchRetry(base + 'atlas.png')).blob();
  const img = await createImageBitmap(blob);
  return new Atlas(img, meta);
}

export class Atlas {
  constructor(img, meta) {
    this.img = img;
    this.frames = meta.frames;
    this.anims = meta.anims;
  }
  // x,y = feet point (bottom-center of native cell). flip mirrors horizontally.
  drawFeet(ctx, animName, frameIdx, x, y, flip = false) {
    const a = this.anims[animName], f = this.frames[frameIdx];
    const dx = f.ox - a.cw / 2, dy = f.oy - a.feetY;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(this.img, f.x, f.y, f.w, f.h, Math.round(dx), Math.round(dy), f.w, f.h);
    ctx.restore();
  }
  // x,y = cell center. rot in radians (0 / ±PI/2 stay pixel-crisp).
  drawCentered(ctx, animName, frameIdx, x, y, rot = 0) {
    const a = this.anims[animName], f = this.frames[frameIdx];
    const dx = f.ox - a.cw / 2, dy = f.oy - a.ch / 2;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (rot) ctx.rotate(rot);
    ctx.drawImage(this.img, f.x, f.y, f.w, f.h, Math.round(dx), Math.round(dy), f.w, f.h);
    ctx.restore();
  }
}
