"""Source-pinned native event props; extract/scale/quantize, never draw geometry."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'assets/pixel-city-pack'
FAMILY = PACK / 'reference/ai-authored/everyday-city-v1'
PROFILE = 'TASKTOPIA_EVERYDAY_MICRO_V1'
DIRECTIONS = ('north', 'east', 'south', 'west')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def normalize():
    result = []
    for name in ('bus', 'school-bus', 'tow', 'tow-loaded', 'child'):
        source = FAMILY / f'sources/{name}.png'
        raw = Image.open(source).convert('RGBA')
        for index, direction in enumerate(DIRECTIONS):
            col, row = index % 2, index // 2
            crop = (col * raw.width // 2, row * raw.height // 2, (col + 1) * raw.width // 2, (row + 1) * raw.height // 2)
            frame = raw.crop(crop)
            frame.putalpha(frame.getchannel('A').point(lambda value: 255 if value >= 192 else 0))
            # Loaded tow uses the exact empty-state registration frame.
            authority = frame
            if name == 'tow-loaded':
                authority = Image.open(FAMILY / 'sources/tow.png').convert('RGBA').crop(crop)
                authority.putalpha(authority.getchannel('A').point(lambda value: 255 if value >= 192 else 0))
            box = authority.getchannel('A').getbbox()
            if not box:
                raise ValueError(f'Empty {name}:{direction}')
            maximum = (3, 4) if name == 'child' else (4, 6) if direction in ('north', 'south') else (6, 4)
            scale = min(maximum[0] / (box[2] - box[0]), maximum[1] / (box[3] - box[1]))
            size = (max(1, round((box[2] - box[0]) * scale)), max(1, round((box[3] - box[1]) * scale)))
            body = frame.crop(box).resize(size, Image.Resampling.NEAREST)
            native = Image.new('RGBA', (8, 8))
            native.alpha_composite(body, ((8 - size[0]) // 2, (8 - size[1]) // 2))
            opaque = native.getchannel('A')
            rgb = native.convert('RGB').quantize(colors=8, dither=Image.Dither.NONE).convert('RGBA')
            rgb.putalpha(opaque)
            rgb.paste((0, 0, 0, 0), (0, 0, 8, 8), opaque.point(lambda value: 255 - value))
            result.append((name, direction, rgb, {'source': f'sources/{name}.png', 'sourceSha256': sha(source),
                'crop': list(crop), 'commonSourceFrame': list(box), 'scale': scale, 'alphaThreshold': 192, 'paletteLimit': 8}))
    for name, canvas, maximum, colors in [('market-stall', 16, (14, 12), 16), ('umbrella', 8, (6, 6), 8)]:
        source = FAMILY / f'sources/{name}.png'
        raw = Image.open(source).convert('RGBA')
        raw.putalpha(raw.getchannel('A').point(lambda value: 255 if value >= 192 else 0))
        box = raw.getchannel('A').getbbox()
        scale = min(maximum[0] / (box[2] - box[0]), maximum[1] / (box[3] - box[1]))
        size = (max(1, round((box[2] - box[0]) * scale)), max(1, round((box[3] - box[1]) * scale)))
        body = raw.crop(box).resize(size, Image.Resampling.NEAREST)
        native = Image.new('RGBA', (canvas, canvas))
        native.alpha_composite(body, ((canvas - size[0]) // 2, canvas - size[1] if name == 'market-stall' else (canvas - size[1]) // 2))
        alpha = native.getchannel('A')
        image = native.convert('RGB').quantize(colors=colors, dither=Image.Dither.NONE).convert('RGBA')
        image.putalpha(alpha)
        image.paste((0, 0, 0, 0), (0, 0, canvas, canvas), alpha.point(lambda value: 255 - value))
        result.append((name, 'static', image, {'source': f'sources/{name}.png', 'sourceSha256': sha(source),
            'crop': [0, 0, raw.width, raw.height], 'commonSourceFrame': list(box), 'scale': scale, 'alphaThreshold': 192, 'paletteLimit': colors}))
    return result

def build():
    output = FAMILY / 'normalized'
    output.mkdir(exist_ok=True)
    preview = Image.new('RGBA', (64, 96), '#81975b')
    records = []
    for index, (name, direction, image, entry) in enumerate(normalize()):
        key = f'city-event-{name}' if direction == 'static' else f'city-event-{name}-{direction}'
        path = output / f'{key}.png'
        image.save(path, optimize=True)
        entry.update(key=key, direction=direction, path=f'normalized/{key}.png', sha256=sha(path),
                     size=list(image.size), anchorPx=[image.width // 2, image.height], opaqueBounds=list(image.getchannel('A').getbbox()))
        records.append(entry)
        preview.alpha_composite(image, (index % 4 * 16 + (16 - image.width) // 2, index // 4 * 16 + (16 - image.height) // 2))
    (FAMILY / 'normalization.json').write_text(json.dumps({'profile': PROFILE, 'frames': records}, indent=2) + '\n')
    preview.save(FAMILY / 'preview-native.png')
    preview.resize((512, 768), Image.Resampling.NEAREST).save(FAMILY / 'preview-8x.png')

def verify():
    record = json.loads((FAMILY / 'normalization.json').read_text())
    if record['profile'] != PROFILE or len(record['frames']) != 22:
        raise ValueError('Missing authored everyday directions')
    for (name, direction, expected, source), frame in zip(normalize(), record['frames']):
        path = FAMILY / frame['path']
        actual = Image.open(path).convert('RGBA')
        if any(frame.get(key) != value for key, value in source.items()) or frame['sha256'] != sha(path) or actual.tobytes() != expected.tobytes():
            raise ValueError(f'Stale source normalization {name}:{direction}')
        size = (16, 16) if name == 'market-stall' else (8, 8)
        if actual.size != size or set(actual.getchannel('A').getdata()) - {0, 255}:
            raise ValueError(f'Wrong native frame {name}:{direction}')
        box = actual.getchannel('A').getbbox()
        allowed = (2, 2, 6, 6) if name == 'child' else (0, 0, *size) if direction == 'static' else (2, 1, 6, 7) if direction in ('north', 'south') else (1, 2, 7, 6)
        if not box or box[0] < allowed[0] or box[1] < allowed[1] or box[2] > allowed[2] or box[3] > allowed[3]:
            raise ValueError(f'Unsafe physical body envelope {name}:{direction}')
        if len({pixel[:3] for pixel in actual.getdata() if pixel[3]}) > frame['paletteLimit']:
            raise ValueError('Native palette overflow')
    return record

def publish_everyday_city(root, manifest):
    record = verify()
    review = json.loads((FAMILY / 'review.json').read_text())
    if not review.get('reviewed') or review.get('normalizationSha256') != sha(FAMILY / 'normalization.json'):
        raise ValueError('Everyday props require fresh native visual review')
    catalog_path = PACK / 'catalog/ai-authored-props.json'
    catalog = [entry for entry in json.loads(catalog_path.read_text()) if not entry['key'].startswith('city-event-')]
    for frame in record['frames']:
        key = frame['key']; relative = f'props/{key}.png'
        footprint = [dimension // 8 for dimension in frame['size']]
        entry = {'label': key, 'path': relative, 'size': frame['size'], 'footprintCells': footprint, 'anchorPx': frame['anchorPx'],
                 'occupiedSize': [frame['opaqueBounds'][2] - frame['opaqueBounds'][0], frame['opaqueBounds'][3] - frame['opaqueBounds'][1]],
                 'artSource': 'AI_AUTHORED', 'sourceSheet': f"ai-authored/everyday-city-v1/{frame['source']}",
                 'visualProfile': PROFILE, 'direction': frame['direction']}
        manifest['props'][key] = entry
        for base in (PACK / 'runtime', root / 'public/game-assets/v5'):
            target = base / relative; target.parent.mkdir(parents=True, exist_ok=True)
            Image.open(FAMILY / frame['path']).save(target, optimize=True)
        catalog.append({'key': key, 'sheet': entry['sourceSheet'], 'artSource': 'AI_AUTHORED', 'visualProfile': PROFILE,
                        'size': entry['size'], 'footprintCells': footprint})
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')

def audit_runtime(manifest):
    record = verify()
    atlas = manifest['propAtlas']
    atlas_image = Image.open(PACK / 'runtime' / atlas['path']).convert('RGBA')
    for frame in record['frames']:
        key = frame['key']
        entry = manifest['props'][key]
        if entry['visualProfile'] != PROFILE or entry['size'] != frame['size'] or entry['anchorPx'] != frame['anchorPx']:
            raise ValueError(f'Wrong published event geometry {key}')
        expected = Image.open(FAMILY / frame['path']).convert('RGBA')
        for base in (PACK / 'runtime', ROOT / 'public/game-assets/v5'):
            if Image.open(base / entry['path']).convert('RGBA').tobytes() != expected.tobytes():
                raise ValueError(f'Published art diverges from source {key}')
        packed = atlas['frames'][key]
        crop = atlas_image.crop((packed['x'], packed['y'], packed['x'] + packed['width'], packed['y'] + packed['height']))
        if crop.size != expected.size or crop.tobytes() != expected.tobytes():
            raise ValueError(f'Packed atlas diverges from source {key}')
    for name in ('bus', 'school-bus', 'tow', 'tow-loaded', 'child'):
        if len({frame['sha256'] for frame in record['frames'] if frame['key'] in [f'city-event-{name}-{direction}' for direction in DIRECTIONS]}) != 4:
            raise ValueError(f'Four authored views required for {name}')
    return record

if __name__ == '__main__':
    import sys
    if '--verify' in sys.argv:
        verify(); print('Everyday authored native directions/provenance verified.')
    else:
        build()
