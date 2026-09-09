"""Read-only source, registration and native train geometry contract."""
import hashlib
import json
from PIL import Image


def audit_city_transport(manifest, runtime, pack):
    errors = []
    fragment = manifest.get('cityTransport', {})
    if fragment != json.loads((pack / 'city-train-manifest.json').read_text()):
        errors.append('cityTransport: stale central manifest')
    sprites = fragment.get('sprites', {})
    expected = {f'{part}-{direction}' for part in ('locomotive', 'carriage') for direction in ('east', 'north')}
    if set(sprites) != expected:
        errors.append('cityTransport: four authored train headings required')
    for key, entry in sprites.items():
        for root, field, digest in ((runtime, 'path', 'sha256'), (pack, 'source', 'sourceSha256')):
            path = root / entry[field]
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry[digest]:
                errors.append(f'cityTransport/{key}: missing or changed {field}')
        path = runtime / entry['path']
        if not path.is_file():
            continue
        image = Image.open(path).convert('RGBA')
        bounds = image.getbbox()
        if image.size != (24, 24) or entry['size'] != [24, 24] or entry['anchorPx'] != [12, 12] or list(bounds or ()) != entry['opaqueBounds']:
            errors.append(f'cityTransport/{key}: native canvas/anchor/bounds mismatch')
        if bounds:
            width, height = bounds[2]-bounds[0], bounds[3]-bounds[1]
            if (key.endswith('east') and not (16 <= width <= 24 and 3 <= height <= 8)) or (key.endswith('north') and not (16 <= height <= 24 and 3 <= width <= 8)):
                errors.append(f'cityTransport/{key}: wrong heading envelope')
    return errors
