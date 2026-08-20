#!/usr/bin/env python3
"""Environment art candidates for the much-premium overhaul (assets-wow/).

Generates 2-3 candidates per art family (sky, far mesas, near rocks, terrain
tileset, props, title backdrop) plus 640x360 in-context composite mocks that
mirror the real render stack in web/game/scenes/play.js (layer order, horizon
line, haze fill, floor depth bands), with the official hero/enemy sprites
pasted in UNMODIFIED from the shipped atlas so palette harmony is judged
against the real cast.

Not imported by anything; the shipped pipeline (genart.py / build_assets.py)
is untouched. Deterministic: every candidate runs on its own seeded RNG,
seeds recorded in the emitted MANIFEST.json.

Rules implemented here are the numbered rules in assets-wow/ART_DIRECTION.md.
"""
from PIL import Image, ImageDraw
from pathlib import Path
import json
import random

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets-wow'
CAND = OUT / 'candidates'
MOCKS = OUT / 'mocks'

VW, VH = 640, 360
HORIZON = 232                # restLine at rest camera (play.js)
MESA_BOT = HORIZON + 4       # band('par_mesas', ..., bias=4)
ROCK_BOT = HORIZON + 10      # band('par_rocks', ..., bias=10)
TILE = 16

# --- expanded curated palette (ART_DIRECTION.md R4) -------------------------
SKY_TOP, SKY_MID, SKY_GLOW = '#0b0914', '#161224', '#261c3a'
MESA_RIM, MESA_BASE, MESA_SHADOW = '#3a2e5d', '#251d3a', '#161224'
ROCK_HI, ROCK_BASE, ROCK_SH = '#633e6b', '#42274a', '#2a1635'
CRUST, SUBSOIL, FILL_DEEP, UNDERLIP = '#b85b66', '#8b3e54', '#5a2640', '#3a1a30'
GOLD, ICE = '#eec548', '#aee6ff'
HAZE = '#2a1c33'             # play.js far-ground haze, kept as the floor of the rock band

def hx(c):
    c = c.lstrip('#'); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def sheet(w, h, bg=(0, 0, 0, 0)):
    return Image.new('RGBA', (w, h), bg)

BAYER2 = [[0, 2], [3, 1]]    # 2x2 ordered dither thresholds /4
BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]

# ===========================================================================
# FAMILY A — SKY (640x360, opaque)
# ===========================================================================

def sky_gradient(im, stops, matrix=None):
    """Vertical banded gradient with ordered-dither transitions (R5).
    stops: [(y_frac, color), ...] top→bottom. matrix: BAYER2 (default) or BAYER4."""
    px = im.load()
    m = matrix or BAYER2
    n = len(m); denom = n * n
    cols = [(int(f * im.height), hx(c)) for f, c in stops]
    for y in range(im.height):
        # find surrounding stops
        for i in range(len(cols) - 1):
            y0, c0 = cols[i]; y1, c1 = cols[i + 1]
            if y0 <= y <= y1 or (i == len(cols) - 2 and y > y1):
                t = 0 if y1 == y0 else min(1, max(0, (y - y0) / (y1 - y0)))
                break
        # ordered dither between the two band colors instead of true-color blend
        for x in range(im.width):
            th = (m[y % n][x % n] + 0.5) / denom
            px[x, y] = (c1 if t > th else c0) + (255,)
    return im

def stars3(im, rng, dim, mid, bright, band_frac=0.86):
    """R6 star hierarchy: dense dim 1px, medium mid 1px, sparse 2x2 crosses."""
    d = ImageDraw.Draw(im)
    H = int(im.height * band_frac)
    for _ in range(dim):
        d.point((rng.randrange(im.width), rng.randrange(H)), fill=SKY_GLOW)
    for _ in range(mid):
        d.point((rng.randrange(im.width), int(rng.randrange(H) * 0.9)), fill=ROCK_HI)
    for _ in range(bright):
        x, y = rng.randrange(im.width), int(rng.randrange(H) * 0.8)
        c = GOLD if rng.random() < 0.25 else '#e8e4f0'
        d.line([x - 1, y, x + 1, y], fill=c)
        d.line([x, y - 1, x, y + 1], fill=c)
        if rng.random() < 0.3:
            d.point((x, y), fill='#ffffff')
    return im

def nebula(im, rng, n, c_core, c_edge):
    """Dithered soft wisps: stacked shrinking blobs, Bayer-broken edges."""
    px = im.load(); W, H = im.size
    core, edge = hx(c_core), hx(c_edge)
    for _ in range(n):
        cx, cy = rng.randrange(W), rng.randrange(int(H * 0.55))
        rx, ry = rng.randrange(40, 110), rng.randrange(12, 30)
        for y in range(max(0, cy - ry), min(H, cy + ry)):
            for x in range(max(0, cx - rx), min(W, cx + rx)):
                dx, dy = (x - cx) / rx, (y - cy) / ry
                r = dx * dx + dy * dy
                if r > 1: continue
                th = (BAYER2[y % 2][x % 2] + 0.5) / 4
                if r < 0.35 and 0.45 > th * r * 3:
                    px[x, y] = edge + (255,) if th < 0.5 else px[x, y]
                    if r < 0.18 and th < 0.4:
                        px[x, y] = core + (255,)
                elif r < 1 and (1 - r) * 0.6 > th:
                    px[x, y] = edge + (255,)
    return im

def sky_a(seed):
    rng = random.Random(seed)
    im = sky_gradient(sheet(VW, VH), [(0.0, SKY_TOP), (0.30, SKY_TOP),
                                      (0.52, SKY_MID), (0.64, SKY_GLOW)])
    return stars3(im, rng, 90, 55, 16)

def sky_b(seed):
    rng = random.Random(seed)
    im = sky_gradient(sheet(VW, VH), [(0.0, SKY_TOP), (0.28, SKY_TOP),
                                      (0.50, SKY_MID), (0.63, SKY_GLOW)])
    nebula(im, rng, 4, MESA_RIM, '#1d1830')
    return stars3(im, rng, 80, 50, 14)

def sky_c(seed):
    """Diagonal galaxy band: a dense dust lane crossing the upper sky."""
    rng = random.Random(seed)
    im = sky_gradient(sheet(VW, VH), [(0.0, SKY_TOP), (0.30, SKY_TOP),
                                      (0.53, SKY_MID), (0.64, SKY_GLOW)])
    d = ImageDraw.Draw(im)
    for _ in range(900):                       # dust lane particles
        t = rng.random()
        x = int(t * VW)
        yc = 40 + t * 90                       # slope of the band
        y = int(rng.gauss(yc, 14))
        if 0 <= y < VH:
            d.point((x, y), fill='#1d1830' if rng.random() < 0.6 else SKY_MID)
    for _ in range(220):                       # brighter lane core
        t = rng.random()
        y = int(rng.gauss(40 + t * 90, 6))
        if 0 <= y < VH:
            d.point((int(t * VW), y), fill=MESA_RIM)
    return stars3(im, rng, 70, 60, 18)

# ===========================================================================
# FAMILY B — FAR MESAS (640x120 strip, transparent bg, tiles at 640)
# ===========================================================================

def terraced_mesa(d, rng, x0, w, top, H, rim=MESA_RIM, base=MESA_BASE):
    """R7: stepped silhouette. Flat plateau, terraced steps down both sides."""
    steps = []
    x, y = x0, H
    # left ascent
    while y > top and x < x0 + w // 2:
        sw = rng.randrange(6, 22)
        sh = rng.randrange(8, 26)
        y = max(top, y - sh)
        steps.append((x, y)); x += sw
    plateau_r = x0 + w - rng.randrange(6, max(8, w // 4))
    # polygon: base left → up steps → plateau → down mirrored-ish steps
    pts = [(x0, H)]
    for sx, sy in steps: pts += [(sx, pts[-1][1]), (sx, sy)]
    pts += [(plateau_r, top)]
    xr, yr = plateau_r, top
    while yr < H:
        sw = rng.randrange(4, 16); sh = rng.randrange(8, 26)
        pts += [(xr + sw, yr)]
        yr = min(H, yr + sh); xr += sw
        pts += [(xr, yr)]
    pts += [(xr, H)]
    d.polygon(pts, fill=base)
    # 1px rim light on every horizontal run near its left edge (R7)
    prev = pts[0]
    for p in pts[1:]:
        if p[1] == prev[1] and p[0] > prev[0] and p[1] < H:
            d.line([prev[0], p[1] - 1, p[0] - 1, p[1] - 1], fill=rim)
        prev = p

def mesa_a(seed):
    rng = random.Random(seed)
    im = sheet(VW, 120); d = ImageDraw.Draw(im)
    x = -rng.randrange(0, 30)
    while x < VW + 40:
        w = rng.randrange(70, 150)
        top = rng.randrange(18, 62)
        terraced_mesa(d, rng, x, w, top, 120)
        x += w + rng.randrange(14, 50)
    return im

def mesa_b(seed):
    """Two distance rows: a dimmer back row half-merged into the sky."""
    rng = random.Random(seed)
    im = sheet(VW, 120); d = ImageDraw.Draw(im)
    x = -20
    while x < VW + 40:                      # back row, shadow tone, no rim
        w = rng.randrange(90, 180); top = rng.randrange(6, 30)
        terraced_mesa(d, rng, x, w, top, 120, rim='#241d3c', base=MESA_SHADOW)
        x += w + rng.randrange(6, 30)
    x = -rng.randrange(0, 40)
    while x < VW + 40:                      # front row
        w = rng.randrange(60, 130); top = rng.randrange(30, 70)
        terraced_mesa(d, rng, x, w, top, 120)
        x += w + rng.randrange(24, 70)
    return im

def mesa_c(seed):
    """Low, long plateaus — quieter horizon, more sky."""
    rng = random.Random(seed)
    im = sheet(VW, 120); d = ImageDraw.Draw(im)
    x = -rng.randrange(0, 30)
    while x < VW + 60:
        w = rng.randrange(140, 260)
        top = rng.randrange(52, 84)
        terraced_mesa(d, rng, x, w, top, 120)
        x += w + rng.randrange(10, 40)
    return im

# ===========================================================================
# FAMILY C — NEAR ROCKS (640x80 strip)
# ===========================================================================

def jagged_rock(d, rng, x0, w, hgt, H):
    """R7: stair-stepped peak with a lit left face and shadowed right face."""
    peak_x = x0 + rng.randrange(w // 3, 2 * w // 3 + 1)
    top = H - hgt
    # build stepped left edge
    left = [(x0, H)]
    x, y = x0, H
    while x < peak_x and y > top:
        sw = rng.randrange(2, 6); sh = rng.randrange(2, 7)
        x = min(peak_x, x + sw); y = max(top, y - sh)
        left.append((x, left[-1][1])); left.append((x, y))
    right = [(peak_x, top)]
    x, y = peak_x, top
    while x < x0 + w and y < H:
        sw = rng.randrange(2, 6); sh = rng.randrange(3, 8)
        x = min(x0 + w, x + sw); y = min(H, y + sh)
        right.append((x, right[-1][1])); right.append((x, y))
    pts = left + [(peak_x, top)] + right + [(x0 + w, H)]
    d.polygon(pts, fill=ROCK_BASE)
    # lit facet: thin bright wedge down the left face
    d.polygon([(peak_x, top), (peak_x - max(2, w // 6), H),
               (peak_x - max(4, w // 3), H)], fill=ROCK_HI)
    # shadow facet on the right
    d.polygon([(peak_x, top), (x0 + w, H), (x0 + w - max(2, w // 5), H)],
              fill=ROCK_SH)

def rocks_strip(seed, density, pebbles=False, tall=False):
    rng = random.Random(seed)
    im = sheet(VW, 80); d = ImageDraw.Draw(im)
    x = -rng.randrange(0, 20)
    while x < VW + 30:
        w = rng.randrange(18, 52)
        hgt = rng.randrange(30, 74) if tall else rng.randrange(14, 52)
        jagged_rock(d, rng, x, w, hgt, 80)
        x += w + rng.randrange(*density)
    if pebbles:
        for _ in range(46):
            px_, py = rng.randrange(VW), rng.randrange(72, 79)
            pw = rng.randrange(2, 5)
            d.rectangle([px_, py, px_ + pw, py + 1], fill=ROCK_BASE)
            d.point((px_, py), fill=ROCK_HI)
    # R8: 2px AO line where the band meets the ground fill
    d.rectangle([0, 78, VW - 1, 79], fill=ROCK_SH)
    return im

def rock_a(seed): return rocks_strip(seed, (6, 34))
def rock_b(seed): return rocks_strip(seed, (2, 18), pebbles=True)
def rock_c(seed): return rocks_strip(seed, (10, 44), tall=True)

# ===========================================================================
# FAMILY D — TERRAIN TILESET (8 frames 16x16: surface, fill, edgeL, edgeR,
#            underside, surface_v1, surface_v2, fill_v1)
# ===========================================================================

def tile_fill(d, rng, x0, crust=None, cool=0):
    """R9 fill anatomy: deep fill + sparse 2px sediment lines."""
    d.rectangle([x0, 0, x0 + 15, 15], fill=FILL_DEEP)
    for _ in range(3):
        y = rng.randrange(2, 15)
        x = rng.randrange(0, 12)
        w = rng.randrange(2, 5)
        d.line([x0 + x, y, x0 + x + w, y], fill=SUBSOIL)
    for _ in range(2):
        d.point((x0 + rng.randrange(16), rng.randrange(16)), fill=UNDERLIP)

def tile_surface(d, rng, x0, crust=CRUST, sub=SUBSOIL):
    tile_fill(d, rng, x0)
    # rows 2-3: streak mix; row 0: solid crust light
    d.rectangle([x0, 0, x0 + 15, 0], fill=crust)
    for y in (1, 2):
        x = 0
        while x < 16:
            w = rng.randrange(2, 6)
            d.line([x0 + x, y, x0 + min(15, x + w - 1), y],
                   fill=crust if rng.random() < (0.55 if y == 1 else 0.25) else sub)
            x += w
    d.rectangle([x0, 3, x0 + 15, 3], fill=sub)

def tileset(seed, crust=CRUST, pebbly=False):
    rng = random.Random(seed)
    im = sheet(8 * 16, 16); d = ImageDraw.Draw(im)
    tile_surface(d, rng, 0, crust=crust)              # 0 surface
    tile_fill(d, rng, 16)                             # 1 fill
    tile_fill(d, rng, 32)                             # 2 edgeL (pit leading edge)
    d.rectangle([32, 0, 32, 15], fill=SUBSOIL)
    tile_fill(d, rng, 48)                             # 3 edgeR
    d.rectangle([63, 0, 63, 15], fill=SUBSOIL)
    tile_fill(d, rng, 64)                             # 4 underside: 1px lip (R9)
    d.rectangle([64, 15, 79, 15], fill=UNDERLIP)
    tile_surface(d, rng, 80, crust=crust)             # 5 surface variant 1
    d.point((80 + rng.randrange(3, 13), 0), fill='#d78a83')   # warm fleck
    tile_surface(d, rng, 96, crust=crust)             # 6 surface variant 2
    d.rectangle([96 + 5, 1, 96 + 7, 1], fill='#d78a83')
    tile_fill(d, rng, 112)                            # 7 fill variant
    if pebbly:
        for fx in (16, 112):
            for _ in range(3):
                x, y = fx + rng.randrange(2, 14), rng.randrange(4, 14)
                d.rectangle([x, y, x + 1, y], fill=SUBSOIL)
                d.point((x, y - 1), fill='#a05064')
    return im

def tiles_a(seed): return tileset(seed)
def tiles_b(seed): return tileset(seed, pebbly=True)
def tiles_c(seed): return tileset(seed, crust='#a45b7d')   # cooler mauve crust

# ===========================================================================
# FAMILY E — PROPS (spire, arch, wreck) — one sheet per set, cells 48x64
# ===========================================================================

def prop_spire(d, rng, x0, H=64):
    base_w = rng.randrange(14, 20)
    cx = x0 + 24
    x, y, w = cx - base_w // 2, H, base_w
    while w > 2 and y > 8:
        sh = rng.randrange(4, 9)
        d.rectangle([x, y - sh, x + w - 1, y - 1], fill=ROCK_BASE)
        d.line([x, y - sh, x, y - 1], fill=ROCK_HI)
        d.line([x + w - 1, y - sh, x + w - 1, y - 1], fill=ROCK_SH)
        y -= sh; shrink = rng.randrange(1, 3)
        x += shrink; w -= shrink * 2 - rng.randrange(0, 2)
    d.point((x + max(0, w // 2), y - 1), fill=ROCK_HI)

def prop_arch(d, rng, x0, H=64):
    l, r = x0 + 6, x0 + 42
    top = rng.randrange(18, 26)
    for px_, lit in ((l, True), (r - 5, False)):
        d.rectangle([px_, top + 8, px_ + 5, H - 1], fill=ROCK_BASE)
        d.line([px_ if lit else px_ + 5, top + 8, px_ if lit else px_ + 5, H - 1],
               fill=ROCK_HI if lit else ROCK_SH)
    # stepped lintel
    d.rectangle([l, top, r, top + 5], fill=ROCK_BASE)
    d.rectangle([l + 4, top + 5, r - 4, top + 8], fill=ROCK_BASE)
    d.line([l, top, r, top], fill=ROCK_HI)
    d.line([l + 4, top + 8, r - 4, top + 8], fill=ROCK_SH)

def prop_wreck(d, rng, x0, H=64):
    """Half-buried hull section: tilted ring + snapped strut, no black lines."""
    hull = '#4a4256'; hull_hi = '#6b6180'; hull_sh = '#332c40'
    cy = H - 14
    d.ellipse([x0 + 8, cy - 16, x0 + 40, cy + 8], fill=hull)
    d.ellipse([x0 + 13, cy - 12, x0 + 35, cy + 4], fill=hull_sh)
    d.arc([x0 + 8, cy - 16, x0 + 40, cy + 8], 200, 340, fill=hull_hi)
    d.rectangle([x0 + 6, cy + 2, x0 + 42, H - 1], fill=FILL_DEEP)   # buried line
    d.line([x0 + 30, cy - 22, x0 + 36, cy - 4], fill=hull_hi)       # strut
    d.line([x0 + 31, cy - 22, x0 + 37, cy - 4], fill=hull)
    if rng.random() < 0.8:
        d.point((x0 + 33, cy - 24), fill=ICE)                       # dead light
    for _ in range(5):
        d.point((x0 + rng.randrange(10, 38), cy - rng.randrange(0, 12)),
                fill=hull_sh)

def props_set(seed):
    rng = random.Random(seed)
    im = sheet(3 * 48, 64); d = ImageDraw.Draw(im)
    prop_spire(d, rng, 0)
    prop_arch(d, rng, 48)
    prop_wreck(d, rng, 96)
    return im

def props_a(seed): return props_set(seed)
def props_b(seed): return props_set(seed)      # same grammar, different roll

# ===========================================================================
# FAMILY F — TITLE BACKDROP (640x360, opaque)
# ===========================================================================

def title_a(seed):
    """Planet-curve vista: big warm planet rim low in frame over a mesa line."""
    rng = random.Random(seed)
    im = sky_gradient(sheet(VW, VH), [(0.0, SKY_TOP), (0.4, SKY_TOP),
                                      (0.7, SKY_MID), (0.95, SKY_GLOW)])
    stars3(im, rng, 100, 60, 18, band_frac=0.7)
    d = ImageDraw.Draw(im)
    # planet: huge circle mostly below frame, warm rim light
    cx, cy, r = 480, 700, 430
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill='#1d1428')
    for i, c in enumerate(('#b85b66', '#8b3e54', '#5a2640')):
        d.arc([cx - r + i, cy - r + i, cx + r - i, cy + r - i], 195, 345, fill=c)
    # dust band across the planet face
    for _ in range(300):
        a = rng.uniform(200, 340)
        import math
        rr = r - rng.randrange(4, 60)
        x = cx + rr * math.cos(math.radians(a))
        y = cy + rr * math.sin(math.radians(a))
        if 0 <= x < VW and 0 <= y < VH:
            d.point((int(x), int(y)), fill='#42274a' if rng.random() < 0.7 else ROCK_HI)
    # far mesa line at the base
    x = -10
    while x < VW + 40:
        w = rng.randrange(90, 190); top = rng.randrange(300, 336)
        terraced_mesa(d, rng, x, w, top, VH)
        x += w + rng.randrange(8, 40)
    return im

def title_b(seed):
    """Sweeping canyon vista: three receding mesa rows + galaxy band."""
    rng = random.Random(seed)
    im = sky_gradient(sheet(VW, VH), [(0.0, SKY_TOP), (0.45, SKY_TOP),
                                      (0.72, SKY_MID), (0.95, SKY_GLOW)])
    d = ImageDraw.Draw(im)
    for _ in range(700):
        t = rng.random()
        y = int(rng.gauss(60 + t * 70, 12))
        if 0 <= y < VH:
            d.point((int(t * VW), y), fill='#1d1830' if rng.random() < 0.65 else MESA_RIM)
    stars3(im, rng, 90, 55, 16, band_frac=0.72)
    rows = [(MESA_SHADOW, '#241d3c', 190, 250), ('#1f1834', '#2e2650', 230, 290),
            (MESA_BASE, MESA_RIM, 268, 320)]
    for base, rim, tlo, thi in rows:
        x = -rng.randrange(0, 40)
        while x < VW + 40:
            w = rng.randrange(80, 170); top = rng.randrange(tlo, thi)
            terraced_mesa(d, rng, x, w, top, VH, rim=rim, base=base)
            x += w + rng.randrange(10, 60)
    # foreground floor sliver
    d.rectangle([0, VH - 22, VW, VH], fill=FILL_DEEP)
    d.rectangle([0, VH - 22, VW, VH - 22], fill=CRUST)
    d.rectangle([0, VH - 21, VW, VH - 21], fill=SUBSOIL)
    return im

# ===========================================================================
# COMPOSITE MOCKS — mirror play.js render order at rest camera
# ===========================================================================

def load_atlas_sprites():
    meta = json.loads((ROOT / 'web/assets/atlas.json').read_text())
    atlas = Image.open(ROOT / 'web/assets/atlas.png')
    out = {}
    for name in ('run', 'enemywalk', 'enemyfly', 'coin'):
        an = meta['anims'][name]
        f = meta['frames'][an['frames'][0]]
        img = atlas.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
        out[name] = (img, f, an)
    return out

def paste_feet(comp, sprite, x, feet_y):
    img, f, an = sprite
    # drawFeet centers on cw and anchors the anim's feetY line
    px_ = x - an['cw'] // 2 + f['ox']
    py = feet_y - an['feetY'] + f['oy']
    comp.alpha_composite(img.convert('RGBA'), (px_, py))

def compose_scene(sky, mesas, rocks, tiles, props, sprites, with_pit=True):
    comp = sky.convert('RGBA').copy()
    comp.alpha_composite(mesas, (0, MESA_BOT - mesas.height))
    d = ImageDraw.Draw(comp)
    d.rectangle([0, ROCK_BOT - 20, VW, VH], fill=HAZE)          # far-ground haze
    comp.alpha_composite(rocks, (0, ROCK_BOT - rocks.height))
    # props behind the rock band, feet on the haze line
    if props:
        for i, sx in enumerate((60, 300, 500)):
            cell = props.crop((i * 48, 0, i * 48 + 48, 64))
            comp.alpha_composite(cell, (sx, ROCK_BOT - 64))
    # ground: 8 tile rows from HORIZON down; a pit gap for edge reading
    surf = tiles.crop((0, 0, 16, 16))
    surf_v = [tiles.crop((80, 0, 96, 16)), tiles.crop((96, 0, 112, 16))]
    fill = tiles.crop((16, 0, 32, 16))
    fill_v = tiles.crop((112, 0, 128, 16))
    edgeL = tiles.crop((32, 0, 48, 16)); edgeR = tiles.crop((48, 0, 64, 16))
    rngv = random.Random(9)
    pit = range(26, 29) if with_pit else range(0, 0)
    for ty in range(8):
        for tx in range(VW // 16):
            if tx in pit: continue
            if ty == 0:
                t = surf if rngv.random() < 0.7 else rngv.choice(surf_v)
            elif tx + 1 in pit and with_pit:
                t = edgeR
            elif tx - 1 in pit and with_pit:
                t = edgeL
            else:
                t = fill if rngv.random() < 0.8 else fill_v
            comp.alpha_composite(t, (tx * 16, HORIZON + ty * 16))
    # floor depth bands (play.js 2b)
    for (r0, r1, a) in ((2, 5, 0.15), (5, 8, 0.3)):
        band = Image.new('RGBA', (VW, (r1 - r0) * 16), (0, 0, 0, int(a * 255)))
        comp.alpha_composite(band, (0, HORIZON + r0 * 16))
    # cast: hero + one of each enemy + coins (official art, untouched)
    paste_feet(comp, sprites['run'], 180, HORIZON)
    paste_feet(comp, sprites['enemywalk'], 430, HORIZON)
    paste_feet(comp, sprites['enemyfly'], 520, HORIZON - 70)
    cimg = sprites['coin'][0].convert('RGBA')
    for cx in (240, 260, 280):
        comp.alpha_composite(cimg, (cx, HORIZON - 40))
    return comp

def up2(im):
    return im.resize((im.width * 2, im.height * 2), Image.NEAREST)


# ===========================================================================
# ROUND 2 — refined winners (vision-review notes applied)
# ===========================================================================

def sky_d(seed):
    """sky_b refined: cooler darker nebula, sparser stars, cool-only palette,
    4x4 Bayer transitions."""
    rng = random.Random(seed)
    im = sky_gradient(sheet(VW, VH), [(0.0, SKY_TOP), (0.28, SKY_TOP),
                                      (0.50, SKY_MID), (0.63, SKY_GLOW)],
                      matrix=BAYER4)
    nebula(im, rng, 3, '#241a3c', '#181024')
    d = ImageDraw.Draw(im)
    H = int(VH * 0.82)
    for _ in range(56):                       # dim pass, glow tone
        d.point((rng.randrange(VW), rng.randrange(H)), fill=SKY_GLOW)
    for _ in range(34):                       # mid pass, muted violet
        d.point((rng.randrange(VW), int(rng.randrange(H) * 0.9)), fill='#4a3a68')
    for _ in range(10):                       # bright pass: white/ice only
        x, y = rng.randrange(VW), int(rng.randrange(H) * 0.8)
        c = ICE if rng.random() < 0.3 else '#e8e4f0'
        d.line([x - 1, y, x + 1, y], fill=c)
        d.line([x, y - 1, x, y + 1], fill=c)
    return im

def mesa_d(seed):
    """mesa_b refined: dimmer rims, micro-step breakup, 4px atmospheric strip
    at the band base, back row pushed toward the sky."""
    rng = random.Random(seed)
    im = sheet(VW, 120); d = ImageDraw.Draw(im)
    x = -20
    while x < VW + 40:                      # back row: nearly sky-tone
        w = rng.randrange(90, 180); top = rng.randrange(6, 30)
        terraced_mesa(d, rng, x, w, top, 120, rim='#1f1a34', base='#131022')
        x += w + rng.randrange(6, 30)
    x = -rng.randrange(0, 40)
    while x < VW + 40:                      # front row, rim dimmed ~12%
        w = rng.randrange(60, 130); top = rng.randrange(30, 70)
        terraced_mesa(d, rng, x, w, top, 120, rim='#332852', base=MESA_BASE)
        x += w + rng.randrange(24, 70)
    for _ in range(40):                     # micro-steps on long straight lines
        sx, sy = rng.randrange(VW), rng.randrange(20, 100)
        if im.getpixel((sx, sy))[3] > 0 and (sy < 2 or im.getpixel((sx, sy - 2))[3] == 0):
            d.rectangle([sx, sy - 1, min(VW - 1, sx + rng.randrange(2, 5)), sy],
                        fill=MESA_BASE)
    d.rectangle([0, 116, VW - 1, 119], fill='#1d1530')   # atmospheric density
    return im

def rock_d(seed):
    """rock_a refined: flat 2-3px tops (no hazard-spike read), dimmer highlight,
    midtone seam between facets, ~20% lower density."""
    rng = random.Random(seed)
    im = sheet(VW, 80); d = ImageDraw.Draw(im)
    hi, mid_c = '#57395f', '#4c2f55'
    x = -rng.randrange(0, 20)
    while x < VW + 30:
        w = rng.randrange(20, 56)
        hgt = rng.randrange(14, 48)
        H = 80; top = H - hgt
        flat = rng.randrange(3, max(4, w // 3))
        px0 = x + rng.randrange(w // 4, w // 2)
        pts = [(x, H)]
        cx_, cy = x, H
        while cx_ < px0 and cy > top:
            sw = rng.randrange(2, 6); sh = rng.randrange(2, 7)
            cx_ = min(px0, cx_ + sw); cy = max(top, cy - sh)
            pts += [(cx_, pts[-1][1]), (cx_, cy)]
        pts += [(px0, top), (px0 + flat, top)]
        cx_, cy = px0 + flat, top
        while cx_ < x + w and cy < H:
            sw = rng.randrange(2, 6); sh = rng.randrange(3, 8)
            cx_ = min(x + w, cx_ + sw); cy = min(H, cy + sh)
            pts += [(cx_, pts[-1][1]), (cx_, cy)]
        pts += [(x + w, H)]
        d.polygon(pts, fill=ROCK_BASE)
        d.line([px0, top, px0 + flat - 1, top], fill=hi)          # lit flat top
        d.polygon([(px0, top + 1), (px0 - max(2, w // 6), H),
                   (px0 - max(4, w // 3), H)], fill=mid_c)        # midtone face
        d.polygon([(px0 + flat, top + 1), (x + w, H),
                   (x + w - max(2, w // 5), H)], fill=ROCK_SH)    # shadow face
        x += w + rng.randrange(12, 44)
    d.rectangle([0, 78, VW - 1, 79], fill=ROCK_SH)                # AO seam (R8)
    return im

def tiles_d(seed):
    """tiles_a refined: 1px shadow seam under the crust, clustered dashes,
    brighter pit-edge inner highlight."""
    rng = random.Random(seed)
    im = tileset(seed)
    d = ImageDraw.Draw(im)
    for fx in (0, 80, 96):
        d.rectangle([fx, 4, fx + 15, 4], fill='#4a2b42')
    d.rectangle([32, 0, 32, 15], fill='#a5506b')     # edgeL leading edge
    d.rectangle([63, 0, 63, 15], fill='#a5506b')     # edgeR leading edge
    for fx in (16, 112):                             # clustered dashes
        d.rectangle([fx, 0, fx + 15, 15], fill=FILL_DEEP)
        for _ in range(2):
            cxx, cyy = rng.randrange(1, 9), rng.randrange(3, 13)
            for k in range(rng.randrange(2, 4)):
                w = rng.randrange(2, 5)
                yy = (cyy + k * 2) % 16
                d.line([fx + cxx + k, yy, fx + min(15, cxx + k + w), yy], fill=SUBSOIL)
        d.point((fx + rng.randrange(16), rng.randrange(16)), fill=UNDERLIP)
    return im

def props_d(seed):
    """props_b refined: purple-tinted wreck, sky-glow 1px top edges on all
    three props."""
    rng = random.Random(seed)
    im = props_set(seed)
    cell = im.crop((96, 0, 144, 64))
    px = cell.load()
    for y in range(64):
        for x in range(48):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (min(255, r + 16), g, min(255, b + 20), a)
    im.paste(cell, (96, 0))
    d = ImageDraw.Draw(im)
    for x0 in (0, 48, 96):                           # dashed sky-glow top edge
        for x in range(x0, x0 + 48):
            for y in range(64):
                p = im.getpixel((x, y))
                if p[3] > 0:
                    if (x + y) % 2:
                        d.point((x, y), fill=SKY_GLOW)
                    break
    return im

def title_d(seed):
    """title_b refined: raised black point, muted galaxy core, textured floor
    strip, 4x4 Bayer sky."""
    rng = random.Random(seed)
    im = sky_gradient(sheet(VW, VH), [(0.0, '#141020'), (0.4, '#141020'),
                                      (0.7, SKY_MID), (0.95, SKY_GLOW)],
                      matrix=BAYER4)
    d = ImageDraw.Draw(im)
    for _ in range(700):
        t = rng.random()
        y = int(rng.gauss(60 + t * 70, 12))
        if 0 <= y < VH:
            d.point((int(t * VW), y), fill='#221a38' if rng.random() < 0.65 else '#8a7b9e')
    stars3(im, rng, 90, 55, 14, band_frac=0.72)
    rows = [('#1c1630', '#2a2246', 190, 250), ('#241c3c', '#362c58', 230, 290),
            (MESA_BASE, MESA_RIM, 268, 320)]
    for base, rim, tlo, thi in rows:
        x = -rng.randrange(0, 40)
        while x < VW + 40:
            w = rng.randrange(80, 170); top = rng.randrange(tlo, thi)
            terraced_mesa(d, rng, x, w, top, VH, rim=rim, base=base)
            x += w + rng.randrange(10, 60)
    d.rectangle([0, VH - 22, VW, VH], fill=FILL_DEEP)
    d.rectangle([0, VH - 22, VW, VH - 22], fill=CRUST)
    d.rectangle([0, VH - 21, VW, VH - 21], fill='#4a2b42')
    for _ in range(60):
        x, y = rng.randrange(VW), rng.randrange(VH - 19, VH - 2)
        d.line([x, y, x + rng.randrange(2, 5), y], fill=SUBSOIL)
    return im


# ===========================================================================
# FINAL PASS — tie-break winners with the last review notes folded in
# ===========================================================================

def mesa_e(seed):
    """mesa_b silhouettes with the rim dimmed one step (recede further)."""
    rng = random.Random(seed)
    im = sheet(VW, 120); d = ImageDraw.Draw(im)
    x = -20
    while x < VW + 40:                      # back row, shadow tone, no rim
        w = rng.randrange(90, 180); top = rng.randrange(6, 30)
        terraced_mesa(d, rng, x, w, top, 120, rim='#241d3c', base=MESA_SHADOW)
        x += w + rng.randrange(6, 30)
    x = -rng.randrange(0, 40)
    while x < VW + 40:                      # front row, dimmer rim
        w = rng.randrange(60, 130); top = rng.randrange(30, 70)
        terraced_mesa(d, rng, x, w, top, 120, rim='#332852')
        x += w + rng.randrange(24, 70)
    return im

def rock_e(seed):
    """rock_d with highlights pushed down a value step and wider flat tops."""
    rng = random.Random(seed)
    im = sheet(VW, 80); d = ImageDraw.Draw(im)
    hi, mid_c = '#4c3053', '#43294c'
    x = -rng.randrange(0, 20)
    while x < VW + 30:
        w = rng.randrange(20, 56)
        hgt = rng.randrange(14, 48)
        H = 80; top = H - hgt
        flat = rng.randrange(4, max(5, w // 3))
        px0 = x + rng.randrange(w // 4, w // 2)
        pts = [(x, H)]
        cx_, cy = x, H
        while cx_ < px0 and cy > top:
            sw = rng.randrange(2, 6); sh = rng.randrange(2, 7)
            cx_ = min(px0, cx_ + sw); cy = max(top, cy - sh)
            pts += [(cx_, pts[-1][1]), (cx_, cy)]
        pts += [(px0, top), (px0 + flat, top)]
        cx_, cy = px0 + flat, top
        while cx_ < x + w and cy < H:
            sw = rng.randrange(2, 6); sh = rng.randrange(3, 8)
            cx_ = min(x + w, cx_ + sw); cy = min(H, cy + sh)
            pts += [(cx_, pts[-1][1]), (cx_, cy)]
        pts += [(x + w, H)]
        d.polygon(pts, fill=ROCK_BASE)
        d.line([px0, top, px0 + flat - 1, top], fill=hi)
        d.polygon([(px0, top + 1), (px0 - max(2, w // 6), H),
                   (px0 - max(4, w // 3), H)], fill=mid_c)
        d.polygon([(px0 + flat, top + 1), (x + w, H),
                   (x + w - max(2, w // 5), H)], fill=ROCK_SH)
        x += w + rng.randrange(12, 44)
    d.rectangle([0, 78, VW - 1, 79], fill=ROCK_SH)
    return im

def props_e(seed):
    """props_d with the top-edge light dimmed to kill false-platform reads."""
    rng = random.Random(seed)
    im = props_set(seed)
    cell = im.crop((96, 0, 144, 64))
    px = cell.load()
    for y in range(64):
        for x in range(48):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (min(255, r + 16), g, min(255, b + 20), a)
    im.paste(cell, (96, 0))
    d = ImageDraw.Draw(im)
    for x0 in (0, 48, 96):
        for x in range(x0, x0 + 48):
            for y in range(64):
                pxl = im.getpixel((x, y))
                if pxl[3] > 0:
                    if (x + y) % 2:
                        d.point((x, y), fill='#332852')   # dim violet edge
                    break
    return im

# ===========================================================================

FAMILIES = {
    'sky':   {'a': (sky_a, 101), 'b': (sky_b, 102), 'c': (sky_c, 103), 'd': (sky_d, 104)},
    'mesa':  {'a': (mesa_a, 201), 'b': (mesa_b, 202), 'c': (mesa_c, 203), 'd': (mesa_d, 204), 'e': (mesa_e, 205)},
    'rock':  {'a': (rock_a, 301), 'b': (rock_b, 302), 'c': (rock_c, 303), 'd': (rock_d, 304), 'e': (rock_e, 305)},
    'tiles': {'a': (tiles_a, 401), 'b': (tiles_b, 402), 'c': (tiles_c, 403), 'd': (tiles_d, 404)},
    'props': {'a': (props_a, 501), 'b': (props_b, 502), 'd': (props_d, 504), 'e': (props_e, 505)},
    'title': {'a': (title_a, 601), 'b': (title_b, 602), 'd': (title_d, 604)},
}
# Round-2 mocks are composed over the refined set so the whole refreshed scene
# is judged together.
ROUND2_BASE = {'sky': 'd', 'mesa': 'd', 'rock': 'd', 'tiles': 'd', 'props': 'd'}

def main():
    CAND.mkdir(parents=True, exist_ok=True)
    MOCKS.mkdir(parents=True, exist_ok=True)
    sprites = load_atlas_sprites()
    imgs, manifest = {}, {}
    for fam, cands in FAMILIES.items():
        for cid, (fn, seed) in cands.items():
            im = fn(seed)
            imgs[(fam, cid)] = im
            im.save(CAND / f'{fam}_{cid}.png')
            manifest[f'{fam}_{cid}'] = {'seed': seed, 'file': f'candidates/{fam}_{cid}.png'}
    # defaults for the non-varying layers of each mock: round-1 candidates are
    # judged over the 'a' set, round-2 refinements over the refined 'd' set.
    base1 = {f: imgs[(f, 'a')] for f in ('sky', 'mesa', 'rock', 'tiles', 'props')}
    base2 = {f: imgs[(f, ROUND2_BASE[f])] for f in ROUND2_BASE}
    for fam in ('sky', 'mesa', 'rock', 'tiles', 'props'):
        for cid in FAMILIES[fam]:
            if cid == 'e':
                continue                    # finals appear in final_scene.png
            layers = dict(base2 if cid == 'd' else base1)
            layers[fam] = imgs[(fam, cid)]
            comp = compose_scene(layers['sky'], layers['mesa'], layers['rock'],
                                 layers['tiles'], layers['props'], sprites)
            up2(comp).save(MOCKS / f'{fam}_{cid}.png')
    for cid in FAMILIES['title']:
        up2(imgs[('title', cid)].convert('RGBA')).save(MOCKS / f'title_{cid}.png')
    # Round-3 isolation tie-breaks: identical base everywhere, ONLY the named
    # family varies (round-2 comparisons crossed bases and confounded judges).
    base3 = {'sky': imgs[('sky', 'd')], 'mesa': imgs[('mesa', 'b')],
             'rock': imgs[('rock', 'd')], 'tiles': imgs[('tiles', 'd')],
             'props': imgs[('props', 'b')]}
    for fam, pair in (('mesa', ('b', 'd')), ('rock', ('a', 'd')), ('props', ('b', 'd'))):
        for cid in pair:
            layers = dict(base3); layers[fam] = imgs[(fam, cid)]
            comp = compose_scene(layers['sky'], layers['mesa'], layers['rock'],
                                 layers['tiles'], layers['props'], sprites)
            up2(comp).save(MOCKS / f'{fam}_{cid}_iso.png')
    # the winning set, composed once for sign-off
    win = {'sky': imgs[('sky', 'd')], 'mesa': imgs[('mesa', 'e')],
           'rock': imgs[('rock', 'e')], 'tiles': imgs[('tiles', 'd')],
           'props': imgs[('props', 'e')]}
    comp = compose_scene(win['sky'], win['mesa'], win['rock'],
                         win['tiles'], win['props'], sprites)
    up2(comp).save(MOCKS / 'final_scene.png')
    (OUT / 'MANIFEST.json').write_text(json.dumps(manifest, indent=1))
    print('candidates:', len(manifest), '| mocks written to', MOCKS)

if __name__ == '__main__':
    main()
