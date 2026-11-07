"""Source-pinned native transport furniture. No procedural repainting."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FAMILY = ROOT / 'assets/pixel-city-pack/reference/ai-authored/transport-furniture-v1'
PROFILE = 'TASKTOPIA_TRANSPORT_FURNITURE_HIGH_45_V1'
KEYS = ('airport-windsock', 'rail-platform-clock')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(key):
    source = FAMILY / f'sources/{key}.png'
    image = Image.open(source).convert('RGBA')
    image.putalpha(image.getchannel('A').point(lambda value: 255 if value >= 192 else 0))
    box = image.getchannel('A').getbbox()
    if not box:
        raise ValueError(f'Empty source: {key}')
    # Contact registration uses only the unchanged source's bottom two rows.
    # A windsock's cloth is asymmetric; bbox centring would move its mast.
    contact = image.getchannel('A').crop((0, box[3] - 2, image.width, box[3])).getbbox()
    contact_x = (contact[0] + contact[2]) / 2
    scale = min(14 / (box[3] - box[1]), 12 / (box[2] - box[0]))
    size = (max(1, round((box[2] - box[0]) * scale)), max(1, round((box[3] - box[1]) * scale)))
    origin = (round(8 - (contact_x - box[0]) * scale), 16 - size[1])
    if origin[0] < 0 or origin[0] + size[0] > 16:
        raise ValueError(f'Ground registration clips source: {key}')
    native = Image.new('RGBA', (16, 16))
    native.alpha_composite(image.crop(box).resize(size, Image.Resampling.NEAREST), origin)
    alpha = native.getchannel('A')
    result = native.convert('RGB').quantize(colors=8, dither=Image.Dither.NONE).convert('RGBA')
    result.putalpha(alpha)
    result.paste((0, 0, 0, 0), (0, 0, 16, 16), alpha.point(lambda value: 255 - value))
    return result, {'key': key, 'source': f'sources/{key}.png', 'sourceSha256': sha(source),
                    'commonSourceFrame': list(box), 'sourceContactX': contact_x, 'scale': scale,
                    'size': [16, 16], 'footprintCells': [1, 1], 'anchorPx': [8, 16],
                    'alphaThreshold': 192, 'paletteLimit': 8, 'nativeOrigin': list(origin),
                    'opaqueBounds': list(alpha.getbbox())}


def build():
    output = FAMILY / 'normalized'
    output.mkdir(exist_ok=True)
    records = []
    preview = Image.new('RGBA', (64, 32), '#81975b')
    for index, key in enumerate(KEYS):
        image, record = normalize(key)
        path = output / f'{key}.png'
        image.save(path, optimize=True)
        record.update(path=f'normalized/{key}.png', sha256=sha(path))
        records.append(record)
        preview.alpha_composite(image, (index * 32 + 8, 8))
    (FAMILY / 'normalization.json').write_text(json.dumps({'profile': PROFILE, 'frames': records}, indent=2) + '\n')
    preview.save(FAMILY / 'preview-native.png')
    preview.resize((512, 256), Image.Resampling.NEAREST).save(FAMILY / 'preview-8x.png')


def verify():
    record = json.loads((FAMILY / 'normalization.json').read_text())
    if record['profile'] != PROFILE or [frame['key'] for frame in record['frames']] != list(KEYS):
        raise ValueError('Missing native transport furniture')
    for frame in record['frames']:
        key = frame['key']
        expected, provenance = normalize(key)
        path = FAMILY / frame['path']
        actual = Image.open(path).convert('RGBA')
        if any(frame.get(k) != value for k, value in provenance.items()) or frame['sha256'] != sha(path) or actual.tobytes() != expected.tobytes():
            raise ValueError(f'Stale source authority: {key}')
        if actual.size != (16, 16) or set(actual.getchannel('A').getdata()) - {0, 255}:
            raise ValueError(f'Invalid native pixels: {key}')
        contact = actual.getchannel('A').crop((0, 14, 16, 16)).getbbox()
        if not contact or contact[0] < 4 or contact[2] > 12 or abs((contact[0] + contact[2]) / 2 - 8) > 1:
            raise ValueError(f'Contact outside physical cell: {key}')
        if len({pixel[:3] for pixel in actual.getdata() if pixel[3]}) > 8:
            raise ValueError(f'Palette overflow: {key}')
    return record


def publish_transport_furniture(root, manifest):
    record = verify()
    review = json.loads((FAMILY / 'review.json').read_text())
    if not review.get('reviewed') or review.get('normalizationSha256') != sha(FAMILY / 'normalization.json'):
        raise ValueError('Transport furniture requires fresh native visual review')
    pack = root / 'assets/pixel-city-pack'
    catalog_path = pack / 'catalog/ai-authored-props.json'
    catalog = [entry for entry in json.loads(catalog_path.read_text()) if entry['key'] not in KEYS]
    labels = {'airport-windsock': 'Указатель ветра аэродрома', 'rail-platform-clock': 'Часы железнодорожной платформы'}
    for frame in record['frames']:
        key = frame['key']
        path = f'props/{key}.png'
        sheet = f'ai-authored/transport-furniture-v1/{frame["source"]}'
        for base in (pack / 'runtime', root / 'public/game-assets/v5'):
            target = base / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(FAMILY / frame['path'], target)
        entry = {'label': labels[key], 'size': [16, 16], 'footprintCells': [1, 1], 'anchorPx': [8, 16],
                 'artSource': 'AI_AUTHORED', 'visualProfile': PROFILE}
        manifest['props'][key] = dict(entry, path=path, sourceSheet=sheet)
        catalog.append(dict(entry, key=key, sheet=sheet, reviewed=True, sourceSha256=frame['sourceSha256']))
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')


def verify_published():
    record = verify()
    review = json.loads((FAMILY / 'review.json').read_text())
    if not review.get('reviewed') or review.get('normalizationSha256') != sha(FAMILY / 'normalization.json'):
        raise ValueError('Stale transport furniture visual review')
    for base in (ROOT / 'assets/pixel-city-pack/runtime', ROOT / 'public/game-assets/v5'):
        manifest_path = base.parent / 'manifest.json' if base.name == 'runtime' else base / 'manifest.json'
        manifest = json.loads(manifest_path.read_text())
        atlas = Image.open(base / manifest['propAtlas']['path']).convert('RGBA')
        for frame in record['frames']:
            key = frame['key']
            metadata = manifest['props'][key]
            if any(metadata.get(field) != frame[field] for field in ('size', 'footprintCells', 'anchorPx')) or metadata.get('visualProfile') != PROFILE:
                raise ValueError(f'Published furniture geometry drift: {key}')
            if sha(base / metadata['path']) != frame['sha256']:
                raise ValueError(f'Published furniture source drift: {key}')
            packed = manifest['propAtlas']['frames'][key]
            pixels = atlas.crop((packed['x'], packed['y'], packed['x'] + packed['width'], packed['y'] + packed['height']))
            if pixels.tobytes() != Image.open(FAMILY / frame['path']).convert('RGBA').tobytes():
                raise ValueError(f'Published furniture atlas drift: {key}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--published', action='store_true')
    args = parser.parse_args()
    if args.build:
        build()
    if args.published:
        verify_published()
    print(json.dumps(verify(), ensure_ascii=False))
