#!/usr/bin/env python3
"""Publish the selected V2 motion, watercraft and V3 cloud art without rebuilding buildings."""
from pathlib import Path
import hashlib
import importlib.util
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'assets/pixel-city-pack'
SOURCE = PACK / 'reference/ai-authored/micro-ambient-v1/sources'

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

micro = module('micro_builder', 'build-micro-ambient.py')
publisher = module('pack_builder', 'build-pixel-city-pack.py')
manifest = json.loads((PACK / 'manifest.json').read_text())
manifest['microAmbient'] = json.loads((PACK / 'micro-ambient-manifest.json').read_text())
source = Image.open(SOURCE / 'boats-v2.png').convert('RGBA')
for index, suffix in enumerate('abcd'):
    col, row = index % 2, index // 2
    crop = source.crop((round(col * source.width / 2), round(row * source.height / 2), round((col+1) * source.width / 2), round((row+1) * source.height / 2)))
    native = micro.normalize(crop, 24, (6, 22))
    vertical = native.crop((8, 0, 16, 24))
    # Source bow faces north; publish exact quarter turns, with no resampling.
    for axis, art in [('vertical', vertical.transpose(Image.Transpose.ROTATE_180)), ('horizontal', vertical.transpose(Image.Transpose.ROTATE_270))]:
        key = f'boat-{axis}-{suffix}'
        entry = dict(manifest['props'][f'boat-{axis}-a'])
        entry.update(path=f'props/{key}.png', sourceSheet='ai-authored/micro-ambient-v1/sources/boats-v2.png',
                     visualProfile='TASKTOPIA_MICRO_WATERCRAFT_V2', label=['Гребная лодка','Рыбацкий катер','Буксир','Парусная лодка'][index])
        bounds = art.getbbox()
        entry['occupiedSize'] = [bounds[2]-bounds[0], bounds[3]-bounds[1]]
        manifest['props'][key] = entry
        publisher.save(art, entry['path'])
source = Image.open(SOURCE / 'clouds-v3.png').convert('RGBA')
for index in range(4):
    col, row = index % 2, index // 2
    cell = source.crop((round(col * source.width / 2), round(row * source.height / 2), round((col+1) * source.width / 2), round((row+1) * source.height / 2)))
    normalized = micro.normalize(cell, 32, (28, 14)).crop((0, 8, 32, 24))
    # Integer enlargement preserves the square authored clusters.
    art = normalized.resize((64, 32), Image.Resampling.NEAREST)
    for base in (PACK / 'runtime', ROOT / 'public/game-assets/v5'):
        path = base / f'atlas/clouds-v3/cloud-topdown-{index+1}.png'
        path.parent.mkdir(parents=True, exist_ok=True)
        art.save(path, optimize=True)
manifest['atlasClouds'] = [f'atlas/clouds-v3/cloud-topdown-{index+1}.png' for index in range(4)]
# Retire only the eight explicitly replaced static animal frames.
for base in (PACK / 'runtime', ROOT / 'public/game-assets/v5'):
    for species in ('fox','deer','rabbit','boar','duck','sheep','dog','cat'):
        (base / f'micro-ambient/micro-animal-{species}-static.png').unlink(missing_ok=True)
catalog_path = PACK / 'catalog/ai-authored-props.json'
catalog = json.loads(catalog_path.read_text())
catalog = [entry for entry in catalog if not entry['key'].startswith('boat-')]
for key, entry in manifest['props'].items():
    if key.startswith('boat-'):
        catalog.append(dict(key=key, sheet=entry['sourceSheet'], artSource='AI_AUTHORED', visualProfile=entry['visualProfile'],
                            size=entry['size'], footprintCells=entry['footprintCells']))
catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n')
publisher.pack_props(manifest)
digest = hashlib.sha256()
for path in sorted((ROOT / 'public/game-assets/v5').rglob('*.png')):
    digest.update(str(path.relative_to(ROOT / 'public/game-assets/v5')).encode())
    digest.update(path.read_bytes())
manifest['assetRevision'] = digest.hexdigest()[:16]
for path in (PACK / 'manifest.json', ROOT / 'public/game-assets/v5/manifest.json'):
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'revision': manifest['assetRevision'], 'motionSprites': len(manifest['microAmbient']['sprites']), 'boats': 8, 'clouds': 4}))
