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
on the cards. The Mars strip is the game's own parallax band painters from
genart.py at card scale. Deterministic: fixed seeds, same bytes every run.
"""
from PIL import Image, ImageDraw
from pathlib import Path
import random
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from genart import (sheet, mesa_band, rock_band, star_field,
                    ROCK, ROCK_DK, ROCK_LT, DIRT, GOLD, WHITE, NAVY)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'web' / 'share'
FONT_JS = ROOT / 'web' / 'engine' / 'font.js'
ICON = ROOT / 'web' / 'assets' / 'brand' / 'circle-icon-100.png'

W, H = 1200, 630
MARGIN = 64                       # nothing that matters crosses this
BG, SHADOW = '#0b0b12', '#2a1c33'

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


def sky(im):
    """Night-side gradient: a purple bruise at the top fading to page black."""
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, H], fill=BG)
    top = (60, 36, 72)
    for y in range(0, 340):
        k = (1 - y / 340) ** 2
        d.rectangle([0, y, W, y], fill=(int(11 + (top[0] - 11) * k),
                                        int(11 + (top[1] - 11) * k),
                                        int(11 + (top[2] - 11) * k)))


def mars(im):
    """The bottom third: stars, two silhouette bands, a lit ground slab. Same
    painters the game's parallax strips are cut from, scaled up so a butte is a
    butte at 1200 wide instead of a row of pebbles."""
    rng = random.Random(2026)
    stars = sheet(W, H)
    star_field(stars, rng, 260, 430, big=0.16)
    im.alpha_composite(stars)

    GROUND = 96                                  # slab height at the bottom
    # Both bands are placed by their BOTTOM edge, a little below the ground
    # line, so the slab eats their feet and they read as standing behind it
    # rather than floating on it — the same trick the in-game parallax plays.
    # Band heights are one notch taller than the tallest thing the painter can
    # draw at this scale, so a butte keeps its flat top instead of running off
    # the top of its own strip.
    mesas = mesa_band(sheet(W, 200), rng, s=1.8)
    im.alpha_composite(mesas, (0, H - GROUND + 18 - 200))
    rocks = rock_band(sheet(W, 120), rng, s=2.0)
    im.alpha_composite(rocks, (0, H - GROUND + 14 - 120))

    d = ImageDraw.Draw(im)
    d.rectangle([0, H - GROUND, W, H], fill=ROCK)
    d.rectangle([0, H - GROUND, W, H - GROUND + 5], fill=ROCK_LT)   # lit top lip
    d.rectangle([0, H - GROUND + 6, W, H - GROUND + 8], fill=DIRT)  # oxide seam
    rng2 = random.Random(7)
    for _ in range(700):                          # rock speckle, same as tiles()
        x, y = rng2.randrange(W), rng2.randrange(H - GROUND + 10, H)
        d.rectangle([x, y, x + 2, y + 2], fill=ROCK_DK)


def icon(im):
    """The circle icon, nearest-upscaled, bottom-right — off the ground slab so
    it reads as a stamp on the sky rather than a rock."""
    src = Image.open(ICON).convert('RGBA')
    size = 132
    im.alpha_composite(src.resize((size, size), Image.LANCZOS),
                       (W - MARGIN - size, H - 84 - size - 22))


def card(headline, sub, path):
    im = sheet(W, H)
    sky(im)
    mars(im)
    icon(im)
    d = ImageDraw.Draw(im)

    draw_text(d, 'SUCH BLAST', W / 2, 62, 10, WHITE, 'center', SHADOW)

    # The headline is the whole point of the card: as big as the safe width
    # allows, gold, with the drop shadow the game's own titles use.
    hs = fit_scale(headline, W - 2 * MARGIN, 20)
    draw_text(d, headline, W / 2, 190, hs, GOLD, 'center', SHADOW)

    ss = fit_scale(sub, W - 2 * MARGIN - 180, 5)
    draw_text(d, sub, W / 2, 190 + GH * hs + 46, ss, '#c9bde8', 'center', SHADOW)

    im.convert('RGB').save(path)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for t in TIERS:
        head = 'SUCH ATTEMPT' if t == 0 else f'{t}K+ WOW'
        made.append(card(head, 'the gun is your legs.', OUT / f'card-{t}.png'))
    made.append(card('MUCH GAME. VERY MARS.', 'the gun is your legs.', OUT / 'hero.png'))
    print('cards:', ', '.join(p.name for p in made))
    for p in made:
        assert Image.open(p).size == (W, H), p


if __name__ == '__main__':
    main()
