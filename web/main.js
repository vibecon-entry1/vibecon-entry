// Boot: load atlas → build scenes → fixed loop → integer-scaled blit.
import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { loadAtlas } from './engine/assets.js';
import { makeSave } from './engine/save.js';
import { makeViewer } from './game/scenes/viewer.js';
import { makePlay } from './game/scenes/play.js';

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

// Placeholder results scene: proves the play → win handoff carries the
// breakdown. Task 4 swaps in the real thing.
function makeWinStub(breakdown) {
  return {
    update() {},
    render(ctx) {
      ctx.fillStyle = '#eec548';
      ctx.font = '24px monospace'; ctx.textAlign = 'center';
      ctx.fillText('much win. very Task 4.', VW / 2, 140);
      ctx.font = '10px monospace'; ctx.fillStyle = '#8fa';
      ctx.fillText(JSON.stringify(breakdown), VW / 2, 180);
      ctx.textAlign = 'left';
    },
    state: () => ({ breakdown }),
  };
}

async function boot() {
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
  // STUB — Task 4 replaces this with the real results screen.
  scenes.win = (breakdown) => makeWinStub(breakdown);

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
      if (input.pressed('debug')) go(sceneName === 'viewer' ? 'play' : 'viewer');
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

  go('play');
  loop.start();
  window.__blast.ready = true;
}

boot().catch(e => {
  document.getElementById('err').style.display = 'block';
  document.getElementById('err').textContent = 'wow. game no boot. very refresh.\n' + e;
});
