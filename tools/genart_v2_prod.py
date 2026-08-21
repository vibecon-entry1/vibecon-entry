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

# frame map v2 (organic masonry): the tileset encodes a 16-tile-wide,
# 8-course-deep continuous stone band (256x128 px) plus 5 shaped frames.
#   0..15         surface course, x phase 0..15
#   16..127       fill, depth d=1..7: frame 16 + (d-1)*16 + phase
#   128/129       surface pit edge, pit on the LEFT / RIGHT
#   130           underside lip
#   131/132       pit wall, pit on the LEFT / RIGHT
TILE_P = 16
FILL_D = 7
MAS_W, MAS_H = TILE_P * 16, (FILL_D + 1) * 16
TILE_FRAMES = TILE_P + FILL_D * TILE_P + 5      # 133

# Locked-palette entries only (assets-wow/production/PALETTE.json), chosen
# from a per-depth census of the approved sheet's own floor band.
CRUST_HI  = (249, 210, 129)   # f9d281
CRUST_GLO = (234, 159, 58)    # ea9f3a
CRUST_MID = (227, 139, 48)    # e38b30
CRUST_LOW = (212, 113, 33)    # d47121
CRUST_SET = (148, 73, 35)     # 944923
CRUST_DRK = (89, 14, 12)      # 590e0c

def _h2(x, y):
    h = (x * 374761393 + y * 668265263) & 0xffffffff
    h ^= h >> 13
    h = (h * 1274126177) & 0xffffffff
    return (h ^ (h >> 16)) & 0xffffffff

def _zone(y):
    """Paint tables per depth, from the sheet band census: bright warm reds
    right under the crust, boulder crimson, then darker + less detailed until
    the field is near-flat dark maroon."""
    if y < 15:
        # clean bright slab bricks right under the crust — the ember seams
        # around them carry the texture, the bodies stay crisp
        return dict(body=[(112, 20, 13)],
                    top=[(188, 80, 24), (156, 57, 23)], shade=(89, 14, 12),
                    mortar=(39, 3, 11), mott=None, fleck=None,
                    detail=3)
    if y < 27:
        return dict(body=[(100, 4, 22), (100, 4, 22), (100, 4, 22), (112, 20, 13)],
                    top=[(156, 57, 23), (125, 49, 24)], shade=(56, 6, 15),
                    mortar=(56, 6, 15), mott=(56, 6, 15), fleck=(125, 49, 24),
                    detail=3)
    if y < 38:
        return dict(body=[(100, 4, 22), (100, 4, 22), (100, 4, 22), (79, 18, 18)],
                    top=[(125, 49, 24)], shade=(56, 6, 15),
                    mortar=(22, 4, 15), mott=(56, 6, 15), fleck=None,
                    detail=2)
    if y < 50:
        return dict(body=[(56, 6, 15), (56, 6, 15), (56, 6, 15), (79, 18, 18)],
                    top=[(90, 35, 15)], shade=(22, 4, 15),
                    mortar=(22, 4, 15), mott=(39, 3, 11), fleck=None,
                    detail=1)
    if y < 64:
        return dict(body=[(56, 6, 15), (56, 6, 15), (56, 6, 15), (22, 4, 15)],
                    top=[], shade=(22, 4, 15),
                    mortar=(22, 4, 15), mott=(39, 3, 11), fleck=None,
                    detail=1)
    # near the bottom the sheet goes 95% flat dark maroon: stones dissolve
    return dict(body=[(22, 4, 15)], top=[], shade=(22, 4, 15),
                mortar=(22, 4, 15), mott=(1, 8, 0), fleck=(56, 6, 15),
                detail=0)

def _ember(y, rng):
    """Vein core color by depth: molten gold at the crust, dying coals deep."""
    if y < 10:  return (245, 170, 70) if rng.random() < 0.5 else (228, 96, 22)
    if y < 20:  return (228, 96, 22) if rng.random() < 0.7 else (220, 76, 18)
    if y < 34:  return (228, 96, 22) if rng.random() < 0.45 else (203, 83, 22)
    if y < 48:  return (203, 83, 22) if rng.random() < 0.6 else (171, 64, 16)
    if y < 62:  return (171, 64, 16)
    return (111, 42, 13)


def build_masonry():
    import math
    """Draws the continuous 256x128 organic masonry band: wandering courses,
    mixed stone sizes (some spanning two courses), rounded eroded outlines,
    near-black mortar gaps, ember veins flowing along the joints."""
    P, H = MAS_W, MAS_H
    R = random.Random(0xB1A57)

    def wobble(base, amp, seed):
        r = random.Random(seed)
        k1, k2 = r.randint(1, 3), r.randint(4, 7)
        p1, p2 = r.uniform(0, 6.283), r.uniform(0, 6.283)
        a1, a2 = amp * r.uniform(0.6, 1.0), amp * r.uniform(0.3, 0.6)
        return [base + a1 * math.sin(2 * math.pi * k1 * x / P + p1)
                     + a2 * math.sin(2 * math.pi * k2 * x / P + p2)
                for x in range(P)]

    # course boundary curves: crust bottom first, then courses of natural
    # height — a shallow course under the crust, the big boulder course, then
    # cobbles growing coarser and darker
    HGT = [9, 13, 11, 10, 9, 9, 10, 10, 11, 12, 12]
    bounds = [wobble(5.0, 1.0, 11)]
    nominal = [5.0]
    y = 5.0
    for i, h in enumerate(HGT):
        y += h
        if y >= H - 4:
            break
        bounds.append(wobble(y, 1.7, 23 + i))
        nominal.append(y)
    bounds.append([float(H)] * P)
    nominal.append(float(H))
    C = len(bounds) - 1

    # stones per course: cut positions on the 256px circle; forced cuts carry
    # two-course boulders (the child interval unions with its parent)
    stone_seq = [1]
    def next_id():
        stone_seq[0] += 1
        return stone_seq[0]
    root = {}
    def find(i):
        while root.get(i, i) != i:
            i = root[i]
        return i

    courses = []          # per course: list of (x0, x1, cut, stone_id)
    forced = [[] for _ in range(C + 1)]   # (x0, x1, parent_id, cutl, cutr)
    for c in range(C):
        ztop = _zone(int(nominal[c]))
        segs = []
        taken = sorted((f[0], f[1]) for f in forced[c])
        # free arcs of the circle
        arcs = []
        if not taken:
            ph = R.randrange(256)
            arcs = [(ph, ph + P)]
        else:
            for i, (a, b) in enumerate(taken):
                nxt = taken[(i + 1) % len(taken)][0] + (P if i + 1 == len(taken) else 0)
                if nxt - b >= 4:
                    arcs.append((b, nxt))
        for f in forced[c]:
            iid = next_id()
            root[iid] = find(f[2])
            segs.append((f[0], f[1], f[3], f[4], iid))
        for (a0, a1) in arcs:
            x = a0
            while x < a1:
                if c == 0:                   # wide flat slab bricks under the crust
                    w = R.randint(14, 26)
                elif c == 1:                 # the boulder course: the sheet's stars
                    w = R.randint(32, 42) if R.random() < 0.25 else R.randint(18, 32)
                elif ztop['detail'] >= 2:
                    big = R.random() < 0.15
                    w = R.randint(26, 38) if big else \
                        R.randint(10, 15) if R.random() < 0.25 else R.randint(15, 25)
                else:                        # deeper: smaller, rounder cobbles
                    big = R.random() < 0.08
                    w = R.randint(24, 32) if big else \
                        R.randint(8, 13) if R.random() < 0.45 else R.randint(13, 20)
                if a1 - (x + w) < 8:
                    w = a1 - x
                iid = next_id()
                cutl = dict(x=x, s=R.randint(-2, 2), seed=R.randrange(1 << 30))
                cutr = dict(x=x + w, s=R.randint(-2, 2), seed=R.randrange(1 << 30))
                segs.append((x, x + w, cutl, cutr, iid))
                # boulder: claim the same arc one course down, same edge cuts
                if c + 1 < C and w >= 20 and R.random() < 0.14 and ztop['detail'] >= 1:
                    forced[c + 1].append((x, x + w, iid, cutl, cutr))
                x += w
        courses.append(segs)

    # rasterize: per pixel, which stone (root id); 0 = crust zone
    idm = [[0] * P for _ in range(H)]
    meta = {}      # root id -> (center y, width, seed)
    for c in range(C):
        h_c = max(4.0, nominal[c + 1] - nominal[c])
        for (x0, x1, cutl, cutr, iid) in courses[c]:
            rid = find(iid)
            if rid not in meta:
                meta[rid] = [int((nominal[c] + nominal[c + 1]) / 2), x1 - x0,
                             R.randrange(1 << 30)]
            else:
                meta[rid][0] = (meta[rid][0] + int((nominal[c] + nominal[c + 1]) / 2)) // 2
            for xx in range(x0, x1):
                x = xx % P
                yt, yb = bounds[c][x], bounds[c + 1][x]
                for yy in range(int(yt), min(H, int(yb))):
                    # slanted + wiggled joint edges
                    t = (yy - nominal[c]) / h_c
                    el = cutl['x'] + cutl['s'] * t + (_h2(cutl['seed'], yy >> 1) % 3) - 1
                    er = cutr['x'] + cutr['s'] * t + (_h2(cutr['seed'], yy >> 1) % 3) - 1
                    if el <= xx < er:
                        idm[yy][x] = rid
    # pixels no interval claimed (slant gaps) stay 0 -> mortar

    # paint
    im = Image.new('RGB', (P, H), (1, 8, 0))
    px = im.load()
    mortar_mask = [[False] * P for _ in range(H)]

    def rdist(x, y, s, dx, dy, cap=7):
        """steps along (dx,dy) until a pixel outside stone s (cap'd)."""
        for i in range(1, cap + 1):
            yy = y + dy * i
            if yy < 0:
                return i                       # crust above counts as outside
            if yy >= H:
                return cap + 1                 # canvas bottom continues
            o = idm[yy][(x + dx * i) % P]
            if o != 0:
                o = find(o)
            if o != s:
                return i
        return cap + 1

    for y in range(H):
        z = _zone(y)
        for x in range(P):
            if y < bounds[0][x]:
                continue                       # crust painted after
            s = idm[y][x]
            if s == 0:
                px[x, y] = z['mortar']
                mortar_mask[y][x] = True
                continue
            sm = meta[s]
            srng = sm[2]
            zc = _zone(sm[0])
            body = zc['body'][srng % len(zc['body'])]
            hb = _h2(x, y * 977 + srng)
            # rounded boulder outline: cardinal distances to the stone's edge;
            # a corner radius proportional to the stone's size melts the
            # rectangle into a pill shape, plus hash-eroded bites
            dl = rdist(x, y, s, -1, 0); dr = rdist(x, y, s, 1, 0)
            du = rdist(x, y, s, 0, -1); dd = rdist(x, y, s, 0, 1)
            dh, dv = min(dl, dr), min(du, dd)
            big = sm[1] >= 24
            rc = 3 + (srng >> 4) % 2 if big else 2 + (srng >> 4) % 2
            gh = 2 if (srng >> 8) % 3 == 0 else 1
            if dh <= gh or dv <= 1 or dh + dv <= rc \
                    or (dh + dv <= rc + 2 and hb % 11 == 0):
                px[x, y] = z['mortar']
                mortar_mask[y][x] = True
                continue
            # edge shading: a thin lit rim on top, shadowed bottom, quiet
            # sides — the sheet lights its crimson stones with a 1-2px
            # orange-brown crest, never a flooded top
            rim = 1 + (1 if zc['detail'] >= 3 and srng % 3 == 0 else 0)
            if du <= dd and du <= rim + 1 \
                    and zc['top'] and (zc['detail'] >= 3 or hb % 2 == 0):
                px[x, y] = zc['top'][srng % len(zc['top'])]
            elif dd < du and dd <= 2:
                px[x, y] = zc['shade']
            elif dh <= gh + 1 and hb % 3 == 0:
                px[x, y] = zc['shade']
            # body with sparse mottle (2px blobs where detail is high)
            elif zc['mott'] and zc['detail'] >= 2 and \
                    (hb % 37 == 0 or _h2(x - 1, y * 977 + srng) % 37 == 0):
                px[x, y] = zc['mott']
            elif zc['mott'] and zc['detail'] < 2 and hb % 31 == 0:
                px[x, y] = zc['mott']
            elif zc['fleck'] and zc['detail'] >= 3 and hb % 41 == 0:
                px[x, y] = zc['fleck']
            elif zc['fleck'] and zc['detail'] == 0 and hb % 173 == 0:
                px[x, y] = zc['fleck']
            else:
                px[x, y] = body

    # cracks across the bigger stones
    for rid, (cy, w, seed) in meta.items():
        r = random.Random(seed ^ 0xC4AC)
        z = _zone(cy)
        if w >= 22 and z['detail'] >= 2 and r.random() < 0.45:
            # find a column inside the stone
            cols = [x for x in range(P) if 0 <= cy < H and find(idm[cy][x] or 0) == rid] \
                if True else []
            if not cols:
                continue
            x = r.choice(cols)
            y = cy
            while y > 0 and find(idm[y - 1][x] or 0) == rid:
                y -= 1
            n = 0
            while y < H and find(idm[y][x % P] or 0) == rid and n < 14:
                px[x % P, y] = z['mortar'] if r.random() < 0.8 else z['shade']
                if r.random() < 0.4:
                    x += r.choice((-1, 1))
                y += 1
                n += 1
            if cy < 40 and r.random() < 0.5 and y - 1 > 0:
                px[x % P, y - 1] = (203, 83, 22)

    # ember veins: random walks along the mortar graph, molten at the crust,
    # dying out with depth — connected flows, not speckle
    vr = random.Random(0xEA5EED)
    def walk(x, y, budget, allow_dig=True):
        lastdx = 0
        run = 0
        while budget > 0 and y < 66:         # coals die out; the deep rows stay dark
            px[x % P, y] = _ember(y, vr)
            # molten pooling: the vein widens where the joint has room,
            # brighter than its own core — reads as glow, not speckle
            if budget % 3 == 0 and mortar_mask[y][(x + 1) % P]:
                px[(x + 1) % P, y] = _ember(max(0, y - 8), vr)
            if y < 26 and budget % 4 == 1 and mortar_mask[y][(x - 1) % P]:
                px[(x - 1) % P, y] = _ember(y, vr)
            budget -= 1
            cands = []
            for dx, dy, wgt in ((0, 1, 7), (1, 1, 4), (-1, 1, 4), (1, 0, 2), (-1, 0, 2)):
                if dy == 0 and (dx == -lastdx and lastdx != 0 or run > 5):
                    continue
                yy = y + dy
                if yy >= H:
                    continue
                if mortar_mask[yy][(x + dx) % P]:
                    cands.append((dx, dy, wgt))
            if not cands:
                if allow_dig and vr.random() < 0.65 and y + 1 < H:
                    x, y = x, y + 1        # burn through a thin stone lip
                    run = 0
                    continue
                break
            tot = sum(c[2] for c in cands)
            pick = vr.random() * tot
            for dx, dy, wgt in cands:
                pick -= wgt
                if pick <= 0:
                    break
            run = run + 1 if dy == 0 else 0
            lastdx = dx if dy == 0 else 0
            x, y = x + dx, y + dy

    # crust-fed veins: sparse, spaced, gated on a joint actually being there
    starts = []
    for x in range(0, P, 4):
        ys = int(bounds[0][x]) + 1
        if any(mortar_mask[yy][x] for yy in range(ys, ys + 4) if yy < H):
            starts.append(x)
    vr.shuffle(starts)
    kept = []
    for x in starts:
        if all(min(abs(x - k), P - abs(x - k)) >= 20 for k in kept):
            kept.append(x)
    kept = kept[:8]
    for i, x in enumerate(sorted(kept)):
        y = int(bounds[0][x]) + 1
        budget = (46, 22, 34, 14, 55, 18, 28, 12)[i % 8]
        # molten throat where the vein leaves the crust
        px[x, y - 1] = CRUST_LOW
        px[x, max(0, y - 2)] = CRUST_MID
        walk(x, y, budget)
    # a few mid-depth glows on their own
    for i in range(4):
        x = vr.randrange(P)
        ys = [yy for yy in range(24, 48) if mortar_mask[yy][x]]
        if ys:
            walk(x, ys[0], vr.randrange(8, 18), allow_dig=False)

    # the hot seam: right under the crust the sheet's joints GLOW — fill most
    # of the first course's mortar with ember so the crust visibly feeds the
    # vein network instead of sitting on a black gap
    for x in range(P):
        hj = _h2(x >> 1, 0x407)              # 2px-run scale, connected blobs
        for y in range(int(bounds[0][x]), 15):
            if mortar_mask[y][x] and hj % 5 != 0 and _h2(x >> 1, (y >> 1) + 0x77) % 6 != 0:
                px[x, y] = ((220, 76, 18), (228, 96, 22), (212, 113, 33),
                            (188, 80, 24))[_h2(x >> 1, y >> 1) % 4] \
                    if y < 11 else (171, 64, 16)

    # crust: chunky molten top band — bright blobs, dark crack notches, drips
    for x in range(P):
        b0 = max(4, int(bounds[0][x] + 0.5))
        hx = _h2(x, 0xC0)
        hx3 = _h2(x >> 2, 0xC1)              # 4px-blob scale
        px[x, 0] = CRUST_HI
        px[x, 1] = CRUST_HI if hx3 % 3 == 0 else CRUST_GLO
        px[x, 2] = CRUST_GLO if hx3 % 5 == 0 else CRUST_MID
        for yy in range(3, b0):
            px[x, yy] = (CRUST_MID if hx3 % 7 == 0 and yy == 3 else
                         CRUST_LOW if yy == 3 else CRUST_SET)
        if b0 >= 5 and hx3 % 4 == 0:         # shadow pocket under the overhang
            px[x, b0 - 1] = (56, 6, 15)
        if hx % 7 == 0:                      # dark crack notches break the band
            px[x, 2] = CRUST_LOW
            for yy in range(3, b0):
                px[x, yy] = (56, 6, 15)
        if hx % 13 == 0:                     # deep crack up into the bright lip
            for yy in range(1, b0):
                px[x, yy] = (CRUST_SET if yy == 1 else CRUST_DRK)
        if hx % 19 == 0 and b0 + 1 < H:      # drip hanging into the stones
            px[x, b0] = CRUST_LOW
            if idm[b0 + 1][x] == 0 or _h2(x, 5) % 2:
                px[x, b0 + 1] = (188, 80, 24)
    return im


def build_tiles(palimg, base_sheet):
    """133-frame 16px tileset — ORGANIC MASONRY, reworked to the APPROVED
    direction sheet (hybrid_b) after the fix round's uniform block grid was
    rejected against it: the strip now encodes a continuous 256x128 organic
    stone band (16-tile x period, 8 courses deep) — irregular stones of mixed
    sizes (some spanning two courses), wandering course lines, rounded eroded
    outlines, near-black mortar gaps, ember veins flowing ALONG the joints,
    and a depth fade baked into the stonework itself. Paint colors are exact
    locked-palette entries chosen from a per-depth census of the sheet's own
    floor band (see the zone tables). Frame map:
      0..15    surface course (walked crust), x phase 0..15
      16..127  fill, depth d=1..7 below the surface: 16 + (d-1)*16 + phase
      128/129  surface pit edge, pit on the LEFT / RIGHT
      130      underside lip (floating platforms)
      131/132  pit wall, pit on the LEFT / RIGHT
    web/game/tiles.js pickTileFrame mirrors this map; any frame meshes with
    its neighbours because adjacent frames are adjacent windows of the same
    continuous band."""
    m = build_masonry()
    im = Image.new('RGBA', (TILE_FRAMES * 16, 16), (0, 0, 0, 0))
    def put(i, tile):
        im.paste(tile.convert('RGBA'), (i * 16, 0))
    for p in range(TILE_P):                  # 0..15 surface
        put(p, m.crop((p * 16, 0, p * 16 + 16, 16)))
    for d in range(1, FILL_D + 1):           # 16..127 fill by depth
        for p in range(TILE_P):
            put(16 + (d - 1) * 16 + p,
                m.crop((p * 16, d * 16, p * 16 + 16, d * 16 + 16)))

    def lit_col(t, x):
        d = ImageDraw.Draw(t)
        d.rectangle([x, 0, x, 15], fill=(232, 165, 78))
        d.rectangle([x + (1 if x == 0 else -1), 2,
                     x + (1 if x == 0 else -1), 15], fill=(148, 73, 35))
        return t
    put(128, lit_col(m.crop((3 * 16, 0, 3 * 16 + 16, 16)), 0))    # pit on LEFT
    put(129, lit_col(m.crop((11 * 16, 0, 11 * 16 + 16, 16)), 15)) # pit on RIGHT

    un = m.crop((5 * 16, 16, 5 * 16 + 16, 32))                    # underside lip
    dU = ImageDraw.Draw(un)
    dU.rectangle([0, 14, 15, 14], fill=(56, 6, 15))
    dU.rectangle([0, 15, 15, 15], fill=(22, 4, 15))
    put(130, un)

    DARKER = {(112, 20, 13): (79, 18, 18), (100, 4, 22): (56, 6, 15),
              (79, 18, 18): (56, 6, 15), (125, 49, 24): (90, 35, 15),
              (156, 57, 23): (125, 49, 24), (188, 80, 24): (125, 49, 24),
              (39, 3, 11): (1, 8, 0), (89, 14, 12): (56, 6, 15)}
    for i, (ph, lx) in ((131, (2, 0)), (132, (9, 15))):
        t = m.crop((ph * 16, 32, ph * 16 + 16, 48)).copy()
        tp = t.load()
        for yy in range(16):
            for xx in range(16):
                c = tp[xx, yy][:3] if len(tp[xx, yy]) > 3 else tp[xx, yy]
                tp[xx, yy] = DARKER.get(c, c)
        dP = ImageDraw.Draw(t)
        dP.rectangle([lx, 0, lx, 15], fill=(173, 71, 39))         # lit pit face
        dP.rectangle([lx + (1 if lx == 0 else -1), 0,
                      lx + (1 if lx == 0 else -1), 15], fill=(89, 14, 12))
        rng = random.Random(11 + i)
        for _ in range(2):
            x, y = rng.randrange(4, 12), rng.randrange(2, 12)
            dP.line([x, y, x + rng.randrange(1, 3), y + rng.randrange(2, 4)],
                    fill=(171, 64, 16))
        put(i, t)
    # No quantize pass: every color above IS an exact locked-master entry
    # (verified by the regen driver), and build_palette's palimg predates the
    # sky-derived master additions — quantizing through it would silently
    # merge the ember ramp the sheet census picked.
    return im

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


def rock_texture(im, palimg, seed=4451):
    """Fix-round craft pass for the NEAR rock band: as shipped, its interior
    was one flat maroon — the largest flat area on screen ("makes everything
    else look bland", user playtest). This carves the hybrid_b sheet's
    canyon-face reading back in: soft strata bands, erosion streaks, sparse
    warm highlight veins — all kept DARK so player/enemies still pop. The
    strata wobble is periodic in x (sin over the 640 band) and the streaks
    wrap by mod, so the strip still tiles seam-free; the lit rim + existing
    crack highlights are preserved (bright pixels untouched)."""
    import math
    o = im.copy(); px = o.load()
    W, H = o.size
    rng = random.Random(seed)
    top = []
    for x in range(W):
        t = H
        for y in range(H):
            if px[x, y][3] > 0:
                t = y
                break
        top.append(t)
    for x in range(W):
        for y in range(top[x], H):
            r, g, b, a = px[x, y]
            if a == 0 or r > 120:
                continue
            wob = (math.sin(2 * math.pi * 3 * x / W) * 2.5
                   + math.sin(2 * math.pi * 7 * x / W + 1.7) * 1.5)
            band = math.sin((y + wob) * 1.15) + 0.5 * math.sin((y + wob) * 0.41 + 2.2)
            # Explicit strata targets (palette-family colors): a plain +/-11%
            # multiply died in quantize — every dark maroon snapped back to
            # the same entry — but mixing toward a neighbouring entry survives.
            if band > 0.8:
                tgt, m = (117, 61, 57), 0.38
            elif band < -0.8:
                tgt, m = (33, 5, 16), 0.42
            else:
                tgt, m = None, 0.0
            h = ((x * 374761393 + y * 668265263) ^ 0x9e37) & 0xffff
            if h < 5200:
                tgt, m = (59, 25, 15), 0.5
            if tgt:
                r = round(r + (tgt[0] - r) * m)
                g = round(g + (tgt[1] - g) * m)
                b = round(b + (tgt[2] - b) * m)
            px[x, y] = (r, g, b, a)
    for _ in range(26):                                    # erosion streaks
        x0 = rng.randrange(W); y0 = rng.randrange(6, H - 8)
        x = x0
        for i in range(rng.randrange(8, 26)):
            y = y0 + i
            if y >= H:
                break
            if rng.random() < 0.3:
                x += rng.choice([-1, 1])
            c = px[x % W, y]
            if c[3] and c[0] <= 120:
                px[x % W, y] = (int(c[0] * 0.76), int(c[1] * 0.76), int(c[2] * 0.76), c[3])
    for _ in range(14):                                    # highlight veins
        x0 = rng.randrange(W); y0 = rng.randrange(10, H - 4)
        y = y0
        for i in range(rng.randrange(6, 16)):
            x = (x0 + i) % W
            if rng.random() < 0.25:
                y += rng.choice([-1, 1])
            yy = min(H - 1, max(0, y))
            c = px[x, yy]
            if c[3] and c[0] <= 120 and yy > top[x] + 3:
                px[x, yy] = (148, 73, 35, c[3])
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
    fr = [tiles.crop((i * 16, 0, i * 16 + 16, 16)) for i in range(TILE_FRAMES)]
    pit = pit or ()
    for tx in pit:                                       # pit void: fades down
        for yy in range(HORIZON, VH):
            k = (yy - HORIZON) / (VH - HORIZON)
            c = (round(46 - 40 * k), round(14 - 12 * k), round(16 - 14 * k))
            d.line([tx * 16, yy, tx * 16 + 15, yy], fill=c)
    # frame choice mirrors tiles.js pickTileFrame on this flat-slab geometry:
    # surface phase across the 16-tile super-pattern, depth-indexed fill,
    # shaped pit edges/walls
    for ty in range(8):
        for tx in range(VW // 16):
            if tx in pit:
                continue
            ph = tx % TILE_P
            if ty == 0:
                if tx - 1 in pit:   t = fr[128]          # lit pit-facing edge
                elif tx + 1 in pit: t = fr[129]
                else:               t = fr[ph]
            elif tx - 1 in pit:
                t = fr[131]
            elif tx + 1 in pit:
                t = fr[132]
            else:
                t = fr[16 + (min(ty, FILL_D) - 1) * 16 + ph]
            comp.alpha_composite(t, (tx * 16, HORIZON + ty * 16))
    # depth-band overlays, matched to play.js bandAlpha (most of the fade is
    # baked into the stonework now; these only settle the deepest rows)
    for r0, r1, al in ((2, 3, 0.08), (3, 5, 0.18), (5, 8, 0.32)):
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
    A['rocks'] = rock_texture(A['rocks'], palimg)
    A['tiles'] = build_tiles(palimg, base_sheet)
    A['tiles_wow'] = ember_shift(A['tiles'], palimg)
    props = build_objects('prod_props', [64, 56, 40], palimg)
    A['props'] = {'spire': props[0], 'arch': props[1], 'wreck': props[2]}
    # Ancient landmarks (fix round, user request): four ruined monuments
    # joining the spire/arch/wreck family — half-buried colossal statue head,
    # weathered obelisk, megalithic gate, colossal fossil ribcage. Same
    # pipeline (chroma-key → objects → quantize into the LOCKED master, which
    # deliberately does not learn any new entries from this raw).
    lands = build_objects('prod_landmarks', [44, 58, 52, 34], palimg)
    A['landmarks'] = {'head': lands[0], 'obelisk': lands[1],
                      'mgate': lands[2], 'ribs': lands[3]}
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
    for k, v in A['landmarks'].items():
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
