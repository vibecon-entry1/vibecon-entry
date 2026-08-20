// Shared e2e helpers. boot() collects console+pageerror, waits for ready AND
// idle pstate (the sim settles before a tape starts driving it); runTape()
// plays a frame-indexed tape (see the idiom note in verb.spec.js) against the
// CURRENT frame and waits for it to finish.
//
// Not every boot.spec.js test can use boot() as-is — see the per-test notes
// there. Only tests that (a) want ready+idle and (b) want the combined
// console+pageerror error list should adopt it.
//
// CALIBRATION GOTCHA: an offline node harness starts at its own frame 0 in the
// spawn pose, but boot() waits ~117 frames past spawn into idle before tapes
// start. Event-relative timings (hits, kills) drift by that much between the
// two — calibrate final tapes against the REAL page, not the harness alone.

export async function boot(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  // '?test' — the test-mode boot: skips the title/intro cards and drops
  // straight into play, so every calibrated tape below starts on gameplay
  // frame 0 instead of behind three keypresses. It also arms play.js's cheats.
  await page.goto('http://localhost:8123/?test');
  await page.waitForFunction(() => window.__blast?.ready === true, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__blast.state().pstate === 'idle', null, { timeout: 15000 });
  return errors;
}

export async function runTape(page, tape, doneMs = 15000) {
  await page.evaluate(t => {
    const base = window.__blast.frame;
    window.__blast.playTape(t.map(e => ({ f: base + e.f, a: e.a })));
  }, tape);
  await page.waitForFunction(() => window.__blast.tapeDone(), null, { timeout: doneMs });
}
