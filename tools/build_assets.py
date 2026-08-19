#!/usr/bin/env python3
"""Build web/assets/{atlas.png,atlas.json,palette.json} from the official pack.
Slices row-major grids, downscales by the EXACT integer upscale factor
(lossless recovery of native pixels), trims, shelf-packs, extracts palette."""
from PIL import Image
from pathlib import Path
from collections import Counter
import json

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets'
OUT = ROOT / 'web' / 'assets'

# path, cell_w, cell_h, factor, anims: {name: (start, end_exclusive, fps, loop)}
# frame indices are into that sheet's non-empty frames, row-major. None = all.
SHEETS = [
    ('Sprite_Sheets/Dogelon_Stand.png',      1728, 1728, 27, {'stand':        (None, None,  6, True)}),
    ('Sprite_Sheets/Dogelon_Walk.png',       1728, 1728, 27, {'walk':         (None, None, 10, True)}),
    ('Sprite_Sheets/Dogelon_Run.png',        1728, 1728, 27, {'run':          (None, None, 14, True)}),
    ('Sprite_Sheets/Dogelon_walk_Nogun.png', 1728, 1728, 27, {'walk_nogun':   (None, None, 10, True)}),
    ('Sprite_Sheets/Dogelon_backwalk.png',   1728, 1728, 27, {'backwalk':     (None, None, 10, True)}),
    ('Sprite_Sheets/Dogelon_frontwalk.png',  1728, 1728, 27, {'frontwalk':    (None, None, 10, True)}),
    ('Sprite_Sheets/Dogelon_duck.png',       1728, 1728, 27, {'duck':         (None, None, 16, False)}),
    ('Sprite_Sheets/Dogelon_Slide.png',      1728, 1728, 27, {'slide':        (None, None, 16, True)}),
    ('Sprite_Sheets/Dogelon_Hit.png',        1728, 1728, 27, {'hit':          (None, None, 16, False)}),
    ('Sprite_Sheets/Dogelon_Dead.png',       1728, 1728, 27, {'dead':         (None, None, 12, False)}),
    ('Sprite_Sheets/Dogelon_respawn.png',    1728, 1728, 27, {'respawn':      (None, None, 16, False)}),
    ('Sprite_Sheets/Dogelon_Blast.png',      1728, 1728, 27, {'blast_muzzle': (0, 3, 30, False),
                                                              'blast_bolt':   (3, 10, 20, True),
                                                              'blast_pop':    (10, 13, 24, False)}),
    ('Sprite_Sheets/Dogelon_explode.png',    6912, 5400, 27, {'explode':      (None, None, 14, False)}),
    ('Added sprites/Dogelon_spawn.png',      1024, 2048, 16, {'spawn':        (None, None, 20, False)}),
    ('Added sprites/Dogelon_enemywalk.png',  1728, 1728, 27, {'enemywalk':    (0, 8, 10, True),
                                                              'enemywalk_red':(8, 10, 10, True)}),
    ('Added sprites/Dogelon_enemyfly.png',   1728, 1728, 27, {'enemyfly':     (None, None, 10, True)}),
]
SHIP_DIR = 'Added sprites/Dogelon_Ship'   # 18 pre-sliced 6912x5400, factor 27
SHIP = ('ship', 12, True)

def slice_sheet(path, cw, ch, factor):
    """yield native-resolution frames (trimmed img, ox, oy, native_cw, native_ch)"""
    im = Image.open(SRC / path).convert('RGBA')
    assert im.width % cw == 0 and im.height % ch == 0, f'{path}: {im.size} not divisible by cell {cw}x{ch}'
    ncw, nch = cw // factor, ch // factor
    alpha = im.getchannel('A')
    for r in range(im.height // ch):
        for c in range(im.width // cw):
            box = (c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)
            if not alpha.crop(box).getbbox():
                continue
            cell = im.crop(box).resize((ncw, nch), Image.NEAREST)
            bb = cell.getbbox(alpha_only=True)
            yield cell.crop(bb), bb[0], bb[1], ncw, nch

def collect():
    """returns frames [(img,ox,oy)], anims {name:{frames,fps,loop,feetY,cw,ch}}"""
    frames, anims = [], {}
    for path, cw, ch, fac, sheet_anims in SHEETS:
        sliced = list(slice_sheet(path, cw, ch, fac))
        base = len(frames)
        frames += [(img, ox, oy) for img, ox, oy, _, _ in sliced]
        ncw, nch = cw // fac, ch // fac
        for name, (s, e, fps, loop) in sheet_anims.items():
            s, e = s or 0, e if e is not None else len(sliced)
            idxs = list(range(base + s, base + e))
            feet = max(oy + img.height for img, ox, oy, _, _ in sliced[s:e])
            anims[name] = dict(frames=idxs, fps=fps, loop=loop, feetY=feet, cw=ncw, ch=nch)
    ship_files = sorted((SRC / SHIP_DIR).glob('sprite_*.png'))
    base = len(frames)
    feet = 0
    for f in ship_files:
        im = Image.open(f).convert('RGBA').resize((256, 200), Image.NEAREST)
        bb = im.getbbox()
        frames.append((im.crop(bb), bb[0], bb[1]))
        feet = max(feet, bb[3])
    name, fps, loop = SHIP
    anims[name] = dict(frames=list(range(base, base + len(ship_files))),
                       fps=fps, loop=loop, feetY=feet, cw=256, ch=200)
    return frames, anims

def pack(frames, max_w=2048):
    """shelf packing, tallest first. returns (atlas_img, rects aligned to frames)"""
    order = sorted(range(len(frames)), key=lambda i: -frames[i][0].height)
    PAD = 1
    shelves, rects = [], [None] * len(frames)   # shelf: [x, y, h]
    W, H = max_w, 0
    for i in order:
        img, _, _ = frames[i]
        w, h = img.width + PAD, img.height + PAD
        for sh in shelves:
            if sh[0] + w <= W and h <= sh[2] + PAD:
                rects[i] = (sh[0], sh[1]); sh[0] += w; break
        else:
            shelves.append([w, H, h - PAD]); rects[i] = (0, H); H += h
    atlas = Image.new('RGBA', (W, H))
    for i, (img, _, _) in enumerate(frames):
        atlas.paste(img, rects[i])
    return atlas, rects

def palette(frames):
    counts = Counter()
    for img, _, _ in frames:
        data = img.getdata()
        counts.update(c[:3] for c in data if c[3] > 200)
    total = sum(counts.values())
    keep, acc = [], 0
    for col, n in counts.most_common():
        keep.append('#%02x%02x%02x' % col); acc += n
        if acc / total >= 0.999: break
    return keep

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    frames, anims = collect()
    atlas, rects = pack(frames)
    meta = dict(
        frames=[dict(x=rects[i][0], y=rects[i][1], w=f.width, h=f.height, ox=ox, oy=oy)
                for i, (f, ox, oy) in enumerate(frames)],
        anims=anims)
    atlas.save(OUT / 'atlas.png', optimize=True)
    (OUT / 'atlas.json').write_text(json.dumps(meta))
    pal = palette(frames)
    (OUT / 'palette.json').write_text(json.dumps(pal, indent=0))
    kb = (OUT / 'atlas.png').stat().st_size // 1024
    print(f'frames={len(frames)} anims={len(anims)} atlas={atlas.width}x{atlas.height} '
          f'({kb} KB) palette={len(pal)} colors')
    assert len(frames) == 176, len(frames)
    assert len(anims) == 20, len(anims)
    assert atlas.height <= 2048, 'atlas overflow'

if __name__ == '__main__':
    main()
