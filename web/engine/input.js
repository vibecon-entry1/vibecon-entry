// Devices → abstract action states. The sim reads ONLY actions().
// A virtual source (input tape) can override devices — that's how E2E drives
// the game deterministically from inside the fixed-step loop.
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down',
  KeyX: 'fire', KeyZ: 'fire', Space: 'fire',
  Escape: 'pause', KeyR: 'retry', F1: 'debug',
};
const ACTIONS = ['left', 'right', 'down', 'fire', 'pause', 'retry', 'debug'];

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

  function pollGamepad() {
    const gp = navigator.getGamepads?.()[0];
    if (!gp) return;
    const ax = gp.axes[0] ?? 0;
    held.left ||= gp.buttons[14]?.pressed || ax < -0.4;
    held.right ||= gp.buttons[15]?.pressed || ax > 0.4;
    held.down ||= gp.buttons[13]?.pressed || (gp.axes[1] ?? 0) > 0.5;
    held.fire ||= gp.buttons[0]?.pressed;
  }

  return {
    setVirtual(v) { virtual = v; },         // null to release
    beginFrame() { pollGamepad(); },
    endFrame() { Object.assign(prev, this.actions()); },
    actions() { return virtual ? { ...held, ...virtual } : { ...held }; },
    held(a) { return this.actions()[a]; },
    pressed(a) { return this.actions()[a] && !prev[a]; },
  };
}
