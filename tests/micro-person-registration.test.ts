import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Synthetic rectangles are verifier fixtures, never publishable game art.
function auditFixture(mode: "valid" | "too-small" | "drift") {
  const result = spawnSync(resolve(".venv-assets/bin/python"), ["-c", `
import hashlib, json, shutil, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path('scripts').resolve()))
from micro_ambient_contract import audit_micro_ambient
source = Path('assets/pixel-city-pack').resolve()
manifest = json.loads((source / 'manifest.json').read_text())
with tempfile.TemporaryDirectory(prefix='tasktopia-person-registration-') as directory:
    pack = Path(directory)
    micro = manifest['microAmbient']
    people_family = Path('reference/ai-authored/micro-ambient-v1')
    shutil.copytree(source / people_family, pack / people_family)
    for entry in micro['sources'].values():
        target = pack / entry['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / entry['path'], target)
    review = Path('reference/ai-authored/micro-ambient-v1/visual-review.json')
    (pack / review).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / review, pack / review)
    for key, entry in micro['sprites'].items():
        target = pack / 'runtime' / entry['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / 'runtime' / entry['path'], target)
        if entry['kind'] != 'person':
            continue
        image = Image.new('RGBA', (8, 8))
        bounds = (2, 2, 4, 5)
        if key == 'micro-person-ochre-south':
            if sys.argv[1] == 'too-small': bounds = (2, 2, 4, 3)
            if sys.argv[1] == 'drift': bounds = (2, 3, 4, 6)
        ImageDraw.Draw(image).rectangle(bounds, fill='#d5a548')
        image.save(target)
        entry['opaqueBounds'] = list(image.getchannel('A').getbbox())
        entry['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    print(json.dumps(audit_micro_ambient(manifest, pack / 'runtime', pack)))
`, mode], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout) as string[];
}

describe("native person directional registration gate", () => {
  it("accepts an unchanged full 3×4 body registration across all headings", () => {
    expect(auditFixture("valid")).toEqual([]);
  });

  it.each(["too-small", "drift"] as const)("rejects %s even when hashes and declared bounds agree", (mode) => {
    expect(auditFixture(mode).some((error) => error.includes("person registration"))).toBe(true);
  });
});
