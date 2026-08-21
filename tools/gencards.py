#!/usr/bin/env python3
"""Share cards: web/share/card-{tier}.png + web/share/hero.png, 1200x630.

These are the pictures a link to the game unfurls into on Twitter/Telegram/
Discord. They are COMMITTED art (unlike assets-gen/), because the Cloudflare
worker in share-worker/ points og:image straight at them on the Pages domain
and a scraper has to be able to fetch one without this repo's build ever having
run on the server.

Two rules drove the layout, both of them about the preview box and not about
this file: the score is the only thing anyone reads at thumbnail size, so it
gets the biggest type on the card; and Twitter crops summary_large_image cards
to ~2:1, so nothing that matters goes within MARGIN of an edge.

The type is the GAME's 5x7 bitmap font, parsed straight out of
web/engine/font.js — one source of truth, so a glyph fixed in the game is fixed
on the cards. The backdrop is the GAME's own production art — the banded
sunset sky, the slatted sun, the mesa/rock strips, the flora and monument
silhouettes, and the organic masonry floor band, all pasted straight from
assets-wow/production/*.png (the exact pixels web/assets/atlas.png ships) and
composed with the same layer order + horizon offsets play.js uses, at the
game's native 1px-into-2px scale. A card next to a fresh screenshot is the
same Mars. Deterministic: fixed seeds, same bytes every run.
"""
from PIL import Image, ImageDraw
from pathlib import Path
import random
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'web' / 'share'
FONT_JS = ROOT / 'web' / 'engine' / 'font.js'
ICON = ROOT / 'web' / 'assets' / 'brand' / 'circle-icon-100.png'
PROD = ROOT / 'assets-wow' / 'production'

W, H = 1200, 630
K = 2                             # game pixel scale: compose 600x315, x2
NW, NH = W // K, H // K
MARGIN = 64                       # nothing that matters crosses this

# Locked palette entries (assets-wow/production/PALETTE.json) + the game's own
# warm-white mote color (play.js DECO_COL). No color here is new.
INK = '#38060f'                   # the dusk-glaze maroon — dark ink on bright sky
INK_DEEP = '#27030b'
CREAM = '#fffdf0'                 # warm white (in-game deco mote)
GOLD = '#f9d281'                  # crust highlight gold
HAZE = '#3b190f'                  # far-ground haze fill (play.js uses this hex)

# Tier ladder, in thousands of WOW. 0 is the "such attempt" card a sub-1k (or
# negative — the score CAN go negative) run unfurls into. The worker picks the
# same tier with the same rule; web/game/share.js is the third copy and the
# unit test pins all three to this list.
TIERS = [0, 1, 2, 5, 10, 15, 20, 30, 50]


def load_font():
    """{char: [7 row strings]} parsed out of engine/font.js's G table."""
    glyphs = {}
    for line in FONT_JS.read_text(encoding='utf-8').splitlines():
        m = re.match(r"""\s*(?:'(.)'|"(.)"|([A-Za-z0-9]))\s*:\s*\[(.+)\],\s*$""", line)
        if not m:
            continue
        key = m.group(1) or m.group(2) or m.group(3)
        rows = re.findall(r"'([^']*)'", m.group(4))
        if len(rows) == 7 and all(len(r) == 5 for r in rows):
            glyphs[key] = rows
    assert len(glyphs) > 40, f'font parse got only {len(glyphs)} glyphs'
    return glyphs


FONT = load_font()
GW, GH, GAP = 5, 7, 1


def measure(text, scale):
    return (len(text) * (GW + GAP) - GAP) * scale if text else 0


def draw_text(d, text, x, y, scale, color, align='left', shadow=None, shadow_off=None):
    """Same contract as engine/font.js drawText: x/y is the TOP-LEFT of the text
    box (or the centre/right edge when aligned), every pixel a whole rect."""
    if shadow is not None:
        off = shadow_off if shadow_off is not None else max(1, scale // 2)
        draw_text(d, text, x + off, y + off, scale, shadow, align)
    w = measure(text, scale)
    px = int(round(x - w / 2 if align == 'center' else x - w if align == 'right' else x))
    for ch in text:
        rows = FONT.get(ch) or FONT.get(ch.upper()) or FONT['?']
        for r, row in enumerate(rows):
            c = 0
            while c < GW:
                if row[c] != '#':
                    c += 1
                    continue
                e = c
                while e < GW and row[e] == '#':
                    e += 1
                d.rectangle([px + c * scale, y + r * scale,
                             px + e * scale - 1, y + (r + 1) * scale - 1], fill=color)
                c = e
        px += (GW + GAP) * scale
    return w


def fit_scale(text, max_w, want):
    """Largest scale <= want whose line still fits inside max_w."""
    s = want
    while s > 1 and measure(text, s) > max_w:
        s -= 1
    return s


# --- the production art, loaded once ----------------------------------------
def prod(name):
    return Image.open(PROD / f'{name}.png').convert('RGBA')


SKY, SUN, MESAS, ROCKS = prod('sky'), prod('sun'), prod('mesas'), prod('rocks')
TILESTRIP = prod('tiles')                       # 133 16x16 frames in a row
FLORA = [prod(f'flora_{i}') for i in (0, 1, 2, 5)]   # play.js's shelf picks
# The repeating ancient-monument family (play.js LANDMARKS). prop1/prop2 are
# the one-of-each story props and never appear here.
MONUMENTS = [prod(n) for n in ('prop_head', 'prop_obelisk', 'prop_mgate', 'prop_ribs')]

STRIP_W = SKY.width                             # 640: all bands tile at this


def paste_wrapped(im, src, off, y, width=NW):
    """Paste a horizontal slice of a tiling 640-wide band, starting at source
    column `off`, exactly the two source-rect cuts play.js's band() makes."""
    off = off % STRIP_W
    w1 = min(width, STRIP_W - off)
    im.alpha_composite(src.crop((off, 0, off + w1, src.height)), (0, y))
    if w1 < width:
        im.alpha_composite(src.crop((0, 0, width - w1, src.height)), (w1, y))


def tile_frame(i):
    return TILESTRIP.crop((i * 16, 0, i * 16 + 16, 16))


# --- the backdrop: play.js's render pass at rest camera ----------------------
# Same layer order and the same horizon arithmetic as the game (restLine is the
# skyline rest height; mesa bottoms sit +4 below it, rocks +10, the haze crop
# -10, exactly play.js's bias values), with the floor slab as three courses of
# the organic masonry band: the sunlit surface crust and two ember-veined fill
# courses below it.
SLAB_H = 48                                     # 3 x 16px courses
SLAB_TOP = NH - SLAB_H                          # 267
REST = SLAB_TOP - 10                            # skyline rest height


def mars(im, rng):
    # Sky: the exact visible slice, cropped at the haze line like drawSky.
    haze_top = REST - 10
    paste_wrapped(im, SKY.crop((0, 0, STRIP_W, haze_top)), rng.randrange(STRIP_W), 0)

    # The slatted sun, one placement, sinking behind the mesa band — the
    # late-run sky, which is the one worth bragging over.
    im.alpha_composite(SUN, (rng.randrange(150, 380), rng.randrange(80, 104)))

    # Far mesas, then the haze shelf fill, then the near rock ridge.
    m_off, r_off = rng.randrange(STRIP_W), rng.randrange(STRIP_W)
    paste_wrapped(im, MESAS, m_off, REST + 4 - MESAS.height)
    d = ImageDraw.Draw(im)
    d.rectangle([0, haze_top + 8, NW, SLAB_TOP], fill=HAZE)
    paste_wrapped(im, ROCKS, r_off, REST + 10 - ROCKS.height)

    # Shelf dressing, feet on the haze line like the game's flora/monument
    # pass: a monument silhouette and a sparse hedge of flora.
    mon = MONUMENTS[rng.randrange(len(MONUMENTS))]
    mx = rng.randrange(40, NW - 140)
    im.alpha_composite(mon, (mx, SLAB_TOP - 4 - mon.height))
    for _ in range(4):
        f = FLORA[rng.randrange(len(FLORA))]
        fx = rng.randrange(0, NW - 30)
        if abs(fx - mx) < 50:
            continue                            # gaps in the hedge
        im.alpha_composite(f, (fx, SLAB_TOP - 12 - f.height))

    # The floor: organic masonry, straight off the production tileset — the
    # surface crust course (frames 0..15 by x phase) over depth-1 and depth-2
    # fill courses (frame 16 + (d-1)*16 + phase), phase-aligned so the stone
    # band runs continuously just like pickTileFrame lays it in the level.
    phase0 = rng.randrange(16)
    for tx in range(0, NW // 16 + 1):
        p = (tx + phase0) % 16
        im.alpha_composite(tile_frame(p), (tx * 16, SLAB_TOP))
        im.alpha_composite(tile_frame(16 + p), (tx * 16, SLAB_TOP + 16))
        im.alpha_composite(tile_frame(32 + p), (tx * 16, SLAB_TOP + 32))


def icon(im):
    """The circle icon, bottom-right, standing on the masonry slab like a
    stamp — clear of the safe margin and the sub line."""
    src = Image.open(ICON).convert('RGBA')
    size = 132
    im.alpha_composite(src.resize((size, size), Image.LANCZOS),
                       (W - MARGIN - size, H - 84 - size - 22))


def card(headline, sub, path, seed):
    # Backdrop at game-native 600x315, seeded per card so every tier stands at
    # its own spot along the run, then x2 nearest — the game's own pixel scale.
    native = Image.new('RGBA', (NW, NH), (0, 0, 0, 0))
    mars(native, random.Random(seed))
    im = native.resize((W, H), Image.NEAREST)
    icon(im)
    d = ImageDraw.Draw(im)

    # Dark ink on the bright sky, the way the mesas sit on it — with a cream
    # kick under the headline so it pops at thumbnail size.
    draw_text(d, 'SUCH BLAST', W / 2, 62, 10, INK, 'center', GOLD)

    # The headline is the whole point of the card: as big as the safe width
    # allows, warm white over its own long dusk shadow.
    hs = fit_scale(headline, W - 2 * MARGIN, 20)
    draw_text(d, headline, W / 2, 190, hs, CREAM, 'center', INK)

    # Cream over ink like the headline: the sub line falls where the sky hands
    # off to the mesa band, and it has to read on both.
    ss = fit_scale(sub, W - 2 * MARGIN - 180, 5)
    draw_text(d, sub, W / 2, 190 + GH * hs + 46, ss, GOLD, 'center', INK_DEEP)

    im.convert('RGB').save(path)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for t in TIERS:
        head = 'SUCH ATTEMPT' if t == 0 else f'{t}K+ WOW'
        made.append(card(head, 'the gun is your legs.', OUT / f'card-{t}.png', 2026 + t))
    made.append(card('MUCH GAME. VERY MARS.', 'the gun is your legs.', OUT / 'hero.png', 1488))
    print('cards:', ', '.join(p.name for p in made))
    for p in made:
        assert Image.open(p).size == (W, H), p


if __name__ == '__main__':
    main()
