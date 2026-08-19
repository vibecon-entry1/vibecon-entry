// Fixed-timestep loop. Sim always steps at exactly `hz`; rendering happens once
// per rAF. Pure accumulator logic is exported for tests.
export const MAX_DELTA = 0.1;

export function stepAccumulator(state, delta, dt) {
  state.acc += Math.min(delta, MAX_DELTA);
  let steps = 0;
  while (state.acc >= dt) { state.acc -= dt; steps++; }
  return steps;
}

export function createLoop({ update, render, hz = 60 }) {
  const dt = 1 / hz;
  const state = { acc: 0 };
  let last = 0, raf = 0, running = false, frame = 0;
  function tick(now) {
    if (!running) return;
    const delta = last ? (now - last) / 1000 : dt;
    last = now;
    const steps = stepAccumulator(state, delta, dt);
    for (let i = 0; i < steps; i++) { update(dt, frame); frame++; }
    render();
    raf = requestAnimationFrame(tick);
  }
  return {
    start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); },
    get frame() { return frame; },
  };
}
