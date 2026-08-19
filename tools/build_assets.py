#!/usr/bin/env python3
"""Build web/assets/{atlas.png,atlas.json,palette.json} from the official pack.
Slices row-major grids, downscales by the EXACT integer upscale factor
(lossless recovery of native pixels), trims, shelf-packs, extracts palette."""
from PIL import Image
from pathlib import Path
from collections import Counter
import json, sys

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
    ncw, nch = cw // factor, ch // factor
    alpha = im.getchannel('A')
    for r in range(im.height // ch):
        for c in range(im.width // cw):
            box = (c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)
            if not alpha.crop(box).getbbox():
                continue
            cell = im.crop(box).resize((ncw, nch), Image.NEAREST)
            bb = cell.getbbox()
            yield cell.crop(bb), bb[0], bb[1], ncw, nch
