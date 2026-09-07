"""Publish independently authored compact trees with pinned visual acceptance."""
import hashlib
import json
import shutil
import subprocess
import sys

PROFILE = 'TASKTOPIA_V7_TREE_COMPACT_45_GRID'


def publish_compact_trees(root, manifest):
    pack = root / 'assets/pixel-city-pack'
    family = pack / 'reference/ai-authored/compact-trees-v7'
    subprocess.run([sys.executable, str(root / 'scripts/normalize-compact-trees.py')],
                   check=True, stdout=subprocess.DEVNULL)
    report = json.loads((family / 'report.json').read_text())
    review = json.loads((family / 'visual-review.json').read_text())
    keys = {key for key in manifest['props'] if key.startswith('tree-')}
    if keys != set(report['trees']) or keys != set(review['trees']):
        raise ValueError('Every live tree must have its own reviewed compact source')
    catalog_path = pack / 'catalog/ai-authored-props.json'
    catalog = [entry for entry in json.loads(catalog_path.read_text()) if entry['key'] not in keys]
    for key in sorted(keys):
        measured = report['trees'][key]
        approved = review['trees'][key]
        if approved != {field: measured[field] for field in ('sourceSha256', 'runtimeSha256')}:
            raise ValueError(f'Stale visual tree review: {key}')
        source = family / 'normalized' / f'{key}.png'
        if hashlib.sha256(source.read_bytes()).hexdigest() != approved['runtimeSha256']:
            raise ValueError(f'Stale normalized tree: {key}')
        path = f'props/{key}.png'
        sheet = f'ai-authored/compact-trees-v7/sources/{key}.png'
        for base in (pack / 'runtime', root / 'public/game-assets/v5'):
            shutil.copy2(source, base / path)
        label = manifest['props'][key]['label']
        manifest['props'][key] = {
            'label': label, 'path': path, 'size': [16, 16], 'anchorPx': [8, 16],
            'footprintCells': [1, 1], 'visualProfile': PROFILE,
            'artSource': 'AI_AUTHORED', 'sourceSheet': sheet,
        }
        catalog.append({'key': key, 'label': label, 'sheet': sheet, 'size': [16, 16],
            'anchorPx': [8, 16], 'footprintCells': [1, 1], 'visualProfile': PROFILE,
            'reviewed': True, 'sourceSha256': approved['sourceSha256']})
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
