// Boot: load atlas → build scenes → fixed loop → integer-scaled blit.
import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { loadAtlas } from './engine/assets.js';
import { makeSave } from './engine/save.js';
import { makeJukebox } from './engine/audio.js';
import { stickerStats } from './engine/sticker.js';
import { makeViewer } from './game/scenes/viewer.js';
import { makePlay } from './game/scenes/play.js';
import { makeTitle } from './game/scenes/title.js';
import { makeWin } from './game/scenes/win.js';

export const VW = 640, VH = 360;

const screen = document.getElementById('screen');
const sctx = screen.getContext('2d');
const off = document.createElement('canvas');
off.width = VW; off.height = VH;
const ctx = off.getContext('2d');

// --- display layer ----------------------------------------------------------
// The old fit() sized the canvas in CSS pixels and let the browser upscale the
// backing store to the physical panel. On any HiDPI screen (dpr 2) that meant
// every game pixel was resampled with bilinear smoothing on its way to glass —
// which is exactly the "dull, text blurry on the big screen" report. The fix is
// to size the BACKING STORE in device pixels and shrink it back down in CSS, so
// the browser has nothing left to interpolate.
//
// Two modes, persisted in the save (see save.js DEFAULTS.display):
//   crisp — integer device-pixel scale, letterboxed. Every game pixel is a
//           whole number of hardware pixels. Perfectly sharp; leaves borders.
//   fill  — fractional scale, fills the window on the constrained axis.
//
// SMOOTHING IN FILL MODE, decided by looking at it: at 1500x850 (scale 2.34,
// i.e. 1.37x crisp's 2) the two settings were captured side by side. With
// smoothing ON every glyph and sprite edge picks up a grey-purple halo and the
// whole frame goes soft — the exact "dull" this pass exists to kill. With it
// OFF the only artefact is that some strokes are 2 source-pixels wide and some
// 3, which reads as slightly uneven chunk, not as blur. Nearest wins, so
// imageSmoothingEnabled stays false in BOTH modes. (Screenshots lived in the
// gitignored tests/artifacts/ tree; the conclusion is recorded here because the
// evidence isn't.)
let displayMode = 'crisp';                    // rebound from the save at boot
let scale = 1;                                // device pixels per game pixel

function fit() {
  const dpr = devicePixelRatio || 1;
  // Both branches work in DEVICE pixels: innerWidth is CSS px, so the *dpr is
  // what makes `scale` mean "hardware pixels per game pixel" rather than
  // "CSS pixels per game pixel" (the old, blurry meaning).
  const raw = Math.min(innerWidth * dpr / VW, innerHeight * dpr / VH);
  scale = displayMode === 'fill' ? Math.max(1, raw) : Math.max(1, Math.floor(raw));

  // Backing store in device pixels; CSS box is that divided back by dpr, so the
  // element still occupies the right amount of layout space. round() on the
  // backing store because a canvas dimension must be an integer — in crisp mode
  // scale is already whole and this is a no-op.
  screen.width = Math.round(VW * scale);
  screen.height = Math.round(VH * scale);
  screen.style.width = `${screen.width / dpr}px`;
  screen.style.height = `${screen.height / dpr}px`;
  // Resizing a canvas resets its whole 2D state, smoothing flag included — this
  // has to be re-asserted after EVERY fit(), not once at boot.
  sctx.imageSmoothingEnabled = false;
  armDprWatch(dpr);
}

// devicePixelRatio changes with no resize event when a window is dragged between
// monitors, or the OS zoom changes. matchMedia on the CURRENT ratio fires once
// when it stops being true, so the listener is re-armed against the new ratio
// each time — a single static query would only ever catch the first change.
let dprMql = null;
function armDprWatch(dpr) {
  if (dprMql?.dpr === dpr) return;            // already watching this ratio
  dprMql?.mql.removeEventListener?.('change', fit);
  const mql = matchMedia(`(resolution: ${dpr}dppx)`);
  mql.addEventListener?.('change', fit);
  dprMql = { dpr, mql };
}

/** Switch modes and re-fit. Returns the new mode; caller owns persistence. */
function setDisplay(mode) {
  displayMode = mode === 'fill' ? 'fill' : 'crisp';
  fit();
  return displayMode;
}

addEventListener('resize', fit); fit();
// ----------------------------------------------------------------------------

// --- shell layer ------------------------------------------------------------
// Chrome that belongs to the PAGE, not to any scene: it is drawn onto the same
// 640x360 offscreen canvas AFTER scene.render(), so it scales with the integer
// blit and sits at the same pixel grid as everything else. A DOM overlay would
// have been less code and would have looked like a web page bolted to a game.
//
// The hit rect is the plate (22x20), deliberately larger than the 16x14 icon —
// a speaker glyph that small is a dartboard on a touchscreen otherwise.
const MUTE_BTN = { x: 615, y: 3, w: 22, h: 20 };
const ICON_X = 618, ICON_Y = 6;          // icon origin inside the plate

function drawSoundButton(ctx, muted) {
  ctx.fillStyle = 'rgba(11,11,18,0.55)';
  ctx.fillRect(MUTE_BTN.x, MUTE_BTN.y, MUTE_BTN.w, MUTE_BTN.h);

  const cy = ICON_Y + 7;                 // icon vertical centre (y = 13)
  // Driver box + cone, drawn as integer rect columns rather than a path: the
  // world canvas has imageSmoothingEnabled=false and a stroked triangle here
  // would be the one soft-edged thing on screen.
  ctx.fillStyle = muted ? '#6f6a86' : '#e8e0d0';
  ctx.fillRect(ICON_X + 1, cy - 2, 4, 4);
  for (let i = 0; i < 4; i++) {
    const h = 3 + i;                     // half-height of the cone at this column
    ctx.fillRect(ICON_X + 5 + i, cy - h, 1, h * 2);
  }

  if (muted) {
    // Slash across the WHOLE glyph, in the palette's damage red — the same
    // colour win.js uses for 'very ouch', so "off" reads the same everywhere.
    // First pass drawn in the page black one pixel down: the slash crosses the
    // near-white speaker body, and without that shadow it half-disappears
    // against it (caught in the visual pass).
    // Two full passes, not one interleaved: the shadow has to be laid down
    // under the WHOLE slash before any red goes on, or each red pixel gets
    // overdrawn by the next column's shadow.
    for (const [dy, col] of [[1, '#0b0b12'], [0, '#e2413f']]) {
      ctx.fillStyle = col;
      for (let i = 0; i < 15; i++)
        ctx.fillRect(ICON_X + i, ICON_Y + 1 + Math.round(i * 11 / 14) + dy, 1, 2);
    }
  } else {
    ctx.fillStyle = '#8fa';               // same green as the title's prompts
    ctx.fillRect(ICON_X + 10, cy - 2, 1, 4);
    ctx.fillRect(ICON_X + 11, cy - 3, 1, 1);
    ctx.fillRect(ICON_X + 11, cy + 2, 1, 1);
    ctx.fillRect(ICON_X + 13, cy - 4, 1, 8);
    ctx.fillRect(ICON_X + 14, cy - 5, 1, 1);
    ctx.fillRect(ICON_X + 14, cy + 4, 1, 1);
  }
}

/** Client coords -> virtual 640x360 coords, or null if the canvas has no box. */
function toVirtual(clientX, clientY) {
  const r = screen.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  // Divide by the RENDERED box, not by the integer scale factor: the canvas is
  // centred by `margin:auto`, so r.left/r.top already carry the letterbox
  // offset, and r.width already carries the scale. One rect read, no bookkeeping
  // that can drift out of sync with fit().
  return { x: (clientX - r.left) * VW / r.width, y: (clientY - r.top) * VH / r.height };
}
// ----------------------------------------------------------------------------

async function boot() {
  // One boot-time read of the ?test flag: it arms the debug scene toggle below
  // AND selects the test entry scene at the bottom. Same flag the play scene's
  // cheats hang off — F1 scene-swapping is a dev affordance, not something a
  // player should be able to trip from the title screen.
  const params = new URLSearchParams(location.search);
  const testMode = params.has('test');
  const input = createInput();
  const save = makeSave(localStorage);
  // The save is only readable once boot() runs, so fit() has already laid the
  // canvas out once in the default crisp mode; this re-fits into the stored one.
  setDisplay(save.data.display);
  // One jukebox for the whole page: scenes come and go, the music doesn't.
  // Silent under ?test — the e2e suite drives play with synthetic key presses,
  // and every one of those is a TRUSTED gesture, so a live jukebox would have
  // 17 specs each streaming a 3MB run track. The real audio path is covered by
  // tests/e2e/audio.spec.js, which boots the plain '/' front door.
  // '?test&music' opts a test-mode boot back INTO real audio: that's how the
  // takeoff/fanfare handoff gets smoke-tested through the cheats, which only
  // exist under ?test. Nothing in the automated suite passes it.
  const jukebox = makeJukebox({ save, enabled: !testMode || params.has('music') });
  // Autoplay policy: nothing can start before a real user gesture, so the first
  // one (whatever it is) releases whatever the title scene already asked for.
  const unlock = () => jukebox.unlock();
  addEventListener('keydown', unlock, { once: true });
  addEventListener('pointerdown', unlock, { once: true });
  // Sound button. ORDERING, traced: a click on the button dispatches
  // pointerdown -> (mouseup) -> click, in that order and always. So the very
  // first click a player ever makes runs the window-level unlock() first and
  // this handler second. Unlock only releases whatever pool the scene already
  // asked for; toggleMute() only flips the mute flag and pushes it onto the
  // live element. They are independent, so first-click-on-the-button does the
  // sane thing: music starts AND immediately goes to muted, and a second click
  // brings it back. No special-casing needed.
  screen.addEventListener('click', e => {
    const v = toVirtual(e.clientX, e.clientY);
    if (!v) return;
    if (v.x >= MUTE_BTN.x && v.x < MUTE_BTN.x + MUTE_BTN.w &&
        v.y >= MUTE_BTN.y && v.y < MUTE_BTN.y + MUTE_BTN.h) jukebox.toggleMute();
  });
  let atlas;
  try {
    atlas = await loadAtlas('assets/');
  } catch (e) {
    document.getElementById('err').style.display = 'block';
    document.getElementById('err').textContent = 'wow. assets no load. very refresh.\n' + e;
    return;
  }

  let scene, sceneName = '';
  const scenes = {};
  function go(name, ...args) {
    scene = scenes[name](...args); sceneName = name;
  }
  scenes.viewer = () => makeViewer({ atlas, input });
  scenes.play = () => makePlay({ atlas, input, save, go, jukebox });
  // toggleDisplay is handed to the title scene rather than read from a global:
  // the title is the only place the setting is offered, and this keeps main.js
  // the single owner of both fit() and the save write.
  const toggleDisplay = () => {
    const mode = setDisplay(displayMode === 'crisp' ? 'fill' : 'crisp');
    save.patch({ display: mode });
    return mode;
  };
  scenes.title = () => makeTitle({ input, go, save, jukebox, toggleDisplay });
  // The ONLY place a best score is written. The win scene reads two resolved
  // numbers and never touches save, so replaying the results screen can't
  // re-bank a score.
  scenes.win = (breakdown) => {
    const prevBest = save.data.best.gauntlet;
    if (breakdown.score > prevBest) save.patch({ best: { gauntlet: breakdown.score } });
    // Fanfare lives here rather than in win.js for the same reason the best
    // score does: the win scene stays a pure layout of numbers it was handed.
    jukebox.playOneShot('fanfare');
    return makeWin({ breakdown, best: Math.max(prevBest, breakdown.score), input, go });
  };

  // --- test hook -----------------------------------------------------------
  let tape = null, tapeI = 0;
  window.__blast = {
    ready: false, frame: 0,
    state: () => ({ scene: sceneName, anims: Object.keys(atlas.anims).length,
                    ...(scene.state?.() ?? {}),
                    // Display keys go AFTER the scene spread, not before: they
                    // describe the shell, and main.js is their only owner, so a
                    // scene must never be able to shadow what the display e2e
                    // asserts on.
                    display: displayMode, scale,
                    backing: { w: screen.width, h: screen.height },
                    css: { w: screen.style.width, h: screen.style.height },
                    dpr: devicePixelRatio || 1 }),
    playTape(t) { tape = t; tapeI = 0; },
    jukebox: { current: jukebox.current },
    // Sticker <video> elements are never in the DOM, so querySelectorAll finds
    // nothing — this is the only window onto how many decoders we opened.
    stickers: stickerStats,
    tapeDone: () => tape === null,
  };
  // -------------------------------------------------------------------------

  const loop = createLoop({
    update(dt, frame) {
      window.__blast.frame = frame;
      // Tape entries are frame-quantized STATE CHANGES (not pulses): an entry's
      // actions hold until the next entry. The exhaustion clear runs after the
      // sim step so the final entry is observed for one frame before release.
      if (tape) {
        while (tapeI < tape.length && tape[tapeI].f <= frame) {
          input.setVirtual(tape[tapeI].a ?? null); tapeI++;
        }
      }
      input.beginFrame();
      if (testMode && input.pressed('debug')) go(sceneName === 'viewer' ? 'play' : 'viewer');
      scene.update(dt);
      input.endFrame();
      if (tape && tapeI >= tape.length) { tape = null; input.setVirtual(null); }
    },
    render() {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, VW, VH);
      scene.render(ctx);
      drawSoundButton(ctx, jukebox.isMuted());     // shell: above every scene
      sctx.drawImage(off, 0, 0, screen.width, screen.height);
    },
  });

  // ?test boots straight into play: every e2e tape is calibrated from the first
  // gameplay frame, and making them all click through the title first would put
  // an unrelated three-keypress preamble in front of every calibrated tape.
  go(testMode ? 'play' : 'title');
  loop.start();
  window.__blast.ready = true;
}

boot().catch(e => {
  document.getElementById('err').style.display = 'block';
  document.getElementById('err').textContent = 'wow. game no boot. very refresh.\n' + e;
});
