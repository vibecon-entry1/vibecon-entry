import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../../web/engine/input.js';

function fakeWindow() {
  const listeners = {};
  return {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    fire(type, code) {
      let prevented = false;
      for (const fn of listeners[type] ?? []) fn({ code, preventDefault: () => { prevented = true; } });
      return prevented;
    },
  };
}

function stubGamepad(pads) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => pads },
    configurable: true,
  });
}

test('keyboard press/release round-trip; unmapped untouched', () => {
  const w = fakeWindow();
  const input = createInput(w);
  assert.equal(w.fire('keydown', 'ArrowRight'), true);      // mapped → preventDefault
  assert.equal(input.actions().right, true);
  w.fire('keyup', 'ArrowRight');
  assert.equal(input.actions().right, false);
  assert.equal(w.fire('keydown', 'KeyQ'), false);           // unmapped → no preventDefault
});

test('gamepad press AND release round-trip (latch regression)', () => {
  const w = fakeWindow();
  const input = createInput(w);
  const gp = { axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  stubGamepad([gp]);
  gp.buttons[14].pressed = true;
  input.beginFrame();
  assert.equal(input.actions().left, true);
  gp.buttons[14].pressed = false;
  input.beginFrame();
  assert.equal(input.actions().left, false);                // must clear on release
  gp.buttons[0].pressed = true;
  input.beginFrame();
  assert.equal(input.actions().fire, true);
  gp.buttons[0].pressed = false;
  input.beginFrame();
  assert.equal(input.actions().fire, false);
  stubGamepad([null]);                                      // pad unplugged
  input.beginFrame();
  assert.equal(input.actions().left, false);
  delete globalThis.navigator;
});

test('virtual override wins; no phantom edge after tape release', () => {
  const w = fakeWindow();
  const input = createInput(w);
  const gp = { axes: [-1, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  stubGamepad([gp]);
  input.beginFrame();
  assert.equal(input.actions().left, true);                 // stick held left
  input.setVirtual({ left: false });
  assert.equal(input.actions().left, false);                // tape wins over live pad
  gp.axes[0] = 0;                                           // stick released during tape
  input.beginFrame();
  input.setVirtual(null);                                   // tape ends
  input.endFrame();
  input.beginFrame();
  assert.equal(input.actions().left, false);                // no phantom revival
  assert.equal(input.pressed('left'), false);
  delete globalThis.navigator;
});

test('pressed edge: true first frame only, held persists', () => {
  const w = fakeWindow();
  const input = createInput(w);
  w.fire('keydown', 'KeyX');
  assert.equal(input.pressed('fire'), true);
  input.endFrame();
  assert.equal(input.pressed('fire'), false);
  assert.equal(input.held('fire'), true);
});

test('a press and release inside ONE frame is still seen exactly once', () => {
  // The fixed loop reads devices once per frame. A 10ms tap can begin and end
  // between two of those reads, and `held` is false again by the time anyone
  // looks — which is how a keystroke goes missing with nothing to blame.
  const w = fakeWindow();
  const input = createInput(w);
  w.fire('keydown', 'KeyX');
  w.fire('keyup', 'KeyX');
  assert.equal(input.held('fire'), false);      // nothing is down any more...
  assert.equal(input.touched('fire'), true);    // ...but the frame saw it
  assert.equal(input.pressed('fire'), true);
  input.endFrame();
  assert.equal(input.touched('fire'), false);   // and it does not linger
  assert.equal(input.pressed('fire'), false);
});

test('touched does not fire twice for one held key across frames', () => {
  const w = fakeWindow();
  const input = createInput(w);
  w.fire('keydown', 'KeyX');
  assert.equal(input.pressed('fire'), true);
  input.endFrame();
  assert.equal(input.touched('fire'), true);    // still down
  assert.equal(input.pressed('fire'), false);   // but no second edge
});

// --- touch source -----------------------------------------------------------
// The fake element speaks pointer events the way the canvas does; toVirtual is
// identity so test coords ARE virtual coords (move zone x<320, fire zone x>=320).
function fakeEl() {
  const listeners = {};
  return {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    setPointerCapture() {},
    fire(type, props) {
      for (const fn of listeners[type] ?? [])
        fn({ type, pointerType: 'touch', preventDefault: () => {}, ...props });
    },
  };
}
const idMap = { toVirtual: (x, y) => ({ x, y }) };

function touchRig(opts = {}) {
  const w = fakeWindow();
  const input = createInput(w);
  const el = fakeEl();
  input.attachTouch(el, { ...idMap, ...opts });
  return { w, input, el };
}

test('touch: fire-zone hold merges like a device, clears on release', () => {
  const { input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 200 });
  assert.equal(input.actions().fire, true);
  assert.equal(input.held('fire'), true);
  el.fire('pointerup', { pointerId: 1, clientX: 400, clientY: 200 });
  assert.equal(input.actions().fire, false);
});

test('touch: a tap inside ONE frame still reads pressed exactly once', () => {
  const { input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 200 });
  el.fire('pointerup', { pointerId: 1, clientX: 400, clientY: 200 });
  assert.equal(input.held('fire'), false);
  assert.equal(input.pressed('fire'), true);
  input.endFrame();
  assert.equal(input.pressed('fire'), false);
});

test('touch: move-zone drag — deadzone, direction, down threshold', () => {
  const { input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 200 });
  assert.equal(input.actions().right, false);               // origin: no intent yet
  el.fire('pointermove', { pointerId: 1, clientX: 108, clientY: 200 });
  assert.equal(input.actions().right, false);               // inside the 12px deadzone
  el.fire('pointermove', { pointerId: 1, clientX: 120, clientY: 200 });
  assert.equal(input.actions().right, true);
  el.fire('pointermove', { pointerId: 1, clientX: 120, clientY: 230 });
  assert.equal(input.actions().right, true);                // down-forward = slide intent
  assert.equal(input.actions().down, true);
  el.fire('pointermove', { pointerId: 1, clientX: 80, clientY: 200 });
  assert.equal(input.actions().left, true);
  assert.equal(input.actions().down, false);
  el.fire('pointerup', { pointerId: 1, clientX: 80, clientY: 200 });
  assert.deepEqual([input.actions().left, input.actions().right], [false, false]);
});

test('touch: fire-zone drag down while holding adds down (hop/boost chord)', () => {
  const { input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, clientX: 500, clientY: 180 });
  el.fire('pointermove', { pointerId: 1, clientX: 500, clientY: 210 });
  assert.equal(input.actions().fire, true);
  assert.equal(input.actions().down, true);
});

test('touch: two pointers plus keyboard combine into one action set', () => {
  const { w, input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 200 });
  el.fire('pointermove', { pointerId: 1, clientX: 140, clientY: 200 });
  el.fire('pointerdown', { pointerId: 2, clientX: 500, clientY: 200 });
  w.fire('keydown', 'ArrowDown');
  const a = input.actions();
  assert.deepEqual([a.right, a.fire, a.down], [true, true, true]);
  el.fire('pointerup', { pointerId: 2, clientX: 500, clientY: 200 });
  assert.equal(input.actions().right, true);                // move thumb survives alone
  assert.equal(input.actions().fire, false);
});

test('touch: claimed pointer feeds the shell action, never the game', () => {
  const { input, el } = touchRig({ claim: v => (v.x > 600 ? 'pause' : false) });
  el.fire('pointerdown', { pointerId: 1, clientX: 620, clientY: 10 });
  assert.equal(input.pressed('pause'), true);
  assert.equal(input.actions().fire, false);                // inside fire zone, but claimed
  el.fire('pointerup', { pointerId: 1, clientX: 620, clientY: 10 });
  assert.equal(input.taps().length, 0);                     // claimed taps are not UI taps
});

test('touch: clean tap lands in taps(); a drag does not; endFrame clears', () => {
  const { input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 200 });
  el.fire('pointerup', { pointerId: 1, clientX: 402, clientY: 203 });
  assert.equal(input.taps().length, 1);
  assert.equal(Math.round(input.taps()[0].x), 402);
  el.fire('pointerdown', { pointerId: 2, clientX: 400, clientY: 200 });
  el.fire('pointermove', { pointerId: 2, clientX: 400, clientY: 280 });
  el.fire('pointerup', { pointerId: 2, clientX: 400, clientY: 280 });
  assert.equal(input.taps().length, 1);                     // the drag added nothing
  input.endFrame();
  assert.equal(input.taps().length, 0);
});

test('touch: mouse pointers never reach the touch source', () => {
  const { input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 200 });
  assert.equal(input.actions().fire, false);
});

test('touch: pointercancel releases held actions and records no tap', () => {
  const { input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 200 });
  assert.equal(input.actions().fire, true);
  el.fire('pointercancel', { pointerId: 1, clientX: 400, clientY: 200 });
  assert.equal(input.actions().fire, false);
  assert.equal(input.taps().length, 0);
});

test('touch: a held touch keeps touched() true across frames (afk presence)', () => {
  const { input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 200 });
  input.endFrame();
  assert.equal(input.touched('fire'), true);                // idle clock reads this
  assert.equal(input.pressed('fire'), false);
});

test('touch: virtual tape still overrides a live thumb', () => {
  const { input, el } = touchRig();
  el.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 200 });
  input.setVirtual({ fire: false });
  assert.equal(input.actions().fire, false);
  input.setVirtual(null);
  assert.equal(input.actions().fire, true);
});

test('touch: a finger inside the deadzone is still presence (afk clock)', () => {
  const { input, el } = touchRig();
  assert.equal(input.touchActive(), false);
  el.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 200 });
  el.fire('pointermove', { pointerId: 1, clientX: 104, clientY: 200 });
  const a = input.actions();
  assert.deepEqual([a.left, a.right, a.down, a.fire],
                   [false, false, false, false]);          // no intent yet...
  assert.equal(input.touchActive(), true);                 // ...but somebody is there
  el.fire('pointerup', { pointerId: 1, clientX: 104, clientY: 200 });
  assert.equal(input.touchActive(), true);                 // the completed tap counts this frame
  input.endFrame();
  assert.equal(input.touchActive(), false);
});
