import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

// Mutated verifier fixtures never enter the authored pack. Supplying the
// expected normalization isolates registration from the separate source gate.
function verifyRegistration(mode: 'valid' | 'short-east' | 'drift-west') {
  return spawnSync(resolve('.venv-assets/bin/python'), ['-c', `
import hashlib, json, shutil, sys, tempfile
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path('scripts').resolve()))
import everyday_city_art as art
with tempfile.TemporaryDirectory(prefix='everyday-child-registration-') as directory:
    family = Path(directory)
    shutil.copytree(art.FAMILY / 'normalized', family / 'normalized')
    record = json.loads((art.FAMILY / 'normalization.json').read_text())
    expected = []
    for frame in record['frames']:
        path = family / frame['path']
        image = Image.open(path).convert('RGBA')
        if frame['key'] == 'city-event-child-east' and sys.argv[1] == 'short-east':
            # Recompute hashes below so only registration rejects the lost row.
            image.paste((0, 0, 0, 0), (0, 5, 8, 8))
        if frame['key'] == 'city-event-child-west' and sys.argv[1] == 'drift-west':
            shifted = Image.new('RGBA', (8, 8))
            shifted.paste(image, (1, 0)); image = shifted
        image.save(path)
        frame['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        frame['opaqueBounds'] = list(image.getchannel('A').getbbox())
        name = frame['key'].removeprefix('city-event-')
        if frame['direction'] != 'static': name = name.rsplit('-', 1)[0]
        source = {k: frame[k] for k in ['source', 'sourceSha256', 'crop', 'commonSourceFrame', 'scale', 'alphaThreshold', 'paletteLimit']}
        expected.append((name, frame['direction'], image, source))
    (family / 'normalization.json').write_text(json.dumps(record))
    art.FAMILY = family
    art.normalize = lambda: expected
    art.verify()
`, mode], { encoding: 'utf8' });
}

it('принимает одинаковую native регистрацию ребёнка во всех четырёх направлениях', () => {
  const result = verifyRegistration('valid');
  expect(result.stderr).toBe(''); expect(result.status).toBe(0);
});

it.each(['short-east', 'drift-west'] as const)('отклоняет %s даже при согласованных hashes и metadata', mode => {
  const result = verifyRegistration(mode);
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('Unstable child registration');
});
