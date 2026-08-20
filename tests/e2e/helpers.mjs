// Shared e2e helpers. boot() collects console+pageerror, waits for ready AND
// idle pstate (the sim settles before a tape starts driving it); runTape()
// plays a frame-indexed tape (see the idiom note in verb.spec.js) against the
// CURRENT frame and waits for it to finish.
//
// Not every boot.spec.js test can use boot() as-is — see the per-test notes
// there. Only tests that (a) want ready+idle and (b) want the combined
// console+pageerror error list should adopt it.

export async function boot(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8123/');
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
