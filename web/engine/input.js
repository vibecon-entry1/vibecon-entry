// Devices → abstract action states. The sim reads ONLY actions().
// A virtual source (input tape) can override devices — that's how E2E drives
// the game deterministically from inside the fixed-step loop.
// preventDefault fires window-wide for mapped keys; add a target guard if text inputs ever exist.
//
// A code may map to SEVERAL actions (array form). KeyD is the only one today:
// it is WASD's `right` and it is also the display toggle, because the title
// screen — the only scene that reads `display` — has no notion of walking
// right, so the two can never both mean something at once. The array form
// costs one loop here and avoids inventing a second, worse key for a setting
// the player is told about by name on the title screen.
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: ['right', 'display'],
  ArrowDown: 'down', KeyS: 'down',
  KeyX: 'fire', KeyZ: 'fire', Space: 'fire',
  Escape: 'pause', KeyR: 'retry', KeyM: 'mute', F1: 'debug',
  // W is the one WASD key with no movement meaning (there is no 'up' action —
  // the verb goes UP by shooting DOWN), which makes it the natural free key for
  // the title screen's WOW ZONE entry. Unlike KeyD it needs no array form: only
  // one action ever claims it.
  KeyW: 'wowzone',
};
const ACTIONS = ['left', 'right', 'down', 'fire', 'pause', 'retry', 'mute', 'debug',
                 'display', 'wowzone'];
const actionsFor = (code) => {
  const a = KEYMAP[code];
  return a == null ? null : (Array.isArray(a) ? a : [a]);
};

export function createInput(target = window) {
  const held = Object.fromEntries(ACTIONS.map(a => [a, false]));
  const prev = { ...held };
  // Keydowns seen SINCE the last endFrame, whether or not the key is still
  // down when the frame reads it. `held` alone cannot answer "was this key
  // touched during this frame": a press and its release can both arrive inside
  // one 16ms gap, and then no frame ever observes a true. Cleared in
  // endFrame(), so it is a strictly per-frame record.
  const tap = {};
  let virtual = null;                       // {left,right,down,fire} or null

  target.addEventListener('keydown', e => {
    const as = actionsFor(e.code);
    if (as) { for (const a of as) { held[a] = true; tap[a] = true; } e.preventDefault(); }
  });
  target.addEventListener('keyup', e => {
    const as = actionsFor(e.code);
    if (as) { for (const a of as) held[a] = false; e.preventDefault(); }
  });

  const pad = { left: false, right: false, down: false, fire: false };

  function pollGamepad() {
    const gp = navigator.getGamepads?.()?.[0];
    if (!gp) { pad.left = pad.right = pad.down = pad.fire = false; return; }
    const ax = gp.axes[0] ?? 0;
    pad.left = !!(gp.buttons[14]?.pressed || ax < -0.4);
    pad.right = !!(gp.buttons[15]?.pressed || ax > 0.4);
    pad.down = !!(gp.buttons[13]?.pressed || (gp.axes[1] ?? 0) > 0.5);
    pad.fire = !!gp.buttons[0]?.pressed;
  }

  return {
    setVirtual(v) { virtual = v; },         // null to release
    beginFrame() { pollGamepad(); },
    endFrame() { Object.assign(prev, this.actions()); for (const k in tap) delete tap[k]; },
    actions() {
      const a = { ...held };
      a.left ||= pad.left; a.right ||= pad.right; a.down ||= pad.down; a.fire ||= pad.fire;
      return virtual ? { ...a, ...virtual } : a;
    },
    held(a) { return this.actions()[a]; },
    /** Held right now OR pressed at any point during this frame. */
    touched(a) { return !!(this.actions()[a] || tap[a]); },
    // Edge, tap-inclusive: a press that arrived and released inside the SAME
    // frame still reads as an edge exactly once (tap is cleared in endFrame,
    // and prev never sees it, so it cannot repeat).
    pressed(a) { return this.touched(a) && !prev[a]; },
  };
}
