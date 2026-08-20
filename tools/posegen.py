#!/usr/bin/env python3
"""Derive a 'gun down' hero pose from the official Stand frame by pixel surgery.

The pack ships no down-aimed pose, but the game's whole vertical verb is the
down-shot: the hero rocket-hops by firing at the floor. Rather than hand-draw a
frame we can't style-match, we CUT the blaster plume out of the Stand frame and
re-paste it rotated 90 degrees clockwise at the hip, so the same authored
pixels — same palette, same outline weight — now point at the ground.

Anatomy note that drove the heuristics: the Stand frame's "gun" is not a gun.
It is an energy blast — a red flare shell around a yellow core with a white-hot
tip — leaving the hero's fist, which is why cutting on colour works and why the
rotated result reads as a thruster plume rather than a mangled prop.

  python3 tools/posegen.py            # write assets-gen/pose_gundown.png
  python3 tools/posegen.py --ascii    # before/after pixel maps for eyeballing
"""
from PIL import Image
from pathlib import Path
import sys

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'Sprite_Sheets' / 'Dogelon_Stand.png'
OUT = ROOT / 'assets-gen' / 'pose_gundown.png'
N = 64                      # native cell size (the sheet is a 1728px cell at 27x)

# Flood seeds: the blast's reds and its hot yellow core.
BLAST_SEEDS = {(255, 0, 0), (255, 225, 0)}
# The fill is boxed to x >= CUT_X. That column is the far side of the fist: it
# keeps the glove, the coat and the body OUT of the cluster. Without the box the
# fill escapes through the shared black outline and eats the entire sprite.
CUT_X = 39
# Rotation pivot, in source coords: the root of the plume where it leaves the
# fist. Rotating about it keeps the blast attached to the hand it came from.
BLAST_ROOT = (39, 34)
# Where that root lands in the output: the hip, just below and in front of the
# fist, so the plume runs down past the knee and stops short of the boots.
HIP = (34, 37)
JACKET = (30, 47, 81, 255)  # #1e2f51 — the coat blue any shoulder hole patches to
MIN_ISLAND = 8              # fragments smaller than this are swept up


def load_native():
    """The pack's 27x upscale is exact, so NEAREST down to 64 recovers the
    authored pixels losslessly."""
    im = Image.open(SRC).convert('RGBA')
    assert im.width % N == 0 and im.height % N == 0, im.size
    return im.resize((N, N), Image.NEAREST)


def neighbours(x, y):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if (dx or dy) and 0 <= x + dx < N and 0 <= y + dy < N:
                yield x + dx, y + dy


def islands(pixels):
    """8-connected components of a pixel set."""
    todo, out = set(pixels), []
    while todo:
        seed = todo.pop()
        comp, stack = {seed}, [seed]
        while stack:
            x, y = stack.pop()
            for n in neighbours(x, y):
                if n in todo:
                    todo.discard(n); comp.add(n); stack.append(n)
        out.append(comp)
    return out


def blast_cluster(px):
    """8-connected flood from the blast's red/yellow pixels, boxed off the body.
    Only the LARGEST island is kept: the frame also carries a detached 3px
    muzzle spark out past the tip, which rotates into a floating dot."""
    seeds = [(x, y) for y in range(N) for x in range(CUT_X, N)
             if px[x, y][3] > 128 and px[x, y][:3] in BLAST_SEEDS]
    assert seeds, 'no blaster pixels found — did the source sheet change?'
    seen, stack = set(seeds), list(seeds)
    while stack:
        x, y = stack.pop()
        for nx, ny in neighbours(x, y):
            if (nx, ny) in seen or nx < CUT_X or px[nx, ny][3] <= 128:
                continue
            seen.add((nx, ny)); stack.append((nx, ny))
    return max(islands(seen), key=len)


def sweep_fragments(op):
    """Delete opaque islands too small to be anatomy (cut debris, sparks)."""
    keep = {(x, y) for y in range(N) for x in range(N) if op[x, y][3] > 128}
    for comp in islands(keep):
        if len(comp) < MIN_ISLAND:
            for (x, y) in comp:
                op[x, y] = (0, 0, 0, 0)


def build():
    src = load_native()
    px = src.load()
    cluster = blast_cluster(px)

    out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    op = out.load()
    # 1. everything except the blast
    for y in range(N):
        for x in range(N):
            if (x, y) not in cluster and px[x, y][3] > 128:
                op[x, y] = px[x, y]
    # 2. patch the hole: a cut pixel ringed by body on most sides was interior,
    #    so it becomes coat rather than a bite mark in the silhouette.
    for (x, y) in sorted(cluster):
        if op[x, y][3] <= 128 and \
           sum(1 for nx, ny in neighbours(x, y) if op[nx, ny][3] > 128) >= 5:
            op[x, y] = JACKET
    sweep_fragments(op)
    # 3. re-paste rotated 90 degrees clockwise about BLAST_ROOT, landed at HIP.
    #    Screen y points down, so clockwise is (dx, dy) -> (-dy, dx).
    for (x, y) in sorted(cluster):
        dx, dy = x - BLAST_ROOT[0], y - BLAST_ROOT[1]
        nx, ny = HIP[0] - dy, HIP[1] + dx
        if 0 <= nx < N and 0 <= ny < N:
            op[nx, ny] = px[x, y]
    sweep_fragments(op)
    return src, out, cluster


def ascii_map(img, label):
    LEG = {(0, 0, 0): '#', (255, 255, 255): 'W', (238, 197, 72): 'y', (30, 47, 81): 'b',
           (66, 31, 12): 'B', (255, 0, 0): 'R', (174, 230, 255): 'c', (255, 225, 0): 'Y',
           (171, 135, 25): 'o'}
    px = img.load()
    print(f'--- {label} ---')
    for y in range(N):
        print('%2d %s' % (y, ''.join(
            ' ' if px[x, y][3] < 128 else LEG.get(px[x, y][:3], '?') for x in range(N))))


def main():
    src, out, cluster = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT)
    print(f'pose_gundown: cut {len(cluster)}px at {BLAST_ROOT} -> hip {HIP}, '
          f'wrote {OUT.relative_to(ROOT)}')
    if '--ascii' in sys.argv:
        ascii_map(src, 'stand (source)')
        ascii_map(out, 'gundown (result)')


if __name__ == '__main__':
    main()
