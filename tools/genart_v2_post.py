#!/usr/bin/env python3
"""Post-processing for the image-generation-sourced direction sheets.

Source images come from prompted image generation (prompt + raw output stored
under assets-wow/raw/<direction>/ for full traceability — see the provenance
note in INTEGRATION_NOTES.md). This tool does the craft pass that turns a raw
generation into a native-fidelity direction sheet:

  1. center-crop to exact 16:9, LANCZOS downscale to the 640x360 virtual res;
  2. palette quantization (median cut, no dither) to a curated color budget,
     reporting the exact color count per sheet;
  3. compositing the official sprites UNMODIFIED at sensible positions: feet
     ON the walkable surface line measured per sheet (the flyer hovers, as it
     does in game);
  4. divergence check vs the baseline plate: mean absolute RGB pixel delta
     must be >= 25 (hard floor — under it a sheet is too timid by definition);
  5. 2x nearest upscale for review, 2x2 contact sheet, DIVERGENCE.json.

Only the raw sourcing is non-deterministic; everything in THIS file is a pure
function of the committed raw images.
"""
from PIL import Image, ImageDraw
from pathlib import Path
import json

from genart_v2 import load_atlas_sprites, paste_feet, up2

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'assets-wow' / 'raw'
OUT = ROOT / 'assets-wow' / 'directions'
BASELINE = ROOT / 'assets-wow' / 'baseline' / '02_early_gauntlet.png'
VW, VH = 640, 360

# direction -> (color budget, walkable surface y in the 640x360 frame,
#               one-line description for the report)
DIRECTIONS = {
    'dir1_sunset_canyon': (40, 238,
        'molten banded sunset, giant slatted sun, rim-lit mesa rows, red strata rock'),
    'dir2_neon_abyss': (40, 270,
        'indigo night, magenta/teal nebulae, neon-rimmed spires, crystals, lit ground edge'),
    'dir3_butterscotch_day': (36, 235,
        'bright butterscotch daylight, dust-haze horizon, chunky saturated stone terrain'),
    'dir4_moss_dusk': (40, 236,
        'teal-to-magenta dusk, lit cloud bands, skyline arches, moss-fringed ground lip'),
}

def to_native(raw_path, colors):
    im = Image.open(raw_path).convert('RGB')
    # center-crop to exact 16:9 before scaling
    tw = im.height * 16 // 9
    if im.width > tw:
        x0 = (im.width - tw) // 2
        im = im.crop((x0, 0, x0 + tw, im.height))
    im = im.resize((VW, VH), Image.LANCZOS)
    q = im.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    out = q.convert('RGB')
    used = len({c for _, c in out.getcolors(maxcolors=1 << 20)})
    return out.convert('RGBA'), used

def place_cast(im, sprites, ground_y):
    """Official sprites, unmodified, standing ON the surface; saucer hovers."""
    paste_feet(im, sprites['run'], 180, ground_y)
    paste_feet(im, sprites['enemywalk'], 430, ground_y)
    paste_feet(im, sprites['enemyfly'], 545, ground_y - 78)
    coin = sprites['coin'][0].convert('RGBA')
    for i, cx in enumerate((240, 262, 284)):
        im.alpha_composite(coin, (cx, ground_y - 46 - (4 if i == 1 else 0)))

def divergence(img, base):
    pa, pb = img.convert('RGB').load(), base.convert('RGB').load()
    tot = 0
    for y in range(VH):
        for x in range(VW):
            ca, cb = pa[x, y], pb[x, y]
            tot += abs(ca[0] - cb[0]) + abs(ca[1] - cb[1]) + abs(ca[2] - cb[2])
    return tot / (VW * VH * 3)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sprites = load_atlas_sprites()
    base = Image.open(BASELINE).resize((VW, VH), Image.NEAREST)
    report, sheets = {}, []
    for name, (colors, ground_y, desc) in DIRECTIONS.items():
        im, used = to_native(RAW / name / 'raw_0.jpg', colors)
        place_cast(im, sprites, ground_y)
        delta = divergence(im, base)
        report[name] = {'desc': desc, 'palette_colors': used,
                        'ground_y': ground_y,
                        'divergence_vs_baseline': round(delta, 2),
                        'raw': f'raw/{name}/raw_0.jpg',
                        'prompt': f'raw/{name}/prompt.txt'}
        up2(im).save(OUT / f'{name}.png')
        sheets.append((name, im))
        print(f'{name}: colors={used} divergence={delta:.2f}')
    contact = Image.new('RGB', (VW * 2, VH * 2))
    d = ImageDraw.Draw(contact)
    for i, (name, im) in enumerate(sheets):
        x, y = (i % 2) * VW, (i // 2) * VH
        contact.paste(im.convert('RGB'), (x, y))
        d.rectangle([x + 4, y + 4, x + 10 + 6 * len(name), y + 17], fill='#000000')
        d.text((x + 8, y + 6), name, fill='#ffffff')
    contact.save(OUT / 'directions_contact.png')
    (OUT / 'DIVERGENCE.json').write_text(json.dumps(report, indent=1))
    fails = [n for n, r in report.items() if r['divergence_vs_baseline'] < 25]
    print('floor check (>=25):', ('FAIL: ' + ', '.join(fails)) if fails else 'all pass')

if __name__ == '__main__':
    main()
