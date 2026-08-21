// Boot: load atlas → build scenes → fixed loop → integer-scaled blit.
import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { loadAtlas } from './engine/assets.js';
import { makeSave } from './engine/save.js';
import { makeJukebox } from './engine/audio.js';
import { makeSfx } from './engine/sfx.js';
import { stickerStats } from './engine/sticker.js';
import { makeViewer } from './game/scenes/viewer.js';
import { makePlay } from './game/scenes/play.js';
import { makeTitle } from './game/scenes/title.js';
import { makeWin } from './game/scenes/win.js';
import { makeWowEnd } from './game/scenes/wowend.js';
import { drawText, drawTextShadow } from './engine/font.js';
import { fitScale } from './engine/fit.js';
import { P } from './game/physics.js';

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
  // Everything works in DEVICE pixels: innerWidth is CSS px, so the *dpr
  // inside fitScale is what makes `scale` mean "hardware pixels per game
  // pixel" rather than "CSS pixels per game pixel" (the old, blurry meaning).
  // Below one device pixel per game pixel fitScale goes FRACTIONAL in both
  // modes — the old Math.max(1, ...) clamp pushed the canvas off small phone
  // screens. The math lives in engine/fit.js so that branch is unit-tested.
  scale = fitScale({ winW: innerWidth, winH: innerHeight, dpr, mode: displayMode,
                     vw: VW, vh: VH });

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

// --- shell extras -----------------------------------------------------------
// An alternate dressing for the whole page, toggled by a key sequence and owned
// here rather than by any scene: it outlives a restart, it colours the FINAL
// blit (which no scene can reach), and it retunes one global physics constant.
//
// The three pieces of state below are the whole of it. `xGrav` is the only one
// that must survive precisely: it holds the untouched P.GRAV so the restore is
// an exact assignment rather than a divide that would drift the value every
// round trip.
const SEQ9 = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft',
              'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
let xMode = false;
let xPhase = 0;                               // seconds, drives the blit filter
let xGrav = 0;                                // stashed P.GRAV while xMode is on
let xBanner = -1;                             // -1 = off; else seconds since ON

const BANNER_T = 2.4, BANNER_FADE = 0.6;

function drawBanner(ctx) {
  if (xBanner < 0 || xBanner > BANNER_T) return;
  ctx.globalAlpha = xBanner > BANNER_T - BANNER_FADE
    ? (BANNER_T - xBanner) / BANNER_FADE : 1;
  ctx.fillStyle = 'rgba(11,11,18,.85)';
  ctx.fillRect(0, 88, VW, 32);
  drawTextShadow(ctx, 'MUCH DISCO. VERY MARS.', VW / 2, 96,
                 { align: 'center', scale: 3 }, '#eec548', '#2a1c33');
  ctx.globalAlpha = 1;
}

// --- touch shell ------------------------------------------------------------
// Pause plate, left of the sound plate. Drawn only when the touch UI is live:
// Escape is the pause key and a phone has no Escape. Same 22x20 plate family
// as MUTE_BTN so the corner reads as one control cluster.
const PAUSE_BTN = { x: 586, y: 3, w: 22, h: 20 };

function drawPauseButton(ctx) {
  ctx.fillStyle = 'rgba(11,11,18,0.55)';
  ctx.fillRect(PAUSE_BTN.x, PAUSE_BTN.y, PAUSE_BTN.w, PAUSE_BTN.h);
  ctx.fillStyle = '#e8e0d0';
  ctx.fillRect(PAUSE_BTN.x + 7, PAUSE_BTN.y + 5, 3, 10);
  ctx.fillRect(PAUSE_BTN.x + 12, PAUSE_BTN.y + 5, 3, 10);
}

// A 22-virtual-px plate lands well under a finger: virtual→CSS is scale/dpr,
// which sits around 0.6–1.1 on phones, so the DRAWN plate can be ~13 CSS px.
// The HIT box is therefore inflated to a 44 CSS px floor at press time —
// computed per press because scale and dpr change with every fit().
const tapNeed = () => 44 * (devicePixelRatio || 1) / scale;   // 44 CSS px, in virtual px

function hitExpanded(v, r) {
  const need = tapNeed();
  const px = Math.max(0, (need - r.w) / 2), py = Math.max(0, (need - r.h) / 2);
  return v.x >= r.x - px && v.x < r.x + r.w + px &&
         v.y >= r.y - py && v.y < r.y + r.h + py;
}
const btnDist = (v, r) => Math.hypot(v.x - (r.x + r.w / 2), v.y - (r.y + r.h / 2));

// Zone ghosting + FIRE ring, drawn over the world when the touch UI is live.
// Faint by design: these are affordances, not chrome. The move ghost tracks a
// live thumb (origin ring + clamped nub); with no thumb down both zones fall
// back to resting rings with their doge labels.
function drawTouchHints(ctx, ts, firing) {
  ctx.save();
  ctx.strokeStyle = '#8fa';
  ctx.lineWidth = 2;
  let moveLive = false;
  for (const p of ts.pointers) {
    if (p.zone !== 'move') continue;
    moveLive = true;
    ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.arc(p.ox, p.oy, 22, 0, Math.PI * 2); ctx.stroke();
    const dx = p.x - p.ox, dy = p.y - p.oy, d = Math.hypot(dx, dy) || 1, c = Math.min(d, 22);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#8fa';
    ctx.beginPath();
    ctx.arc(p.ox + dx / d * c, p.oy + dy / d * c, 7, 0, Math.PI * 2); ctx.fill();
  }
  if (!moveLive) {
    ctx.globalAlpha = 0.16;
    ctx.beginPath(); ctx.arc(74, VH - 70, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#8fa';
    drawText(ctx, 'MUCH MOVE.', 74, VH - 34, { align: 'center' });
  }
  ctx.globalAlpha = firing ? 0.4 : 0.16;
  ctx.beginPath(); ctx.arc(VW - 74, VH - 70, 26, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#8fa';
  drawText(ctx, 'VERY FIRE.', VW - 74, VH - 34, { align: 'center' });
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Portrait veil. 640x360 sideways on a portrait phone is a strip of unreadable
// game; under this veil the loop's update is skipped entirely (see the
// portraitBlocked bail there), which is the auto-pause — rotating back is the
// resume, with no state to unwind because nothing ever advanced.
function drawRotateOverlay(ctx) {
  ctx.fillStyle = 'rgba(11,11,18,0.94)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = '#3a3350'; ctx.fillRect(VW / 2 - 34, 118, 68, 40);   // landscape phone
  ctx.fillStyle = '#0b0b12'; ctx.fillRect(VW / 2 - 28, 124, 56, 28);
  ctx.fillStyle = '#8fa';    ctx.fillRect(VW / 2 + 29, 136, 2, 4);     // side button
  drawTextShadow(ctx, 'very rotate.', VW / 2, 180, { align: 'center', scale: 4 },
                 '#eec548', '#2a1c33');
  ctx.fillStyle = '#8fa';
  drawText(ctx, 'much landscape.', VW / 2, 222, { align: 'center', scale: 2 });
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
  // WOW ZONE seeding. Seed GENERATION is meta, not sim: the sim itself never
  // calls Date.now() or Math.random — it is handed one integer at scene
  // construction and everything downstream is a pure function of it. '?wowseed='
  // pins that integer so an e2e can replay the same dealt level twice; without
  // it the wall clock rolls a fresh run. Number('') is 0 and 0 is falsy, so a
  // missing or junk param falls through to the clock.
  const wowSeed = () => Number(params.get('wowseed')) || Date.now();
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
  const liveAudio = !testMode || params.has('music');
  const jukebox = makeJukebox({ save, enabled: liveAudio });
  // Synthesized SFX ride the SAME gate as the music: silent under ?test (the
  // suite's thousands of synthetic-but-trusted keypresses would each schedule
  // oscillators), live under '/' and under '?test&music' for the smoke probe.
  const sfx = makeSfx({ save, enabled: liveAudio });
  // Autoplay policy: nothing can start before a real user gesture, so the first
  // one (whatever it is) releases whatever the title scene already asked for —
  // and builds the AudioContext, which cannot legally exist before it either.
  const unlock = () => { jukebox.unlock(); sfx.unlock(); };
  addEventListener('keydown', unlock, { once: true });
  addEventListener('pointerdown', unlock, { once: true });
  // ONE user-facing switch. Music and SFX are two engines but a single mute:
  // the jukebox owns the persisted flag (save.data.audio.muted) and returns the
  // new value, which is pushed straight onto the SFX master gain. Every caller
  // of mute — this button, the M key in title.js and play.js — goes through
  // here, so the two can never drift apart.
  const toggleMute = () => sfx.setMuted(jukebox.toggleMute());

  // Sound button. ORDERING, traced: a click on the button dispatches
  // pointerdown -> (mouseup) -> click, in that order and always. So the very
  // first click a player ever makes runs the window-level unlock() first and
  // this handler second. Unlock only releases whatever pool the scene already
  // asked for; toggleMute() only flips the mute flag and pushes it onto the
  // live element. They are independent, so first-click-on-the-button does the
  // sane thing: music starts AND immediately goes to muted, and a second click
  // brings it back. No special-casing needed.
  // Canceling pointerdown suppresses the compat mousedown/mouseup but NOT the
  // click a tap still synthesizes — without this guard a touch on the sound
  // button toggles twice (claim below, then here) and lands where it started.
  // The guard is a flag rather than e.pointerType because click is only a
  // PointerEvent on some engines; its pointerdown always precedes it on all.
  let lastPointerWasTouch = false;
  screen.addEventListener('pointerdown', e => { lastPointerWasTouch = e.pointerType === 'touch'; });
  screen.addEventListener('click', e => {
    if (lastPointerWasTouch) return;        // touch path owns the buttons (claim below)
    const v = toVirtual(e.clientX, e.clientY);
    if (!v) return;
    if (v.x >= MUTE_BTN.x && v.x < MUTE_BTN.x + MUTE_BTN.w &&
        v.y >= MUTE_BTN.y && v.y < MUTE_BTN.y + MUTE_BTN.h) toggleMute();
  });

  // Touch UI gate: coarse-pointer media query, OR a real finger has landed —
  // the latch covers hybrids whose media queries lie about their glass.
  const coarse = matchMedia('(pointer: coarse)');
  const touchUI = () => coarse.matches || input.touchSeen();
  const portraitBlocked = () => touchUI() && innerHeight > innerWidth;

  // Shell claim: buttons get first refusal on a touch before it becomes a game
  // action (both plates live inside the fire zone). Overlapping inflated hit
  // boxes resolve to the nearest plate centre, so two abutting 44px targets
  // stay two targets. Mute is handled here (the click path never fires for a
  // touch — pointerdown preventDefaults it away); pause is injected as its
  // action so play.js's own pressed('pause') handling stays the one pause path.
  input.attachTouch(screen, {
    toVirtual,
    claim(v) {
      const hits = [];
      if (hitExpanded(v, MUTE_BTN)) hits.push(['mute', MUTE_BTN]);
      if (sceneName === 'play' && touchUI() && hitExpanded(v, PAUSE_BTN))
        hits.push(['pause', PAUSE_BTN]);
      if (!hits.length) return false;
      hits.sort((a, b) => btnDist(v, a[1]) - btnDist(v, b[1]));
      if (hits[0][0] === 'mute') { toggleMute(); return true; }
      return 'pause';
    },
  });
  // Long-press context menu would drop a live thumb mid-slide.
  screen.addEventListener('contextmenu', e => e.preventDefault());
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
    // Leaving the world drops the alternate dressing, which is what keeps the
    // retuned gravity from ever reaching a run that isn't wearing it: the only
    // way back into play is through one of these three screens, and every one
    // of them restores P.GRAV on the way past. A retry or a respawn is NOT a
    // scene change in this sense — same world, same dressing.
    if (name === 'title' || name === 'win' || name === 'wowend') setX(false);
    scene = scenes[name](...args); sceneName = name;
  }

  let xPool = null;                 // pool to hand back on the way out
  function setX(on) {
    if (on === xMode) return;
    xMode = on;
    if (on) {
      xGrav = P.GRAV;
      P.GRAV = Math.round(xGrav * 0.6);
      xPhase = 0; xBanner = 0;
      const j = jukebox.current();
      xPool = j.pool ?? j.pending ?? null;
      jukebox.playPool('x');
    } else {
      P.GRAV = xGrav;               // exact value back, never a recomputation
      xBanner = -1;
      if (xPool) jukebox.playPool(xPool);
      xPool = null;
    }
  }

  // Raw key codes, not input.js actions: half of these are not bound to
  // anything the game reads, and the point is the ORDER they arrive in rather
  // than what any of them means. A wrong key resets to zero — except when the
  // wrong key is itself the opener, which starts a fresh attempt on the spot.
  let seqI = 0;
  addEventListener('keydown', e => {
    if (e.code === SEQ9[seqI]) {
      if (++seqI < SEQ9.length) return;
      seqI = 0;
      if (sceneName === 'play') setX(!xMode);
    } else {
      seqI = e.code === SEQ9[0] ? 1 : 0;
    }
  });
  scenes.viewer = () => makeViewer({ atlas, input });
  // opts carries the WOW ZONE entry ({ mode: 'wow', seed }); gauntlet passes
  // nothing and makePlay's defaults handle it.
  // touchUI rides along for one render-time decision: the tutorial signs
  // speak in the live input's verbs (see TOUCH_SIGNS in play.js).
  scenes.play = (opts = {}) => makePlay({ atlas, input, save, go, jukebox, sfx, toggleMute,
                                          xOn: () => xMode, touchUI,
                                          ...opts, seed: opts.seed ?? wowSeed() });
  // toggleDisplay is handed to the title scene rather than read from a global:
  // the title is the only place the setting is offered, and this keeps main.js
  // the single owner of both fit() and the save write.
  const toggleDisplay = () => {
    const mode = setDisplay(displayMode === 'crisp' ? 'fill' : 'crisp');
    save.patch({ display: mode });
    return mode;
  };
  // touchUI/tapNeed ride along so the title can offer TAP plates (wow entry,
  // display toggle) with the same 44 CSS px floor as the shell's own buttons,
  // while main.js stays the single owner of scale/dpr and the coarse gate.
  scenes.title = () => makeTitle({ atlas, input, go, save, jukebox, sfx, toggleMute, toggleDisplay,
                                   touchUI, tapNeed });
  // The ONLY place a best score is written. The win scene reads two resolved
  // numbers and never touches save, so replaying the results screen can't
  // re-bank a score.
  scenes.win = (breakdown) => {
    const prevBest = save.data.best.gauntlet;
    if (breakdown.score > prevBest) save.patch({ best: { gauntlet: breakdown.score } });
    // Finishing the gauntlet is what unlocks WOW ZONE, and this is the only
    // place the game knows that happened. Top-level key, so patch()'s plain
    // spread handles it — no merge rule needed.
    if (!save.data.wowUnlocked) save.patch({ wowUnlocked: true });
    // Fanfare lives here rather than in win.js for the same reason the best
    // score does: the win scene stays a pure layout of numbers it was handed.
    return makeWin({ breakdown, best: Math.max(prevBest, breakdown.score), input, go, sfx,
                     tapNeed });
  };

  // The wow best is banked here for the same reason the gauntlet's is: ONE
  // writer, outside the scene, so replaying the results screen can't re-bank.
  // best is a nested object with a one-level merge in save.patch(), so writing
  // just { wow } leaves { gauntlet } alone.
  scenes.wowend = (breakdown) => {
    const prevBest = save.data.best.wow;
    if (breakdown.score > prevBest) save.patch({ best: { wow: breakdown.score } });
    return makeWowEnd({ breakdown, best: Math.max(prevBest, breakdown.score),
                        input, go, sfx, tapNeed });
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
                    dpr: devicePixelRatio || 1,
                    touchUI: touchUI(), portraitBlocked: portraitBlocked() }),
    playTape(t) { tape = t; tapeI = 0; },
    jukebox: { current: jukebox.current },
    // Same shape as the jukebox hook: the only window onto the WebAudio graph,
    // whose nodes are not in the DOM and have no other observable state.
    sfx: { current: sfx.current },
    // Sticker <video> elements are never in the DOM, so querySelectorAll finds
    // nothing — this is the only window onto how many decoders we opened.
    stickers: stickerStats,
    tapeDone: () => tape === null,
  };
  // -------------------------------------------------------------------------

  const loop = createLoop({
    update(dt, frame) {
      window.__blast.frame = frame;
      // Portrait veil = the world holds still. Bailed BEFORE the tape reader
      // so a veiled frame can't consume tape entries; e2e tapes always run in
      // landscape viewports, so the two never actually meet. The input frame
      // cycle still runs: taps that land UNDER the veil must drain every
      // frame, not pile up in the tap/uiTaps records and fire a phantom
      // shot/pause/menu action on the first live frame after rotate-back.
      if (portraitBlocked()) { input.beginFrame(); input.endFrame(); return; }
      if (xMode) xPhase += dt;
      if (xBanner >= 0 && xBanner <= BANNER_T) xBanner += dt;
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
      // A wash over the finished WORLD, before any shell chrome goes on top of
      // it: two full-frame passes on the 640x360 buffer, which is the cheapest
      // surface in the pipeline and the only one every scene shares.
      //
      // The colour crawls between a cool rose and a warm ember on an 8s sine,
      // and 'overlay' keeps it a tint rather than a coat of paint — blacks stay
      // black, highlights stay bright, and the midtones (the rock, the dirt,
      // the sky bands) are what actually move. The swing is deliberately narrow
      // and both ends of it are warm: this is the light changing over the same
      // red planet, not a rainbow.
      //
      // The second pass is the same phase read as brightness: a flat grey ADDED
      // at the ember end and MULTIPLIED in at the rose end, which is a +/-8%
      // breath either side of the untouched frame.
      if (xMode) {
        const sw = Math.sin(xPhase * Math.PI / 4);       // one full swing every 8s
        const u = (sw + 1) / 2;
        const mix = (a, b) => Math.round(a + (b - a) * u);
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = `rgb(${mix(158, 255)},${mix(40, 140)},${mix(108, 42)})`;
        ctx.fillRect(0, 0, VW, VH);
        const bv = Math.round(Math.abs(sw) * 20);
        ctx.globalCompositeOperation = sw >= 0 ? 'lighter' : 'multiply';
        ctx.globalAlpha = 1;
        const lv = sw >= 0 ? bv : 255 - bv;
        ctx.fillStyle = `rgb(${lv},${lv},${lv})`;
        ctx.fillRect(0, 0, VW, VH);
        ctx.restore();
      }
      drawSoundButton(ctx, jukebox.isMuted());     // shell: above every scene
      if (touchUI() && sceneName === 'play') {
        drawPauseButton(ctx);
        if (!portraitBlocked()) drawTouchHints(ctx, input.touchState(), input.held('fire'));
      }
      drawBanner(ctx);
      if (portraitBlocked()) drawRotateOverlay(ctx);
      sctx.drawImage(off, 0, 0, screen.width, screen.height);
      // Overlay pass: device-resolution draws (brand stickers) go straight onto
      // the FINAL screen canvas here, AFTER the integer/fractional blit, so
      // their 512px source is scaled ONCE (virtual -> device) instead of twice
      // (virtual -> 640x360 buffer -> device), which is what was squashing them
      // soft. `scale` is device pixels per virtual pixel — fractional in FILL
      // mode, so scenes must use it, not assume an integer. Smoothing is
      // flipped on for exactly this pass and restored after: the blit above and
      // any next frame's buffer draw must stay nearest.
      sctx.imageSmoothingEnabled = true;
      if (!portraitBlocked()) scene.renderOverlay?.(sctx, scale);   // veil covers stickers too
      sctx.imageSmoothingEnabled = false;
    },
  });

  // ?test boots straight into play: every e2e tape is calibrated from the first
  // gameplay frame, and making them all click through the title first would put
  // an unrelated three-keypress preamble in front of every calibrated tape.
  // '?test&wow' drops straight into a wow run, the same way '?test' drops into
  // the gauntlet: the wow e2e's tapes are calibrated from the first gameplay
  // frame too, and routing them through title + the unlock would put an
  // unrelated preamble in front of every one. The UNLOCK path itself is
  // exercised separately, through the real title screen.
  if (testMode && params.has('wow')) go('play', { mode: 'wow' });
  else go(testMode ? 'play' : 'title');
  loop.start();
  window.__blast.ready = true;
}

boot().catch(e => {
  document.getElementById('err').style.display = 'block';
  document.getElementById('err').textContent = 'wow. game no boot. very refresh.\n' + e;
});
