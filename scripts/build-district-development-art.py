#!/usr/bin/env python3
"""Normalize authored district signs with shared registration; never paint pixels."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'assets/pixel-city-pack'
FAMILY = PACK / 'reference/ai-authored/district-development-v1'

def main():
    output = FAMILY / 'normalized'
    output.mkdir(exist_ok=True)
    reference = Image.open(FAMILY / 'sources/active.png').convert('RGBA')
    bounds = reference.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()
    scale = min(14 / (bounds[2] - bounds[0]), 16 / (bounds[3] - bounds[1]))
    size = (round((bounds[2] - bounds[0]) * scale), round((bounds[3] - bounds[1]) * scale))
    review = {}
    sheet = Image.new('RGBA', (72, 24), '#81975b')
    for i, name in enumerate(('active', 'planned', 'active-frame2')):
        source = FAMILY / f'sources/{name}.png'
        raw = Image.open(source).convert('RGBA')
        assert raw.size == reference.size, 'Source registration changed'
        native = raw.crop(bounds).resize(size, Image.Resampling.NEAREST)
        alpha = native.getchannel('A').point(lambda a: 255 if a >= 128 else 0)
        native = native.convert('RGB').quantize(colors=8, dither=Image.Dither.NONE).convert('RGBA')
        native.putalpha(alpha)
        art = Image.new('RGBA', (16, 16))
        art.alpha_composite(native, ((16 - size[0]) // 2, 16 - size[1]))
        target = output / f'{name}.png'
        art.save(target, optimize=True)
        sheet.alpha_composite(art, (i * 24 + 4, 4))
        review[name] = {'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'runtimeSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                        'sourceFrame': bounds, 'nativeSize': [16, 16], 'anchorPx': [8, 16],
                        'opaqueBounds': art.getchannel('A').getbbox()}
    sheet.resize((720, 240), Image.Resampling.NEAREST).save(FAMILY / 'preview.png')
    (FAMILY / 'normalization.json').write_text(json.dumps(review, indent=2) + '\n')
    if '--publish' not in sys.argv:
        print('Drafts normalized; inspect preview before --publish.')
        return
    spec = importlib.util.spec_from_file_location('publisher', ROOT / 'scripts/build-pixel-city-pack.py')
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
    manifest = json.loads((PACK / 'manifest.json').read_text())
    catalog_path = PACK / 'catalog/ai-authored-props.json'
    catalog = [entry for entry in json.loads(catalog_path.read_text()) if not entry['key'].startswith('district-development-')]
    for name in ('active', 'planned'):
        key = f'district-development-{name}'
        art = Image.open(output / f'{name}.png').convert('RGBA')
        b = art.getchannel('A').getbbox()
        entry = {'label': f'Обозначение района: {name}', 'path': f'props/{key}.png',
                 'size': [16, 16], 'footprintCells': [2, 2], 'anchorPx': [8, 16],
                 'occupiedSize': [b[2] - b[0], b[3] - b[1]], 'artSource': 'AI_AUTHORED',
                 'sourceSheet': f'ai-authored/district-development-v1/sources/{name}.png',
                 'visualProfile': 'TASKTOPIA_V5_STREET_FURNITURE_FRONTAL_TOP'}
        manifest['props'][key] = entry
        publisher.save(art, entry['path'])
        catalog.append(dict(key=key, sheet=entry['sourceSheet'], artSource=entry['artSource'], visualProfile=entry['visualProfile'], size=entry['size'], footprintCells=entry['footprintCells']))
    publisher.pack_props(manifest)
    # Bind only current runtime files; archived revision directories are excluded.
    digest = hashlib.sha256()
    for path in sorted((PACK / 'runtime').rglob('*.png')):
        digest.update(str(path.relative_to(PACK / 'runtime')).encode())
        digest.update(path.read_bytes())
    manifest['assetRevision'] = digest.hexdigest()[:16]
    for path in (PACK / 'manifest.json', ROOT / 'public/game-assets/v5/manifest.json'):
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    print(manifest['assetRevision'])

if __name__ == '__main__':
    main()
