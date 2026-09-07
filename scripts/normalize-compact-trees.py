#!/usr/bin/env python3
"""Mechanical draft normalization; never paints or reshapes authored foliage."""
import hashlib
import json
from pathlib import Path

from PIL import Image
from reviewed_png import save_reviewed_png

ROOT = Path(__file__).resolve().parents[1]
FAMILY = ROOT / 'assets/pixel-city-pack/reference/ai-authored/compact-trees-v7'


def pixel_data(image):
    return image.get_flattened_data() if hasattr(image, 'get_flattened_data') else image.getdata()


def main():
    output = FAMILY / 'normalized'
    output.mkdir(parents=True, exist_ok=True)
    entries = {}
    review_path = FAMILY / 'visual-review.json'
    review = json.loads(review_path.read_text()) if review_path.exists() else {}
    sources = sorted((FAMILY / 'sources').glob('tree-*.png'))
    sheet = Image.new('RGBA', (max(1, len(sources)) * 24, 64), '#81975b')
    for index, source in enumerate(sources):
        image = Image.open(source).convert('RGBA')
        image.putdata([(0, 0, 0, 0) if min(r, b) > 90 and g < min(r, b) * .75 else (r, g, b, a)
                       for r, g, b, a in pixel_data(image)])
        bounds = image.getchannel('A').getbbox()
        if not bounds:
            raise ValueError(f'Empty tree: {source}')
        crop = image.crop(bounds)
        max_width, max_height = (8, 9) if source.stem == 'tree-deadwood' else (12, 14)
        scale = min(max_width / crop.width, max_height / crop.height)
        size = (round(crop.width * scale), round(crop.height * scale))
        crop = crop.resize(size, Image.Resampling.NEAREST)
        alpha = crop.getchannel('A').point(lambda a: 255 if a >= 128 else 0)
        crop = crop.convert('RGB').quantize(colors=11, dither=Image.Dither.NONE).convert('RGBA')
        crop.putalpha(alpha)
        canvas = Image.new('RGBA', (16, 16))
        canvas.alpha_composite(crop, ((16 - size[0]) // 2, 16 - size[1]))
        canvas.putdata([p if p[3] else (0, 0, 0, 0) for p in pixel_data(canvas)])
        target = output / source.name
        source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
        runtime_sha = save_reviewed_png(canvas, target, source_sha, review.get('trees', {}).get(source.stem))
        mask = [[x, y] for y in range(16) for x in range(16) if canvas.getpixel((x, y))[3]]
        if any(x < 4 or x > 11 for x, y in mask if y >= 14):
            raise ValueError(f'Ground contact escapes planting cell: {source.stem}')
        entries[source.stem] = {'sourceSha256': source_sha,
            'runtimeSha256': runtime_sha,
            'sourceFrame': bounds, 'size': [16, 16], 'anchorPx': [8, 16],
            'occupiedBoundsPx': canvas.getchannel('A').getbbox(), 'alphaMask': mask,
            'paletteColors': len(set(pixel_data(canvas)))}
        sheet.alpha_composite(canvas, (index * 24 + 4, 8))
    # Scale comparison uses real reviewed low-rise assets, not a drawing proxy.
    for i, family in enumerate(('compact-row-v1', 'compact-wide-v1')):
        home = Image.open(FAMILY.parent / family / 'normalized/stage-5.png').convert('RGBA')
        if sheet.width >= (i + 1) * 56:
            sheet.alpha_composite(home, (i * 56, 64 - home.height))
    sheet.save(FAMILY / 'scale-preview.png')
    sheet.resize((sheet.width * 6, sheet.height * 6), Image.Resampling.NEAREST).save(FAMILY / 'scale-preview-6x.png')
    (FAMILY / 'report.json').write_text(json.dumps({'profile': 'TASKTOPIA_V7_TREE_COMPACT_45_GRID',
        'normalization': 'Common per-tree uniform crop; nearest-neighbour, hard alpha, palette quantization only.',
        'trees': entries}, indent=2) + '\n')
    print(json.dumps({key: {k: v for k, v in value.items() if k != 'alphaMask'} for key, value in entries.items()}))


if __name__ == '__main__':
    main()
