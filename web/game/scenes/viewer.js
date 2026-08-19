export function makeViewer({ atlas, input }) {
  return { update() {}, render(ctx) { ctx.fillStyle = '#fff'; ctx.fillText('viewer', 10, 10); },
           state: () => ({}) };
}
