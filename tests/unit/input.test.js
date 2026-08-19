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
