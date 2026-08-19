export function makePlay({ atlas, input, save, go }) {
  return { update() {}, render(ctx) { ctx.fillStyle = '#fff'; ctx.fillText('play', 10, 10); },
           state: () => ({}) };
}
