// Boot: load atlas → build scenes → fixed loop → integer-scaled blit.
import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { loadAtlas } from './engine/assets.js';
import { makeSave } from './engine/save.js';
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

function fit() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / VW, innerHeight / VH)));
  screen.width = VW * s; screen.height = VH * s;
  screen.style.width = `${VW * s}px`; screen.style.height = `${VH * s}px`;
  sctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit); fit();

async function boot() {
  // One boot-time read of the ?test flag: it arms the debug scene toggle below
  // AND selects the test entry scene at the bottom. Same flag the play scene's
  // cheats hang off — F1 scene-swapping is a dev affordance, not something a
  // player should be able to trip from the title screen.
  const testMode = new URLSearchParams(location.search).has('test');
  const input = createInput();
  const save = makeSave(localStorage);
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
  scenes.play = () => makePlay({ atlas, input, save, go });
  scenes.title = () => makeTitle({ input, go, save });
  // The ONLY place a best score is written. The win scene reads two resolved
  // numbers and never touches save, so replaying the results screen can't
  // re-bank a score.
  scenes.win = (breakdown) => {
    const prevBest = save.data.best.gauntlet;
    if (breakdown.score > prevBest) save.patch({ best: { gauntlet: breakdown.score } });
    return makeWin({ breakdown, best: Math.max(prevBest, breakdown.score), input, go });
  };

  // --- test hook -----------------------------------------------------------
  let tape = null, tapeI = 0;
  window.__blast = {
    ready: false, frame: 0,
    state: () => ({ scene: sceneName, anims: Object.keys(atlas.anims).length,
                    ...(scene.state?.() ?? {}) }),
    playTape(t) { tape = t; tapeI = 0; },
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
