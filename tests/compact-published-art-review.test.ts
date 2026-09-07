import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

function audit(projectionChange: Record<string, unknown>) {
  return JSON.parse(execFileSync(resolve(".venv-assets/bin/python"), ["-c", `
import json, shutil, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path('scripts').resolve()))
from compact_asset_contract import audit_compact_building
source_pack = Path('assets/pixel-city-pack')
catalog = json.loads((source_pack / 'catalog/buildings.json').read_text())
entry = next(e for e in catalog['buildings'] if e['key'] == 'compact-wide-v1')
manifest = json.loads((source_pack / 'manifest.json').read_text())
manifest['buildings'] = {entry['key']: manifest['buildings'][entry['key']]}
with tempfile.TemporaryDirectory(prefix='tasktopia-published-review-test-') as temporary:
    pack = Path(temporary)
    family = pack / 'reference/ai-authored' / entry['key']
    shutil.copytree(source_pack / 'reference/ai-authored' / entry['key'], family)
    (pack / 'catalog').mkdir()
    (pack / 'catalog/buildings.json').write_text(json.dumps({**catalog, 'buildings': [entry]}))
    review_path = family / 'visual-review.json'
    review = json.loads(review_path.read_text())
    review['projection'].update(json.loads(sys.argv[1]))
    review_path.write_text(json.dumps(review))
    print(json.dumps(audit_compact_building(manifest, source_pack / 'runtime', pack)))
`, JSON.stringify(projectionChange)], { encoding: "utf8" })) as string[];
}

describe("published compact art semantic gate", () => {
  it("keeps the park normalizer usable outside the script directory", () => {
    const help = execFileSync(resolve(".venv-assets/bin/python"), [
      resolve("assets/pixel-city-pack/reference/ai-authored/compact-park-fountain-v1/normalize-verify.py"), "--help",
    ], { cwd: tmpdir(), encoding: "utf8" });
    expect(help).toContain("--require-review");
  });
  it("accepts an unchanged reviewed family", () => {
    expect(audit({})).toEqual([]);
  });

  it.each([
    ["doorLeafSizePx", [9, 9]],
    ["doorFrameSizePx", [12, 12]],
    ["primaryRoofIsDominantSurface", false],
    ["roofAndFloorLinesAreAxisAligned", false],
    ["sameCameraAcrossStages", false],
    ["noHeavyBlackBaseline", false],
  ])("rejects contradictory %s review even when source/runtime hashes still match", (field, value) => {
    expect(audit({ [field as string]: value }).some(error => error.includes(field as string))).toBe(true);
  });
});
