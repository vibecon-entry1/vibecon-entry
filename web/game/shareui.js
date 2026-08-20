// The "SHARE — press S" line on the two end screens, and everything that
// happens after you press it. Shared by win.js and wowend.js so the gauntlet
// and the zone can never drift into two different share flows.
//
// THE KEY. KeyS is bound to the 'down' action in engine/input.js — down is the
// verb key: it is how you shoot the ground. On these two screens there is no
// world to shoot, nothing reads 'down', and the only other bound keys are R
// (again) and M (mute). So the prompt reads "press S" to the player and the
// code reads input.pressed('down'), which is the same physical key. No new
// KEYMAP entry, and no risk of stealing a key from the sim: this scene never
// runs while a player is holding down to slide.
//
// NO NETWORK. Pressing S writes a string and a picture to the clipboard. The
// URL it copies points at the unfurl worker, but the GAME never fetches it.
import { drawText } from '../engine/font.js';
import { copyShare, shareUrl, shareText, renderShareCanvas } from './share.js';

const CX = 320;                   // VW/2 — both end screens are 640 wide
const OK_T = 3.0;                 // how long "very copied." stays up

/**
 * @param run {score, kills, deaths, mode} — the finished run, already tallied.
 * @param copy — injectable for tests; defaults to the real clipboard path.
 */
export function makeSharePrompt(run, { copy = copyShare, sfx } = {}) {
  const url = shareUrl(run);
  let status = 'idle';            // idle | busy | ok | fail
  let withImage = false;
  let okT = 0;
  let canvas = null;              // built on first press, never before

  async function fire() {
    if (status === 'busy') return;
    status = 'busy';
    try {
      // The card is rendered inside the keypress task so Safari still counts
      // the clipboard write as user-initiated.
      canvas ||= renderShareCanvas(run);
      const res = await copy(run, { canvas });
      withImage = !!res.image;
      status = 'ok'; okT = 0;
    } catch {
      // Clipboard denied, or no clipboard at all (http:// on a non-localhost
      // origin has none). The URL goes on screen instead — a player can read
      // it off and type it, which is worse but is not nothing.
      status = 'fail';
      manualPrompt();
    }
  }

  // ...and the URL also goes into a native prompt(), which is the one text box
  // that exists on every browser and platform without a clipboard API: its
  // contents are pre-selected, so the OS's own copy works on it. Only ever
  // reached from the catch above, i.e. only when the real write is gone.
  //
  // Deferred by one frame ON PURPOSE. prompt() blocks the page dead, so calling
  // it inline would freeze the display on the frame BEFORE the fallback URL was
  // drawn — dismiss the box and the screen would still say "press S". The
  // loop's own rAF is already queued ahead of this one, so its render lands
  // first and the dialog opens over a screen that already shows the URL.
  function manualPrompt() {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') return;
    const ask = () => { try { window.prompt('very manual. copy this:', url); } catch { /* ignore */ } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(ask); else ask();
  }

  return {
    /** Call from the scene's update. Returns true if a share was started. */
    update(dt, input) {
      if (status === 'ok' && (okT += dt) > OK_T) status = 'idle';
      if (input.pressed('down') && status !== 'busy') {
        sfx?.play('uiclick');
        fire();
        return true;
      }
      return false;
    },

    /** One line at `y`, plus whatever the last press left behind. */
    render(ctx, y) {
      if (status === 'ok') {
        ctx.fillStyle = '#eec548';
        drawText(ctx, withImage ? 'very copied. much picture.' : 'very copied.',
                 CX, y, { align: 'center', scale: 2 });
        return;
      }
      if (status === 'fail') {
        ctx.fillStyle = '#e2413f';
        drawText(ctx, 'no clipboard. very manual:', CX, y - 12, { align: 'center' });
        ctx.fillStyle = '#8fa';
        // The bitmap font is CAPS-only, so the URL comes out shouted. Hosts are
        // case-insensitive and the worker lower-cases its query keys for exactly
        // this reason, so what a player reads off the screen and types still
        // resolves to their run.
        drawText(ctx, url, CX, y + 1, { align: 'center' });
        return;
      }
      ctx.fillStyle = '#8fa';
      drawText(ctx, 'SHARE — press S', CX, y, { align: 'center', scale: 2 });
    },

    // Test hook. The e2e prefers reading the real clipboard, but headless
    // permission grants are a per-browser lottery, so the payload the game
    // BELIEVES it copied is exposed here as the fallback assertion surface.
    state: () => ({ shareUrl: url, shareText: shareText(run), shareStatus: status,
                    shareImage: withImage }),
  };
}
