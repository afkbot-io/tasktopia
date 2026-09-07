#!/usr/bin/env python3
"""Normalize independent furniture sources; never repaint their geometry."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import sys

from PIL import Image, ImageDraw


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(family, require_complete=False, require_review=False):
    root = next(parent for parent in family.parents if (parent / 'scripts/verify-compact-building-art.py').is_file())
    helpers = runpy.run_path(str(root / 'scripts/verify-compact-building-art.py'))
    sys.path.insert(0, str(root / 'scripts'))
    from courtyard_furniture_contract import rack_supports_valid
    contract = json.loads((family / 'geometry.json').read_text())
    reviewed_path = family / 'visual-review.json'
    review = json.loads(reviewed_path.read_text()) if reviewed_path.exists() else {}
    normalized = family / 'normalized'
    previews = family / 'previews'
    normalized.mkdir(exist_ok=True)
    previews.mkdir(exist_ok=True)
    report = {'key': contract['key'], 'visualProfile': contract['visualProfile'],
              'normalization': contract['normalization'], 'objects': {}, 'errors': []}
    errors = report['errors']
    for key, geometry in contract['objects'].items():
        source_path = family / 'sources' / f'{key}.png'
        if not source_path.exists():
            if require_complete:
                errors.append(f'{key}: source missing')
            continue
        source = helpers['extract_source'](source_path, geometry['sourceBackground'])
        alpha = source.getchannel('A').point(lambda value: 255 if value >= 128 else 0)
        if alpha.getextrema()[0] == 255:
            errors.append(f'{key}: opaque background is not a cutout')
            continue
        source.putalpha(alpha)
        frame = alpha.getbbox()
        if frame is None:
            errors.append(f'{key}: empty source')
            continue
        limit_w, limit_h = geometry['occupiedMaximum']
        source_w, source_h = frame[2] - frame[0], frame[3] - frame[1]
        scale = min(limit_w / source_w, limit_h / source_h)
        target = (max(1, round(source_w * scale)), max(1, round(source_h * scale)))
        image = source.crop(frame).resize(target, Image.Resampling.NEAREST)
        alpha = image.getchannel('A')
        image = image.convert('RGB').quantize(colors=contract['paletteColorsMax'] - 1,
                    method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE).convert('RGBA')
        image.putalpha(alpha)
        width, height = geometry['spriteSize']
        offset = ((width - target[0]) // 2, height - target[1])
        canvas = Image.new('RGBA', (width, height))
        canvas.paste(image, offset)
        canvas.putdata([pixel if pixel[3] else (0, 0, 0, 0) for pixel in helpers['pixel_data'](canvas)])
        path = normalized / f'{key}.png'
        canvas.save(path)
        bounds = canvas.getchannel('A').getbbox()
        occupied = [bounds[2] - bounds[0], bounds[3] - bounds[1]] if bounds else [0, 0]
        colors = len(set(helpers['pixel_data'](canvas)))
        if not bounds or bounds[3] != geometry['anchorPx'][1]:
            errors.append(f'{key}: ground contact misses bottom anchor')
        if any(not low <= actual <= high for actual, low, high in
               zip(occupied, geometry['occupiedMinimum'], geometry['occupiedMaximum'])):
            errors.append(f'{key}: occupied size{occupied} misses contract')
        if colors > contract['paletteColorsMax']:
            errors.append(f'{key}: palette exceeds contract')
        if key == 'courtyard-cycle-rack' and not rack_supports_valid(canvas):
            errors.append(f'{key}: requires three closed U-hoops with connected tops and both legs')
        measured = {'sourceSha256': digest(source_path), 'runtimeSha256': digest(path),
                    'sourceCanvas': list(source.size), 'sourceFrame': list(frame),
                    'uniformScale': scale, 'targetSize': list(target), 'offset': list(offset),
                    'occupiedBoundsPx': list(bounds) if bounds else None,
                    'occupiedSizePx': occupied, 'paletteColors': colors,
                    'alphaValues': sorted(set(helpers['pixel_data'](canvas.getchannel('A'))))}
        report['objects'][key] = measured
        approved = review.get('objects', {}).get(key)
        if require_review or approved:
            if not approved or approved.get('accepted') is not True or any(
                approved.get(field) != measured[field] for field in ('sourceSha256', 'runtimeSha256')):
                errors.append(f'{key}: missing or stale independent visual approval')
        preview = Image.new('RGBA', (width + 16, height + 16), '#81975b')
        draw = ImageDraw.Draw(preview)
        for x in range(0, preview.width, 8):
            draw.line((x, 0, x, preview.height - 1), fill='#6f8250')
        for y in range(0, preview.height, 8):
            draw.line((0, y, preview.width - 1, y), fill='#6f8250')
        preview.alpha_composite(canvas, (8, 8))
        preview.save(previews / f'{key}-grid.png')
        preview.resize((preview.width * 8, preview.height * 8), Image.Resampling.NEAREST).save(previews / f'{key}-grid-8x.png')
    if require_review and (review.get('key') != contract['key'] or review.get('visualProfile') != contract['visualProfile']):
        errors.append('Visual review belongs to a different family/profile')
    (family / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--family', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--require-complete', action='store_true')
    parser.add_argument('--require-review', action='store_true')
    args = parser.parse_args()
    result = normalize(args.family.resolve(), args.require_complete, args.require_review)
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if result['errors'] else 0)
