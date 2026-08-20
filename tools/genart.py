#!/usr/bin/env python3
"""Generate palette-locked pixel art the official pack lacks: Mars tileset,
parallax strips, coin spin, hearts, charge pips. Output: assets-gen/*.png
sheets consumed by build_assets.py's GEN manifest. Deterministic (seeded)."""
from PIL import Image, ImageDraw
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets-gen'

# Palette anchors (from web/assets/palette.json — art choices, not derived)
ROCK, ROCK_DK, ROCK_LT = '#532e6d', '#3a2049', '#7a4b96'   # purple mars rock
DIRT, DIRT_DK = '#982c2c', '#6b1f1f'                        # red-rock accents
GOLD, GOLD_DK = '#eec548', '#b8912e'                        # coin
RED, WHITE, ICE, NAVY = '#ff3a3a', '#ffffff', '#aee6ff', '#1e2f51'

def sheet(w, h): return Image.new('RGBA', (w, h), (0, 0, 0, 0))

def px(d, x, y, c): d.point((x, y), fill=c)

def tiles():
    """4 tiles 16x16: 0 surface (top edge lit), 1 fill, 2 edgeL, 3 edgeR."""
    im = sheet(64, 16); d = ImageDraw.Draw(im); rng = random.Random(7)
    for i in range(4):
        x0 = i * 16
        d.rectangle([x0, 0, x0 + 15, 15], fill=ROCK)
        for _ in range(9):
            px(d, x0 + rng.randrange(16), rng.randrange(16), ROCK_DK)
        for _ in range(4):
            px(d, x0 + rng.randrange(16), rng.randrange(16), DIRT_DK)
    d.rectangle([0, 0, 15, 1], fill=ROCK_LT)          # surface: lit top lip
    d.rectangle([0, 2, 15, 2], fill=DIRT)             # thin oxide seam
    d.rectangle([32, 0, 33, 15], fill=ROCK_LT)        # edgeL lit
    d.rectangle([62, 0, 63, 15], fill=ROCK_DK)        # edgeR shadow
    im.save(OUT / 'tiles.png')

# --- parallax bands ---------------------------------------------------------
# The three band painters below are parameterised on the target image and a
# size scale rather than hard-coded to the game's 640-wide strips, because the
# share-card generator (tools/gencards.py) paints the SAME Mars at 1200 wide.
# Called with s=1.0 and the original sizes they consume the seeded rng in the
# original order, so the shipped par_*.png are byte-identical to before.

def star_field(im, rng, n=90, band=None, big=0.12):
    """Scatter `n` stars over the top `band` rows (default: all but 60)."""
    d = ImageDraw.Draw(im)
    band = band if band is not None else im.height - 60
    for _ in range(n):
        x, y = rng.randrange(im.width), rng.randrange(band)
        c = WHITE if rng.random() < 0.2 else ICE
        px(d, x, y, c)
        if rng.random() < big:                         # a few bigger twinkles
            d.line([x - 1, y, x + 1, y], fill=c); d.line([x, y - 1, x, y + 1], fill=c)
    return im

def mesa_band(im, rng, s=1.0):
    """Far butte silhouette: flat-topped, tapered talus, occasional shoulder."""
    d = ImageDraw.Draw(im); H = im.height
    r = lambda a, b: rng.randrange(int(a * s), int(b * s))
    xpos = 0
    while xpos < im.width:
        w, hgt = r(50, 120), r(40, 100)
        taper = rng.randrange(int(4 * s), min(int(16 * s), w // 3 + 1))
        top = H - hgt
        d.polygon([(xpos, H), (xpos, top + 6), (xpos + taper, top),
                   (xpos + w - taper, top), (xpos + w, top + 6), (xpos + w, H)],
                  fill=NAVY)
        d.rectangle([xpos + taper, top, xpos + w - taper, top + 2], fill='#2c4370')
        if w > 70 * s:                                    # occasional stepped shoulder
            step = rng.randrange(int(10 * s), w - int(20 * s))
            d.rectangle([xpos + step, top + 6, xpos + step + w // 4, top + 22], fill='#243a63')
        xpos += w + r(10, 60)
    return im

def rock_band(im, rng, s=1.0):
    """Near rock triangles, one band closer than the mesas."""
    d = ImageDraw.Draw(im); H = im.height
    r = lambda a, b: rng.randrange(int(a * s), int(b * s))
    xpos = 0
    while xpos < im.width:
        w, hgt = r(20, 60), r(15, 55)
        peak = xpos + rng.randrange(w // 3, 2 * w // 3 + 1)
        d.polygon([(xpos, H), (peak, H - hgt), (xpos + w, H)], fill=ROCK_DK)
        xpos += w + r(5, 40)
    return im

def parallax():
    rng = random.Random(42)
    star_field(sheet(640, 360), rng, 90, 300).save(OUT / 'par_stars.png')

    # The strips are pure terrain and TILE every 640px. Anything that should
    # exist once in the level cannot live in here — see the scene's parallax
    # pass, which places single props against these same bands.
    mesa_band(sheet(640, 120), rng).save(OUT / 'par_mesas.png')
    rock_band(sheet(640, 80), rng).save(OUT / 'par_rocks.png')

def coin():
    """6-frame 12x12 spin: wide→narrow→wide ellipse with $ hint."""
    im = sheet(72, 12); d = ImageDraw.Draw(im)
    widths = [10, 7, 3, 1, 3, 7]
    for i, w in enumerate(widths):
        cx = i * 12 + 6
        d.ellipse([cx - w // 2 - 1, 1, cx + w // 2, 10], fill=GOLD, outline=GOLD_DK)
        if w >= 7:
            d.line([cx - 1, 3, cx - 1, 8], fill=GOLD_DK)
    im.save(OUT / 'coin.png')

def blit(d, x0, y0, rows, color):
    """draw a bitmap (list of strings, '#' = filled pixel) at offset."""
    for ry, row in enumerate(rows):
        for rx, ch in enumerate(row):
            if ch == '#':
                px(d, x0 + rx, y0 + ry, color)

HEART_BMP = [
    '.##.##.',
    '#######',
    '#######',
    '.#####.',
    '..###..',
    '...#...',
]

BOLT_BMP = [
    '....##.',
    '...##..',
    '..##...',
    '.######',
    '....##.',
    '...##..',
    '..##...',
    '.##....',
]

def hud():
    hearts = sheet(20, 10); d = ImageDraw.Draw(hearts)
    for i, (fill, hi) in enumerate([(RED, '#ff7a6a'), ('#3a2430', '#4a3038')]):
        x0 = i * 10
        blit(d, x0 + 1, 1, HEART_BMP, fill)
        px(d, x0 + 2, 2, hi)                      # single glint pixel
    hearts.save(OUT / 'hearts.png')

    pips = sheet(16, 12); d = ImageDraw.Draw(pips)
    for i, (body, hi) in enumerate([(ICE, WHITE), ('#2a3446', '#3a4456')]):
        x0 = i * 8
        blit(d, x0, 2, BOLT_BMP, body)
        px(d, x0 + 4, 3, hi)                      # glint on the top stroke
    pips.save(OUT / 'pips.png')

def main():
    OUT.mkdir(exist_ok=True)
    tiles(); parallax(); coin(); hud()
    made = ['coin.png', 'hearts.png', 'par_mesas.png', 'par_rocks.png',
            'par_stars.png', 'pips.png', 'tiles.png']
    print('generated:', ', '.join(made))
    # Subset check, not an exact listing: assets-gen/ also holds art from OTHER
    # generators (tools/posegen.py's pose_gundown.png), and an equality assert
    # here fails the whole asset build the moment one of those lands.
    on_disk = {p.name for p in OUT.glob('*.png')}
    missing = [f for f in made if f not in on_disk]
    assert not missing, missing

if __name__ == '__main__':
    main()
