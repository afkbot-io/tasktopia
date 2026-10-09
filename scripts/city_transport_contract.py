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
    expected = {f'{part}-{direction}' for part in ('locomotive', 'carriage') for direction in ('east', 'north', 'west', 'south')}
    expected |= {f'ferry-{direction}' for direction in ('east','north','west','south')}
    if set(sprites) != expected:
        errors.append('cityTransport: eight authored train parts and four ferry headings required')
    for key, entry in sprites.items():
        source = pack / entry['source']
        review_path = source.parent / 'visual-review.json'
        review = json.loads(review_path.read_text()) if review_path.is_file() else {}
        accepted = review.get('sprites', {}).get(key, {})
        if not accepted.get('accepted') or accepted.get('runtimeSha256') != entry['sha256'] or accepted.get('sourceSha256') != entry['sourceSha256']:
            errors.append(f'cityTransport/{key}: missing or stale native visual review')
        if source.is_file():
            source_size = Image.open(source).size
            crop = entry.get('sourceRect', [])
            if len(crop) != 4 or not (0 <= crop[0] < crop[2] <= source_size[0] and 0 <= crop[1] < crop[3] <= source_size[1]) or accepted.get('sourceRect') != crop:
                errors.append(f'cityTransport/{key}: invalid authored extraction rectangle')
        for root, field, digest in ((runtime, 'path', 'sha256'), (pack, 'source', 'sourceSha256')):
            path = root / entry[field]
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry[digest]:
                errors.append(f'cityTransport/{key}: missing or changed {field}')
        path = runtime / entry['path']
        if not path.is_file():
            continue
        image = Image.open(path).convert('RGBA')
        bounds = image.getbbox()
        if set(image.getchannel('A').getdata())-set((0,255)) or len({(r,g,b) for r,g,b,a in image.getdata() if a})>8:
            errors.append(f'cityTransport/{key}: hard alpha/eight-color palette required')
        if image.size != (24, 24) or entry['size'] != [24, 24] or entry['anchorPx'] != [12, 12] or list(bounds or ()) != entry['opaqueBounds']:
            errors.append(f'cityTransport/{key}: native canvas/anchor/bounds mismatch')
        if bounds:
            width, height = bounds[2]-bounds[0], bounds[3]-bounds[1]
            minimum,maximum,narrow=(12,16,6) if key.startswith('ferry-') else (16,24,8)
            if (key.endswith(('east','west')) and not (minimum <= width <= maximum and 3 <= height <= narrow)) or (key.endswith(('north','south')) and not (minimum <= height <= maximum and 3 <= width <= narrow)):
                errors.append(f'cityTransport/{key}: wrong heading envelope')
    return errors
