#!/usr/bin/env python3
"""Full production asset build for the picked direction (late-afternoon canyon).

Sources are the committed raws under assets-wow/raw/ (prompt + output pairs);
this file is a pure function of them: chroma-key extraction, tileable wrap
blending, ONE locked master palette derived from the picked direction sheet,
and in-context mock composition on the REAL layer geometry from
web/game/scenes/play.js:

  horizon (restLine at rest camera)  y=232
  mesa strip 640x120, bottom at      y=236   (band bias 4)
  rock strip 640x80, bottom at       y=242   (band bias 10)
  far-ground haze fill from          y=222   (rocksBottom-20)
  ground: 8 rows of 16px tiles from  y=232
  sky layer scrolls at 0.10x and is drawn twice at 640 offsets -> every
  full-frame sky MUST tile horizontally; the sun therefore ships as a
  separate alpha cameo placed once (the scene already has a single-prop pass).

Outputs: assets-wow/production/*.png + PALETTE.json + mocks in
assets-wow/production/mocks/.
"""
from PIL import Image, ImageDraw
from pathlib import Path
import json
import random

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'assets-wow' / 'raw'
PROD = ROOT / 'assets-wow' / 'production'
MOCKS = PROD / 'mocks'
VW, VH = 640, 360
HORIZON, MESA_BOT, ROCK_BOT, HAZE_Y = 232, 236, 242, 222

# --------------------------------------------------------------------------
# atlas sprites (official pack, read-only)
# --------------------------------------------------------------------------

def load_sprites():
    meta = json.loads((ROOT / 'web/assets/atlas.json').read_text())
    atlas = Image.open(ROOT / 'web/assets/atlas.png')
    out = {}
    for name in ('run', 'stand', 'enemywalk', 'enemywalk_red', 'enemyfly',
                 'enemyfly_red', 'coin', 'ship'):
        an = meta['anims'][name]
        f = meta['frames'][an['frames'][0]]
        img = atlas.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
        out[name] = (img.convert('RGBA'), f, an)
    return out

def paste_feet(comp, sprite, x, feet_y, scale=1):
    img, f, an = sprite
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    px = x - (an['cw'] * scale) // 2 + f['ox'] * scale
    py = feet_y - an['feetY'] * scale + f['oy'] * scale
    comp.alpha_composite(img, (px, py))

# --------------------------------------------------------------------------
# craft helpers
# --------------------------------------------------------------------------

def chroma_key(im):
    """Green screen -> transparent. Conservative: kills green-dominant pixels."""
    im = im.convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if g > 100 and g > r + 40 and g > b + 40:
                px[x, y] = (0, 0, 0, 0)
    return im

def wrap_blend(im, band=32):
    """Make horizontally tileable: swap halves (seam moves to center), then
    crossfade the center seam band against the original. Outer edges then come
    from the continuous middle of the original -> tiles perfectly."""
    W, H = im.size
    half = W // 2
    rolled = Image.new(im.mode, im.size)
    rolled.paste(im.crop((half, 0, W, H)), (0, 0))
    rolled.paste(im.crop((0, 0, half, H)), (W - half, 0))
    rp, op = rolled.load(), im.load()
    x0 = half - band // 2
    for i in range(band):
        t = i / (band - 1)
        w = (3 * t * t - 2 * t * t * t) * (1 - abs(2 * t - 1))
        for y in range(H):
            a = rp[x0 + i, y]; b = op[x0 + i, y]
            rp[x0 + i, y] = tuple(round(a[k] + (b[k] - a[k]) * w)
                                  for k in range(len(a)))
    return rolled

def seam_score(im):
    """Mean abs RGB delta between the 4px strips either side of the wrap
    seam, each strip averaged per row first so ordered-dither phase does not
    register as a seam. Lower = cleaner tile."""
    px = im.convert('RGB').load()
    W, H = im.size
    tot = 0
    for y in range(H):
        a = [sum(px[W - 1 - i, y][k] for i in range(4)) / 4 for k in range(3)]
        b = [sum(px[i, y][k] for i in range(4)) / 4 for k in range(3)]
        tot += sum(abs(a[k] - b[k]) for k in range(3))
    return tot / (H * 3)

def objects_from(keyed, min_area=250):
    """Split a chroma-keyed sheet into per-object crops via connected
    components (column runs fail when tall pieces overhang neighbors).
    Components are found on a 2x-downsampled alpha mask (8-connectivity, so
    thin diagonal twigs stay whole), then cropped from the full-res image.
    Ordered left to right."""
    import numpy as np
    a = np.array(keyed.getchannel('A').reduce(2)) > 40
    H, W = a.shape
    seen = np.zeros_like(a, dtype=bool)
    comps = []
    for sy in range(H):
        for sx in range(W):
            if not a[sy, sx] or seen[sy, sx]:
                continue
            stack = [(sy, sx)]
            seen[sy, sx] = True
            x0 = x1 = sx; y0 = y1 = sy; area = 0
            while stack:
                y, x = stack.pop()
                area += 1
                x0 = min(x0, x); x1 = max(x1, x)
                y0 = min(y0, y); y1 = max(y1, y)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < H and 0 <= nx < W and a[ny, nx] \
                                and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            if area * 4 >= min_area:
                comps.append((x0 * 2, y0 * 2, x1 * 2 + 2, y1 * 2 + 2))
    out = []
    for x0, y0, x1, y1 in sorted(comps):
        crop = keyed.crop((x0, y0, x1, y1))
        bb = crop.getbbox()
        out.append(crop.crop(bb))
    return out

def fit_h(im, h):
    w = max(1, round(im.width * h / im.height))
    return im.resize((w, h), Image.LANCZOS)

def quantize_to(im, palimg, keep_alpha=True):
    rgb = im.convert('RGB')
    q = rgb.quantize(palette=palimg, dither=Image.Dither.NONE).convert('RGB')
    if keep_alpha and im.mode == 'RGBA':
        out = q.convert('RGBA')
        alpha = im.getchannel('A').point(lambda a: 255 if a >= 128 else 0)
        out.putalpha(alpha)
        return out
    return q.convert('RGBA')

# --------------------------------------------------------------------------
# master palette: the picked direction sheet is the base; family raws add
# only the entries the base lacks (dedup by RGB distance)
# --------------------------------------------------------------------------

def build_palette():
    from genart_v2_post import to_native
    base_img, _ = to_native(RAW / 'hybrid_b_late_afternoon' / 'raw_0.jpg', 40)
    colors = [c for _, c in base_img.convert('RGB').getcolors(1 << 20)]
    master = []
    def add(c):
        for m in master:
            if sum(abs(c[k] - m[k]) for k in range(3)) < 30:
                return
        master.append(c)
    for c in sorted(set(colors)): add(c)
    extras = [('prod_flora', 14, True), ('prod_props', 10, True),
              ('prod_sky_boss', 8, False), ('prod_sky_wow', 10, False),
              ('prod_title', 16, False)]
    for name, n, keyed in extras:
        im = Image.open(RAW / name / 'raw_0.jpg')
        if keyed:
            im = chroma_key(im)
            rgbs = [p[:3] for p in im.getdata() if p[3] > 128]
            tmp = Image.new('RGB', (len(rgbs) or 1, 1))
            tmp.putdata(rgbs or [(0, 0, 0)])
            q = tmp.quantize(colors=n, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
        else:
            q = im.convert('RGB').quantize(colors=n, method=Image.MEDIANCUT,
                                           dither=Image.Dither.NONE)
        pal = q.getpalette()
        for i in range(n):
            add(tuple(pal[i * 3:i * 3 + 3]))
    for c in ((226, 120, 40), (245, 170, 70), (232, 165, 78)):
        if c not in master: master.append(c)
    master = master[:64]
    palimg = Image.new('P', (1, 1))
    flat = []
    for c in master: flat += list(c)
    flat += list(master[-1]) * (256 - len(master))
    palimg.putpalette(flat)
    return master, palimg

# --------------------------------------------------------------------------
# asset builders
# --------------------------------------------------------------------------


BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]

def banded_sky(src, master, embers=None):
    """src: RGB image already cropped to the wanted sky window. Returns a
    640x360 clean banded sky: per-row mean color, vertically smoothed, then
    ordered-dithered between neighbors of the sky's own 8-color ramp. The
    ramp colors are folded into the master palette (dedup by distance) so
    the ONE locked palette stays the whole truth."""
    im = src.resize((64, VH), Image.LANCZOS)
    px = im.load()
    rows = []
    for y in range(VH):
        r = g = b = 0
        for x in range(64):
            c = px[x, y]
            r += c[0]; g += c[1]; b += c[2]
        rows.append((r / 64, g / 64, b / 64))
    sm = []
    K = 9
    for y in range(VH):
        acc = [0.0, 0.0, 0.0]; n = 0
        for k in range(-K, K + 1):
            yy = min(VH - 1, max(0, y + k))
            for i in range(3): acc[i] += rows[yy][i]
            n += 1
        sm.append(tuple(a / n for a in acc))
    tmp = Image.new('RGB', (1, VH))
    tmp.putdata([tuple(round(v) for v in c) for c in sm])
    q = tmp.quantize(colors=8, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    qp = q.getpalette()
    ramp = []
    for i in range(8):
        c = tuple(qp[i * 3:i * 3 + 3])
        snapped = None
        for m in master:
            if sum(abs(c[k] - m[k]) for k in range(3)) < 20:
                snapped = m
                break
        if snapped is None:
            master.append(c); snapped = c
        if snapped not in ramp:
            ramp.append(snapped)
    ramp.sort(key=sum)
    out = Image.new('RGB', (VW, VH))
    op = out.load()
    for y in range(VH):
        c = sm[y]
        ds = sorted(ramp, key=lambda m: sum((c[i] - m[i]) ** 2 for i in range(3)))
        p1, p2 = ds[0], ds[1] if len(ds) > 1 else ds[0]
        d1 = sum((c[i] - p1[i]) ** 2 for i in range(3)) ** 0.5
        d2 = sum((c[i] - p2[i]) ** 2 for i in range(3)) ** 0.5
        t = 0.0 if d1 + d2 == 0 else d1 / (d1 + d2)
        for x in range(VW):
            op[x, y] = p2 if t * 16 > BAYER4[y % 4][x % 4] + 0.5 else p1
    if embers:
        import random as _r
        rng = _r.Random(embers)
        for _ in range(90):
            x, y = rng.randrange(VW), rng.randrange(VH * 22 // 100, VH * 62 // 100)
            op[x, y] = (226, 120, 40) if rng.random() < 0.7 else (245, 170, 70)
    return out.convert('RGBA')

def build_sky_base(master):
    """Gauntlet sky: the picked sheet's own banded sky (left of the sun),
    re-rendered as a clean palette-locked band gradient."""
    raw = Image.open(RAW / 'hybrid_b_late_afternoon' / 'raw_0.jpg').convert('RGB')
    return banded_sky(raw.crop((30, 8, 670, 330)), master)

def build_sky_variant(name, master, y_frac=(0.0, 1.0), embers=None):
    raw = Image.open(RAW / name / 'raw_0.jpg').convert('RGB')
    y0, y1 = int(raw.height * y_frac[0]), int(raw.height * y_frac[1])
    return banded_sky(raw.crop((0, y0, raw.width, y1)), master, embers=embers)

def build_sun(palimg):
    """Slatted sun cameo, alpha-cut, palette colors; placed once by the scene
    (never baked into the tiling sky)."""
    R = 62
    im = Image.new('RGBA', (2 * R + 4, 2 * R + 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = R + 2
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill='#f6cf7e')
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline='#e8a54e')
    d.ellipse([cx - R + 6, cy - R + 6, cx + R - 10, cy + R - 20], fill='#f8dc9a')
    # slat cuts start ABOVE center: the lower half sinks behind the mesa
    # strip, so cuts must live in the visible upper portion of the disc
    for gy, gh in ((cy - 4, 2), (cy + 6, 3), (cy + 17, 4), (cy + 29, 5),
                   (cy + 43, 6)):
        d.rectangle([0, gy, im.width, gy + gh], fill=(0, 0, 0, 0))
    return quantize_to(im, palimg)

def build_strip(name, size, palimg):
    keyed = chroma_key(Image.open(RAW / name / 'raw_0.jpg'))
    bb = keyed.getbbox()
    band = keyed.crop((0, bb[1], keyed.width, keyed.height))
    im = band.resize(size, Image.LANCZOS)
    im = wrap_blend(im)
    return quantize_to(im, palimg)

def build_tiles(palimg, base_sheet):
    """10-frame 16px tileset — TRUE MASONRY, rebuilt to the APPROVED direction
    sheet (hybrid_b): chunky stone-block courses with dark mortar seams, ember
    cracks glowing in the joints, and a strong lit crust edge. The first
    production build silently simplified this to a calmed near-flat fill (the
    mock passed review, the sheet's material didn't ship) — caught in the
    user playtest round. Block/mortar/crack colors are the sheet's own floor
    band colors (sampled + verified against the native re-render), and every
    tile is drawn on one fixed joint grid so any frame meshes with any
    neighbour: courses are 8px, vertical joints sit at the same x per course
    across all frames, so the bond runs unbroken across tile boundaries.
    frames: 0 surface, 1 fill, 2 edgeL (pit on the LEFT), 3 edgeR, 4
    underside, 5/6 surface variants, 7 fill variant, 8 pitwallL, 9 pitwallR."""
    # Sheet floor colors (from the native re-render's floor band, see the fix
    # round's sampling): block bodies, lit block tops, mortar darks, embers.
    BLOCKS = [(118, 6, 19), (100, 4, 22), (109, 10, 21), (125, 49, 24)]
    MORTAR = (46, 9, 19)
    EMBER = [(225, 97, 26), (188, 80, 24), (234, 159, 58)]
    CRUST_HI = (251, 214, 128)
    lit = lambda c, k: tuple(min(255, int(v * k + 10)) for v in c)
    drk = lambda c, k: tuple(max(0, int(v * k)) for v in c)

    # Lit block tops, sampled straight off the sheet's stones rather than
    # derived: the sheet lights its crimson blocks with an ORANGE-brown edge,
    # and multiplying the base red never lands there.
    TOPLIT = [(156, 57, 23), (134, 42, 20), (122, 39, 23)]

    def block(d, rng, x0, x1, y0, y1, dim):
        """One chunky stone block: mottled crimson body, orange-lit top,
        shadowed bottom, 2px-notched (rounded) corners like the sheet's."""
        base = drk(BLOCKS[rng.randrange(len(BLOCKS))], dim)
        top = drk(TOPLIT[rng.randrange(len(TOPLIT))], dim)
        d.rectangle([x0, y0, x1, y1], fill=base)
        d.rectangle([x0, y0, x1, y0], fill=top)
        d.rectangle([x0 + 2, y0 + 1, x1 - 2, y0 + 1], fill=lit(base, 1.16))
        d.rectangle([x0, y1, x1, y1], fill=drk(base, 0.66))
        for cx, cy, dx2, dy2 in ((x0, y0, 1, 0), (x1, y0, -1, 0),
                                 (x0, y1, 1, 0), (x1, y1, -1, 0)):
            d.point((cx, cy), fill=drk(base, 0.6))             # 2px round corner
            d.point((cx + dx2, cy + dy2), fill=drk(base, 0.82))
        for _ in range(5):                                     # body mottle
            nx = rng.randint(x0 + 1, max(x0 + 1, x1 - 2))
            ny = rng.randint(y0 + 2, max(y0 + 2, y1 - 1))
            d.rectangle([nx, ny, nx + 1, ny], fill=drk(base, 0.85))
        if rng.random() < 0.6:
            d.point((rng.randint(x0 + 1, x1 - 1), rng.randint(y0 + 2, y1 - 1)),
                    fill=lit(base, 1.2))

    def crack(d, rng, x, y0, y1):
        """Ember crack glowing in a joint: bright gold core, ember ends,
        a jink or two on the way down — the sheet's signature detail."""
        y = y0
        while y <= y1:
            e = EMBER[2] if y0 < y < y1 and rng.random() < 0.45 else \
                EMBER[rng.randrange(2)]
            d.point((x % 16, y), fill=e)
            if rng.random() < 0.35:
                x += rng.choice([-1, 1])
            y += 1

    def masonry(seed, dim=1.0, cracks=0, top=0, bot=15, split=False):
        """One 16px course: a single chunky stone per tile (mortar seam on
        the right column + bottom row, so neighbours share 1px joints), or a
        split pair on the variant frames — block widths then read 8..16px
        against the hash-scattered variants, like the sheet's mixed sizes."""
        t = Image.new('RGB', (16, 16))
        d = ImageDraw.Draw(t)
        rng = random.Random(seed)
        d.rectangle([0, top, 15, bot], fill=MORTAR)
        if split:
            mid = (top + bot) // 2
            block(d, rng, 0, 14, top, mid - 1, dim)
            block(d, rng, 0, 14, mid + 1, bot - 1, dim)
        else:
            block(d, rng, 0, 14, top, bot - 1, dim)
        joint = 15
        for _ in range(cracks):
            cx = joint if rng.random() < 0.7 else 15
            cy = rng.randint(top, max(top, bot - 6))
            crack(d, rng, cx, cy, min(bot - 1, cy + rng.randint(3, 6)))
        return t

    def surface(seed, cracks=1, embers=2):
        """Surface tile: the sheet's strong lit crust — a bumpy bright-gold
        lip, an ember row broken by dark cracks — over a shortened course."""
        t = masonry(seed, 1.05, cracks, top=4, bot=15, split=seed == 17)
        d = ImageDraw.Draw(t)
        rng = random.Random(seed ^ 0x5eed)
        d.rectangle([0, 0, 15, 0], fill=CRUST_HI)
        d.rectangle([0, 1, 15, 1], fill=(240, 176, 74))
        d.rectangle([0, 2, 15, 2], fill=(224, 129, 38))
        d.rectangle([0, 3, 15, 3], fill=(148, 73, 35))
        for _ in range(2):                                     # bumpy lip
            bx = rng.randrange(16)
            d.point((bx, 1), fill=CRUST_HI)
        for _ in range(3):                                     # crust cracks
            cx = rng.randrange(16)
            d.point((cx, 2), fill=(61, 10, 18))
            if rng.random() < 0.6:
                d.point((cx, 3), fill=(33, 5, 16))
        for _ in range(embers):                                # crust embers
            d.point((rng.randrange(16), 3), fill=EMBER[rng.randrange(3)])
        return t

    im = Image.new('RGBA', (160, 16), (0, 0, 0, 0))
    def put(i, tile): im.paste(tile.convert('RGBA'), (i * 16, 0))

    put(0, surface(3, cracks=2, embers=2))
    put(5, surface(17, cracks=2, embers=3))                    # worn: more ember
    v6 = surface(29, cracks=1, embers=2)                       # worn: cracked block
    d6 = ImageDraw.Draw(v6)
    d6.line([4, 6, 6, 9], fill=MORTAR)
    d6.point((5, 7), fill=EMBER[0])
    put(6, v6)
    put(1, masonry(7, 0.92))                                   # quiet fill
    put(7, masonry(23, 0.92, cracks=2, split=True))            # split + ember fill

    def lit_col(t, x):
        d = ImageDraw.Draw(t)
        d.rectangle([x, 0, x, 15], fill=(232, 165, 78))        # lit pit-facing edge
        d.rectangle([x + (1 if x == 0 else -1), 2,
                     x + (1 if x == 0 else -1), 15], fill=(138, 64, 48))
        return t
    put(2, lit_col(surface(3, cracks=0, embers=1), 0))         # pit to the LEFT
    put(3, lit_col(surface(17, cracks=0, embers=1), 15))       # pit to the RIGHT

    un = masonry(41, 0.8)                                      # underside lip
    dU = ImageDraw.Draw(un)
    dU.rectangle([0, 15, 15, 15], fill=(29, 11, 16))
    dU.rectangle([0, 14, 15, 14], fill=(58, 18, 22))
    put(4, un)

    for i, seed, lx in ((8, 51, 0), (9, 63, 15)):              # pit walls: darker
        t = masonry(seed, 0.62)
        dP = ImageDraw.Draw(t)
        dP.rectangle([lx, 0, lx, 15], fill=(176, 96, 48))      # lit pit-facing edge
        rng = random.Random(11 + i)
        for _ in range(2):
            x, y = rng.randrange(3, 13), rng.randrange(2, 14)
            dP.line([x, y, x + rng.randrange(1, 3), y + rng.randrange(1, 4)],
                    fill=(194, 84, 15))                        # ember crack
        put(i, t)
    return quantize_to(im, palimg)

def build_objects(name, heights, palimg):
    objs = objects_from(chroma_key(Image.open(RAW / name / 'raw_0.jpg')))
    out = []
    for i, ob in enumerate(objs[:len(heights)]):
        out.append(quantize_to(fit_h(ob, heights[i]), palimg))
    return out

def build_cameos(palimg):
    """The two atlas cameo props, re-lit into the production palette at the
    same silhouette scale (silhouettes untouched)."""
    out = []
    for fname in ('deco1.png', 'deco2.png'):
        im = Image.open(ROOT / 'assets-extra' / fname).convert('RGBA')
        q = quantize_to(im, palimg)
        px = q.load()
        for x in range(q.width):                          # gold rim on top lip
            for y in range(q.height):
                if px[x, y][3] > 0:
                    if (x + y) % 2 == 0:
                        px[x, y] = (232, 165, 78, 255)
                    break
        out.append(q)
    return out


def haze_push(im, tint, k, palimg):
    """Atmospheric perspective: blend opaque pixels toward a horizon tint."""
    o = im.copy(); px = o.load()
    for y in range(o.height):
        for x in range(o.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (round(r + (tint[0] - r) * k),
                            round(g + (tint[1] - g) * k),
                            round(b + (tint[2] - b) * k), a)
    return quantize_to(o, palimg)

def darken_keep_alpha(im, k, palimg):
    o = im.copy(); px = o.load()
    for y in range(o.height):
        for x in range(o.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (int(r * k), int(g * k), int(b * k), a)
    return quantize_to(o, palimg)

def ember_shift(im, palimg):
    """WOW-zone push: warm the tileset toward ember and re-lock to palette."""
    rgb = im.convert('RGB')
    r, g, b = rgb.split()
    r = r.point(lambda v: min(255, int(v * 1.3 + 12)))
    g = g.point(lambda v: int(v * 0.72))
    b = b.point(lambda v: int(v * 0.55))
    shifted = Image.merge('RGB', (r, g, b)).convert('RGBA')
    shifted.putalpha(im.getchannel('A'))
    return quantize_to(shifted, palimg)

# --------------------------------------------------------------------------
# in-context mock composition (real render order)
# --------------------------------------------------------------------------

HAZE = (58, 18, 22, 255)      # deep maroon replacing play.js's #2a1c33

def strip_x(comp, im, off, bottom):
    off = off % im.width
    y = bottom - im.height
    comp.alpha_composite(im, (-off, y))
    comp.alpha_composite(im, (im.width - off, y))

def compose(A, *, sky, sun_at=None, mesa_off=0, rock_off=0, tiles=None,
            props_at=(), flora_mid=(), flora_play=(), pit=None, seed=5):
    comp = Image.new('RGBA', (VW, VH))
    off = (mesa_off // 3) % VW
    comp.alpha_composite(sky, (-off, 0))
    comp.alpha_composite(sky, (VW - off, 0))
    if sun_at:
        comp.alpha_composite(A['sun'], sun_at)
    strip_x(comp, A['mesas'], mesa_off, MESA_BOT)
    d = ImageDraw.Draw(comp)
    d.rectangle([0, HAZE_Y, VW, VH], fill=HAZE)
    for name, x in props_at:                              # single-prop pass
        p = A['props'][name]
        comp.alpha_composite(p, (x, ROCK_BOT - p.height))
    for idx, x in flora_mid:
        f = A['flora'][idx]
        comp.alpha_composite(f, (x, ROCK_BOT - f.height))
    strip_x(comp, A['rocks'], rock_off, ROCK_BOT)
    tiles = tiles if tiles is not None else A['tiles']
    fr = [tiles.crop((i * 16, 0, i * 16 + 16, 16)) for i in range(10)]
    rng = random.Random(seed)
    pit = pit or ()
    for tx in pit:                                       # pit void: fades down
        for yy in range(HORIZON, VH):
            k = (yy - HORIZON) / (VH - HORIZON)
            c = (round(46 - 40 * k), round(14 - 12 * k), round(16 - 14 * k))
            d.line([tx * 16, yy, tx * 16 + 15, yy], fill=c)
    for ty in range(8):
        for tx in range(VW // 16):
            if tx in pit:
                continue
            if ty == 0:
                if tx + 1 in pit:   t = fr[3]            # lit pit-facing edge
                elif tx - 1 in pit: t = fr[2]
                else:
                    t = fr[0] if rng.random() < 0.75 else rng.choice([fr[5], fr[6]])
            elif tx + 1 in pit:
                t = fr[9]
            elif tx - 1 in pit:
                t = fr[8]
            else:
                t = fr[1] if rng.random() < 0.85 else fr[7]
            comp.alpha_composite(t, (tx * 16, HORIZON + ty * 16))
    for r0, r1, al in ((2, 5, 0.15), (5, 8, 0.30)):        # floor depth bands
        band = Image.new('RGBA', (VW, (r1 - r0) * 16), (0, 0, 0, int(al * 255)))
        comp.alpha_composite(band, (0, HORIZON + r0 * 16))
    for idx, x in flora_play:                              # playfield flora
        f = A['flora'][idx]
        comp.alpha_composite(f, (x, HORIZON - f.height + 1))
    return comp

def up2(im):
    return im.resize((im.width * 2, im.height * 2), Image.NEAREST)

# --------------------------------------------------------------------------

def main():
    PROD.mkdir(parents=True, exist_ok=True)
    MOCKS.mkdir(parents=True, exist_ok=True)
    master, palimg = build_palette()
    sprites = load_sprites()
    from genart_v2_post import to_native
    base_sheet, _ = to_native(RAW / 'hybrid_b_late_afternoon' / 'raw_0.jpg', 40)

    A = {}
    A['sky'] = build_sky_base(master)
    A['sky_boss'] = build_sky_variant('prod_sky_boss', master)
    A['sky_wow'] = build_sky_variant('prod_sky_wow', master, y_frac=(0.45, 1.0), embers=77)
    A['sun'] = build_sun(palimg)
    A['mesas'] = build_strip('prod_mesas', (VW, 120), palimg)
    A['mesas'] = haze_push(A['mesas'], (214, 122, 44), 0.28, palimg)
    A['rocks'] = build_strip('prod_rocks_strip', (VW, 80), palimg)
    A['rocks'] = haze_push(A['rocks'], (120, 52, 34), 0.22, palimg)
    A['rocks'] = darken_keep_alpha(A['rocks'], 0.80, palimg)
    A['tiles'] = build_tiles(palimg, base_sheet)
    A['tiles_wow'] = ember_shift(A['tiles'], palimg)
    props = build_objects('prod_props', [64, 56, 40], palimg)
    A['props'] = {'spire': props[0], 'arch': props[1], 'wreck': props[2]}
    A['flora'] = build_objects('prod_flora', [34, 44, 22, 16, 12, 32, 7, 7], palimg)
    A['title'] = quantize_to(
        Image.open(RAW / 'prod_title' / 'raw_0.jpg').convert('RGB')
        .crop((10, 0, 1376 - 10, 768)).resize((VW, VH), Image.LANCZOS)
        .convert('RGBA'), palimg, keep_alpha=False)
    cam = build_cameos(palimg)
    A['prop1'], A['prop2'] = cam

    for k in ('sky', 'sky_boss', 'sky_wow', 'sun', 'mesas', 'rocks', 'tiles',
              'tiles_wow', 'title', 'prop1', 'prop2'):
        A[k].save(PROD / f'{k}.png')
    for k, v in A['props'].items():
        v.save(PROD / f'prop_{k}.png')
    for i, f in enumerate(A['flora']):
        f.save(PROD / f'flora_{i}.png')

    seams = {k: round(seam_score(A[k]), 2) for k in ('sky', 'sky_boss', 'sky_wow',
                                                     'mesas', 'rocks')}
    used = set()
    for k in ('sky', 'sky_boss', 'sky_wow', 'sun', 'mesas', 'rocks', 'tiles',
              'tiles_wow', 'title', 'prop1', 'prop2'):
        used |= {p[:3] for p in A[k].getdata() if len(p) < 4 or p[3] > 0}
    (PROD / 'PALETTE.json').write_text(json.dumps({
        'master': ['#%02x%02x%02x' % c for c in master],
        'master_count': len(master),
        'used_across_assets': len(used),
        'seam_scores': seams}, indent=1))

    # ---- mocks -----------------------------------------------------------
    m = compose(A, sky=A['sky'], sun_at=(352, 66), mesa_off=0, rock_off=0,
                props_at=[('arch', 60)], flora_mid=[(3, 300)],
                flora_play=[(0, 96), (5, 340), (4, 520), (6, 590)],
                pit=range(26, 29), seed=5)
    paste_feet(m, sprites['run'], 180, HORIZON)
    paste_feet(m, sprites['enemywalk'], 430, HORIZON)
    paste_feet(m, sprites['enemyfly'], 545, HORIZON - 78)
    coin = sprites['coin'][0]
    for i, cx in enumerate((240, 262, 284)):
        m.alpha_composite(coin, (cx, HORIZON - 46 - (4 if i == 1 else 0)))
    up2(m).save(MOCKS / 'gauntlet_early.png')

    m = compose(A, sky=A['sky'], sun_at=(296, 66), mesa_off=320, rock_off=480,
                props_at=[('spire', 500), ('wreck', 90)], flora_mid=[(2, 240)],
                flora_play=[(1, 60), (4, 300), (3, 600)],
                pit=range(14, 16), seed=9)
    paste_feet(m, sprites['run'], 340, HORIZON)
    paste_feet(m, sprites['enemywalk'], 470, HORIZON)
    paste_feet(m, sprites['enemywalk'], 560, HORIZON)
    paste_feet(m, sprites['enemyfly'], 180, HORIZON - 84)
    for cx in (390, 412, 434):
        m.alpha_composite(coin, (cx, HORIZON - 50))
    up2(m).save(MOCKS / 'gauntlet_late.png')

    m = compose(A, sky=A['sky_boss'], sun_at=None, mesa_off=160, rock_off=240,
                props_at=[], flora_mid=[], flora_play=[(4, 80)], pit=None, seed=13)
    paste_feet(m, sprites['run'], 150, HORIZON)
    paste_feet(m, sprites['enemyfly_red'], 430, HORIZON - 110, scale=3)
    up2(m).save(MOCKS / 'boss_arena.png')

    m = compose(A, sky=A['sky_wow'], sun_at=None, mesa_off=520, rock_off=100,
                tiles=A['tiles_wow'], props_at=[('spire', 420)],
                flora_mid=[(3, 150)], flora_play=[(5, 90), (4, 560)],
                pit=range(30, 32), seed=21)
    paste_feet(m, sprites['run'], 200, HORIZON)
    paste_feet(m, sprites['enemywalk_red'], 400, HORIZON)
    paste_feet(m, sprites['enemyfly_red'], 520, HORIZON - 70)
    up2(m).save(MOCKS / 'wow_zone.png')

    t = A['title'].copy()
    dT = ImageDraw.Draw(t)
    dT.ellipse([120 - 22, 344, 120 + 22, 352], fill=(20, 6, 8, 110))
    paste_feet(t, sprites['stand'], 120, 348)
    up2(t).save(MOCKS / 'title.png')

    m = compose(A, sky=A['sky'], sun_at=(386, 62), mesa_off=64, rock_off=32,
                props_at=[('arch', 540)], flora_mid=[(2, 500)],
                flora_play=[(5, 60), (6, 250)], pit=None, seed=31)
    paste_feet(m, sprites['ship'], 450, HORIZON)
    paste_feet(m, sprites['run'], 250, HORIZON)
    for i, cx in enumerate(range(180, 420, 24)):
        m.alpha_composite(coin, (cx, HORIZON - 74 - (i % 3) * 12))
    up2(m).save(MOCKS / 'win_ship.png')

    print('palette master =', len(master), '| used across assets =', len(used))
    print('seam scores (0 = perfect tile):', seams)
    print('assets ->', PROD)

if __name__ == '__main__':
    main()
