// Devices → abstract action states. The sim reads ONLY actions().
// A virtual source (input tape) can override devices — that's how E2E drives
// the game deterministically from inside the fixed-step loop.
// preventDefault fires window-wide for mapped keys; add a target guard if text inputs ever exist.
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down',
  KeyX: 'fire', KeyZ: 'fire', Space: 'fire',
  Escape: 'pause', KeyR: 'retry', KeyM: 'mute', F1: 'debug',
};
const ACTIONS = ['left', 'right', 'down', 'fire', 'pause', 'retry', 'mute', 'debug'];

export function createInput(target = window) {
  const held = Object.fromEntries(ACTIONS.map(a => [a, false]));
  const prev = { ...held };
  let virtual = null;                       // {left,right,down,fire} or null

  target.addEventListener('keydown', e => {
    const a = KEYMAP[e.code];
    if (a) { held[a] = true; e.preventDefault(); }
  });
  target.addEventListener('keyup', e => {
    const a = KEYMAP[e.code];
    if (a) { held[a] = false; e.preventDefault(); }
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
    endFrame() { Object.assign(prev, this.actions()); },
    actions() {
      const a = { ...held };
      a.left ||= pad.left; a.right ||= pad.right; a.down ||= pad.down; a.fire ||= pad.fire;
      return virtual ? { ...a, ...virtual } : a;
    },
    held(a) { return this.actions()[a]; },
    pressed(a) { return this.actions()[a] && !prev[a]; },
  };
}
