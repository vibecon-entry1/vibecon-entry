// Spinning $ELON coins with a small magnet radius. Entity y is feet-anchored;
// the coin hovers 6px above it. Scene draws via drawCentered at (c.x, c.y).
const MAGNET = 40, COLLECT = 14, PULL = 260;

export function makeCoins(defs) {
  const list = defs.filter(d => d.type === 'coin')
    .map(d => ({ x: d.x, y: d.y - 6, t: (d.x % 7) / 10, on: true }));
  return {
    update(dt, playerBody, onCollect) {
      for (const c of list) {
        if (!c.on) continue;
        c.t += dt;
        const dx = playerBody.x - c.x, dy = (playerBody.y - 22) - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist < COLLECT) { c.on = false; onCollect(c); continue; }
        if (dist < MAGNET) { c.x += (dx / dist) * PULL * dt; c.y += (dy / dist) * PULL * dt; }
      }
    },
    forEach(fn) { for (const c of list) if (c.on) fn(c); },
    remaining() { return list.filter(c => c.on).length; },
    // Authored coin count. The win screen needs "how many did you get", and the
    // only honest way to say that is total - remaining: the level's coin budget
    // moved (50 -> 151 across the chunk expansion) and a literal in the scene
    // silently went negative.
    total() { return list.length; },
  };
}
