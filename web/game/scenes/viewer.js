// Debug gallery: every atlas anim, cycling. ←/→ = prev/next anim.
import { animFrame } from '../../engine/assets.js';

export function makeViewer({ atlas, input }) {
  const names = Object.keys(atlas.anims);
  let i = 0, t = 0;
  return {
    update(dt) {
      t += dt;
      if (input.pressed('left'))  { i = (i + names.length - 1) % names.length; t = 0; }
      if (input.pressed('right')) { i = (i + 1) % names.length; t = 0; }
    },
    render(ctx) {
      const name = names[i], a = atlas.anims[name];
      // checker backdrop so trims/anchors are visible
      for (let y = 0; y < 360; y += 16) for (let x = 0; x < 640; x += 16)
        { ctx.fillStyle = (x + y) % 32 ? '#14141f' : '#101018'; ctx.fillRect(x, y, 16, 16); }
      ctx.strokeStyle = '#2c8'; ctx.beginPath();
      ctx.moveTo(120, 280); ctx.lineTo(520, 280); ctx.stroke();   // feet line
      atlas.drawFeet(ctx, name, animFrame(a, t), 320, 280, false);
      ctx.fillStyle = '#e8e0d0'; ctx.font = '12px monospace';
      ctx.fillText(`${i + 1}/${names.length}  ${name}  ${a.frames.length}f @${a.fps}fps`
                   + `  cell ${a.cw}x${a.ch}  feetY ${a.feetY}`, 12, 20);
    },
    state: () => ({ viewerAnim: names[i] }),
  };
}
