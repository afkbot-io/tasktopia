import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const python = resolve(".venv-assets/bin/python");

function render(sizes: number[][]) {
  return JSON.parse(execFileSync(python, ["-c", `
import importlib.util, json, sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path('scripts').resolve()))
spec = importlib.util.spec_from_file_location('publisher', 'scripts/build-pixel-city-pack.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
sizes = json.loads(sys.argv[1])
families = [[Image.new('RGBA', size, (20 + row, 40 + stage, 200, 255)) for stage in range(5)] for row, size in enumerate(sizes)]
sheet = publisher.building_contact_sheet(families)
# Distinct solid synthetic masks make every lost/overpainted pixel observable.
# They are test data, not substitute building architecture.
counts = [sum(pixel == image.getpixel((0, 0)) for pixel in sheet.get_flattened_data()) for family in families for image in family]
print(json.dumps({'size': list(sheet.size), 'counts': counts, 'inputs': [[list(im.size) for im in family] for family in families]}))
`, JSON.stringify(sizes)], { encoding: "utf8" }));
}

describe("published building review sheet", () => {
  it("preserves the existing compact sheet canvas and every stage pixel", () => {
    const result = render([[48, 48], [48, 24], [48, 32]]);
    expect(result.size).toEqual([280, 176]);
    expect(result.counts).toEqual([48 * 48, 48 * 24, 48 * 32].flatMap(area => Array(5).fill(area)));
  });

  it("keeps horizontal and vertical long stages intact in mixed rows", () => {
    const sizes = [[96, 48], [48, 24], [48, 96]];
    const result = render(sizes);
    expect(result.counts).toEqual(sizes.flatMap(([width, height]) => Array(5).fill(width! * height!)));
    // 8px top + (48+8) + (48+8) + (96+8), retaining the original minimum row.
    expect(result.size).toEqual([520, 224]);
    expect(result.inputs).toEqual(sizes.map(size => Array(5).fill(size)));
  });
});
