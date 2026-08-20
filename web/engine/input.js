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

  // Touch source. Merged into actions() exactly like the gamepad — the sim
  // never learns which device a `left` came from. NOT routed through
  // setVirtual: that channel belongs to test tapes, and a live thumb fighting
  // a tape would corrupt every calibrated run.
  //
  // Zones split the canvas at VW/2 in VIRTUAL pixels (the same 640-wide space
  // every scene draws in): left half is a floating stick — drag from the touch
  // origin resolves to left/right/down — and the right half is FIRE, with a
  // downward drag adding `down` so hop/boost stay one-thumb moves.
  const MOVE_SPLIT = 320;                   // VW / 2
  const MOVE_DEAD = 12;                     // virtual px before a drag means left/right
  const DOWN_DRAG = 18;                     // virtual px of downward drag that means `down`
  const TAP_SLOP = 24;                      // total travel beyond this is a drag, not a tap
  const touch = { left: false, right: false, down: false, fire: false };
  let touchSeen = false;
  const uiTaps = [];                        // completed taps (virtual coords), per frame
  const track = new Map();                  // pointerId → {ox,oy,x,y,zone,claimed,moved}

  function attachTouch(el, { toVirtual, claim } = {}) {
    const recompute = () => {
      const next = { left: false, right: false, down: false, fire: false };
      for (const p of track.values()) {
        if (p.claimed) continue;
        const dx = p.x - p.ox, dy = p.y - p.oy;
        if (p.zone === 'move') {
          if (dx < -MOVE_DEAD) next.left = true;
          else if (dx > MOVE_DEAD) next.right = true;
          if (dy > DOWN_DRAG) next.down = true;
        } else {
          next.fire = true;
          if (dy > DOWN_DRAG) next.down = true;
        }
      }
      // Rising edges feed the tap record, same as a keydown: a touch that
      // begins and ends inside one 16ms gap must still read as pressed() once.
      for (const k in next) {
        if (next[k] && !touch[k]) tap[k] = true;
        touch[k] = next[k];
      }
    };
    el.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;   // mouse keeps its click semantics
      e.preventDefault();                      // no synthesized click, no dbl-tap zoom
      const v = toVirtual(e.clientX, e.clientY);
      if (!v) return;
      touchSeen = true;
      // The shell gets first refusal (its buttons live inside the fire zone).
      // A string return injects that action's tap; any truthy return removes
      // the pointer from game-action duty for its whole lifetime.
      const claimed = claim?.(v);
      if (typeof claimed === 'string') tap[claimed] = true;
      track.set(e.pointerId, { ox: v.x, oy: v.y, x: v.x, y: v.y, moved: 0,
                               claimed: !!claimed,
                               zone: v.x < MOVE_SPLIT ? 'move' : 'fire' });
      // Capture keeps a drag alive past the canvas edge. Throws for pointers
      // the browser no longer holds active (synthetic events, ended taps) —
      // harmless either way, so it must never abort the handler.
      try { el.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
      recompute();
    });
    el.addEventListener('pointermove', e => {
      const p = track.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const v = toVirtual(e.clientX, e.clientY);
      if (!v) return;
      p.x = v.x; p.y = v.y;
      p.moved = Math.max(p.moved, Math.hypot(v.x - p.ox, v.y - p.oy));
      recompute();
    });
    const release = e => {
      const p = track.get(e.pointerId);
      if (!p) return;
      const v = toVirtual(e.clientX, e.clientY);
      if (v) { p.x = v.x; p.y = v.y; }        // lift point: taps report where the finger left
      // Only a clean pointerup that never travelled counts as a UI tap —
      // pointercancel and drags are not "the player poked that spot".
      if (e.type === 'pointerup' && !p.claimed && p.moved <= TAP_SLOP)
        uiTaps.push({ x: p.x, y: p.y });
      track.delete(e.pointerId);
      recompute();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

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
    attachTouch,
    // Everything the shell needs to draw touch affordances, and nothing the
    // sim could want: the sim keeps reading actions() only.
    touchState() {
      const pointers = [];
      for (const p of track.values())
        if (!p.claimed) pointers.push({ zone: p.zone, ox: p.ox, oy: p.oy, x: p.x, y: p.y });
      return { seen: touchSeen, pointers };
    },
    /** Taps that completed THIS frame (virtual coords). Cleared in endFrame. */
    taps() { return uiTaps; },
    /** Allocation-free "has a finger ever landed" — polled every frame by the shell. */
    touchSeen() { return touchSeen; },
    beginFrame() { pollGamepad(); },
    endFrame() {
      Object.assign(prev, this.actions());
      for (const k in tap) delete tap[k];
      uiTaps.length = 0;
    },
    actions() {
      const a = { ...held };
      a.left ||= pad.left || touch.left; a.right ||= pad.right || touch.right;
      a.down ||= pad.down || touch.down; a.fire ||= pad.fire || touch.fire;
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
