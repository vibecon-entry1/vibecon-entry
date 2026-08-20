// Touch-drive helpers for the mobile project. Playwright's page.touchscreen
// only taps; drags and multi-finger chords go through CDP's
// Input.dispatchTouchEvent, which produces REAL browser touch input (pointer
// events included) rather than synthetic DOM events. touchPoints is the
// active set AFTER the event: adding a point to a touchStart puts a finger
// down, omitting one from a touchEnd lifts it.
export async function touchRig(page) {
  const cdp = await page.context().newCDPSession(page);
  const r = await page.evaluate(() => {
    const b = document.getElementById('screen').getBoundingClientRect();
    return { left: b.left, top: b.top, w: b.width, h: b.height };
  });
  // Virtual 640x360 coords → CSS client coords, same mapping main.js inverts.
  const css = (vx, vy) => ({ x: Math.round(r.left + vx * r.w / 640),
                             y: Math.round(r.top + vy * r.h / 360) });
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([vx, vy, id]) => ({ ...css(vx, vy), id })),
  });
  return {
    css, send,
    tap: async (vx, vy) => {
      const p = css(vx, vy);
      await page.touchscreen.tap(p.x, p.y);
    },
    // A thumb-realistic tap for GAME actions: ~100ms down, then all fingers
    // up (single-finger use only). The instant tap above is fine for UI
    // (edges are tap-inclusive) but the sim reads held actions once per 16ms
    // frame, and a 1ms machine tap can fall between two reads — a real
    // finger never does.
    hold: async (vx, vy, id, ms = 100) => {
      await send('touchStart', [[vx, vy, id]]);
      await page.waitForTimeout(ms);
      await send('touchEnd', []);
    },
    // A drag that lands in steps, so the deadzone logic sees real motion.
    drag: async (id, [x0, y0], [x1, y1], steps = 4) => {
      await send('touchStart', [[x0, y0, id]]);
      for (let i = 1; i <= steps; i++)
        await send('touchMove', [[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, id]]);
    },
    endAll: () => send('touchEnd', []),
  };
}

export const st = (page) => page.evaluate(() => window.__blast.state());
