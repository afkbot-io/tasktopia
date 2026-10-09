"""Normalize the authored cargo family; do not draw or rotate aircraft geometry."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'assets/pixel-city-pack'
FAMILY = PACK / 'reference/ai-authored/cargo-helicopter-v1'
PROFILE = 'TASKTOPIA_CARGO_HELICOPTER_TOPDOWN_V1'
DIRECTIONS = ('north', 'east', 'south', 'west')


def normalize():
    source = FAMILY / 'sources/sheet.png'
    raw = Image.open(source).convert('RGBA')
    frames = []
    for index, direction in enumerate(DIRECTIONS):
        col, row = index % 2, index // 2
        crop = (col * raw.width // 2, row * raw.height // 2,
                (col + 1) * raw.width // 2, (row + 1) * raw.height // 2)
        frame = raw.crop(crop)
        frame.putalpha(frame.getchannel('A').point(lambda value: 255 if value >= 128 else 0))
        box = frame.getchannel('A').getbbox()
        if box is None:
            raise ValueError(f'Empty cargo view: {direction}')
        frames.append((direction, crop, frame, box))
    scale = 24 / max(max(box[2] - box[0], box[3] - box[1]) for _, _, _, box in frames)
    result = []
    for direction, crop, frame, box in frames:
        size = (max(1, round((box[2] - box[0]) * scale)), max(1, round((box[3] - box[1]) * scale)))
        body = frame.crop(box).resize(size, Image.Resampling.NEAREST)
        native = Image.new('RGBA', (32, 32))
        native.alpha_composite(body, ((32 - size[0]) // 2, (32 - size[1]) // 2))
        result.append((direction, crop, box, native))
    contact = Image.new('RGB', (128, 32), '#536366')
    for index, (_, _, _, image) in enumerate(result):
        contact.paste(image, (index * 32, 0), image.getchannel('A'))
    palette = contact.quantize(colors=8, dither=Image.Dither.NONE)
    entries = []
    for direction, crop, box, image in result:
        alpha = image.getchannel('A')
        image = image.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE).convert('RGBA')
        image.putalpha(alpha)
        image.paste((0, 0, 0, 0), (0, 0, 32, 32), alpha.point(lambda value: 255 - value))
        entries.append((direction, crop, box, image))
    record = {'profile': PROFILE, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'alphaThreshold': 128, 'sharedScale': scale, 'paletteLimit': 8, 'frames': []}
    return entries, record


def build():
    entries, record = normalize()
    output = FAMILY / 'normalized'
    output.mkdir(exist_ok=True)
    preview = Image.new('RGBA', (160, 40), '#81975b')
    for index, (direction, crop, box, image) in enumerate(entries):
        name = f'cargo-helicopter-{direction}.png'
        path = output / name
        image.save(path, optimize=True)
        preview.alpha_composite(image, (index * 40 + 4, 4))
        record['frames'].append({'direction': direction, 'crop': list(crop), 'sourceBounds': list(box),
            'path': f'normalized/{name}', 'size': [32, 32], 'anchorPx': [16, 32],
            'opaqueBounds': list(image.getchannel('A').getbbox()), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    (FAMILY / 'normalization.json').write_text(json.dumps(record, indent=2) + '\n')
    preview.save(FAMILY / 'preview-native.png')
    preview.resize((1280, 320), Image.Resampling.NEAREST).save(FAMILY / 'preview-8x.png')


def verify():
    entries, expected = normalize()
    record = json.loads((FAMILY / 'normalization.json').read_text())
    if any(record.get(key) != value for key, value in expected.items() if key != 'frames'):
        raise ValueError('Stale cargo normalization provenance')
    if len(record['frames']) != 4:
        raise ValueError('Four authored directions required')
    for (direction, crop, box, image), entry in zip(entries, record['frames']):
        path = FAMILY / entry['path']
        actual = Image.open(path).convert('RGBA')
        bounds = actual.getchannel('A').getbbox()
        if actual.tobytes() != image.tobytes() or entry['sha256'] != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError(f'Cargo {direction} differs from its authored source')
        if entry['direction'] != direction or entry['crop'] != list(crop) or entry['sourceBounds'] != list(box):
            raise ValueError(f'Cargo {direction} has incorrect source registration')
        if actual.size != (32, 32) or entry['anchorPx'] != [16, 32] or entry['opaqueBounds'] != list(bounds):
            raise ValueError(f'Cargo {direction} has incorrect native registration')
        if bounds[2] - bounds[0] > 24 or bounds[3] - bounds[1] > 24:
            raise ValueError(f'Cargo {direction} exceeds native envelope')
        if any(pixel[3] not in (0, 255) for pixel in actual.getdata()):
            raise ValueError(f'Cargo {direction} has soft alpha')
        if len({pixel[:3] for pixel in actual.getdata() if pixel[3]}) > 8:
            raise ValueError(f'Cargo {direction} exceeds palette budget')
    if len({image.tobytes() for _, _, _, image in entries}) != 4:
        raise ValueError('Cargo directions must be visually distinct')
    return record


def publish_cargo_helicopter(root, manifest):
    record = verify()
    review = json.loads((FAMILY / 'review.json').read_text())
    if not review.get('reviewed') or review.get('sourceSha256') != record['sourceSha256']:
        raise ValueError('Cargo authored family requires visual review')
    catalog_path = PACK / 'catalog/ai-authored-props.json'
    catalog = [entry for entry in json.loads(catalog_path.read_text()) if not entry['key'].startswith('compact-cargo-helicopter-')]
    for frame in record['frames']:
        key = f"compact-cargo-helicopter-{frame['direction']}"
        relative = f'props/{key}.png'
        entry = {'label': key, 'path': relative, 'size': [32, 32], 'footprintCells': [4, 4],
            'anchorPx': [16, 32], 'occupiedSize': [frame['opaqueBounds'][2] - frame['opaqueBounds'][0], frame['opaqueBounds'][3] - frame['opaqueBounds'][1]],
            'artSource': 'AI_AUTHORED', 'sourceSheet': 'ai-authored/cargo-helicopter-v1/sources/sheet.png',
            'visualProfile': PROFILE, 'direction': frame['direction']}
        manifest['props'][key] = entry
        image = Image.open(FAMILY / frame['path'])
        for base in (PACK / 'runtime', root / 'public/game-assets/v5'):
            target = base / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            image.save(target, optimize=True)
        catalog.append({'key': key, 'sheet': entry['sourceSheet'], 'artSource': 'AI_AUTHORED',
                        'visualProfile': PROFILE, 'size': [32, 32], 'footprintCells': [4, 4]})
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    import sys
    if '--verify' in sys.argv:
        verify()
        print('Cargo authored directions/provenance/native envelope verified.')
    else:
        build()
