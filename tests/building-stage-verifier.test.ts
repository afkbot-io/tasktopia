import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const fixture =
  "assets/pixel-city-pack/reference/ai-authored/building-stage-study/highrise-balcony-tower";
const outputDirectories: string[] = [];

afterEach(() => {
  for (const directory of outputDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("building stage verifier", () => {
  it("drops near-transparent generator noise before measuring authored bounds", () => {
    const script = String.raw`
import importlib.util
import sys
from PIL import Image

spec = importlib.util.spec_from_file_location(
    "tasktopia_stage_verifier",
    ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

image = Image.new("RGBA", (3, 1), (0, 0, 0, 0))
image.putpixel((0, 0), (20, 20, 20, 1))
image.putpixel((1, 0), (20, 20, 20, 15))
image.putpixel((2, 0), (20, 20, 20, 16))
cleaned = module.remove_chroma(image)
print([cleaned.getpixel((x, 0))[3] for x in range(3)])
`;

    const stdout = execFileSync(".venv-assets/bin/python", ["-c", script], {
      encoding: "utf8",
    });
    expect(JSON.parse(stdout)).toEqual([0, 0, 255]);
  });

  it("identifies an opaque checkerboard as non-transparent source art", () => {
    const script = String.raw`
import importlib.util
import sys
from PIL import Image

spec = importlib.util.spec_from_file_location(
    "tasktopia_stage_verifier",
    ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

source = Image.new("RGB", (4, 4), (245, 245, 245))
for y in range(4):
    for x in range(4):
        if (x + y) % 2:
            source.putpixel((x, y), (225, 225, 225))
normalized = Image.new("RGBA", (4, 4), (10, 10, 10, 255))
import json
print(json.dumps(module.image_metrics(source, normalized)["sourceHasTransparentPixels"]))
`;

    const stdout = execFileSync(".venv-assets/bin/python", ["-c", script], {
      encoding: "utf8",
    });
    expect(JSON.parse(stdout)).toBe(false);
  });

  it("keeps physical depth, projected depth, foundation and fence clearance independent", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "tasktopia-building-stage-"));
    outputDirectories.push(outputDirectory);

    const args = [
      ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
      "--contract",
      `${fixture}/geometry.json`,
      ...[3, 4, 5].flatMap((stage) => [
        `--stage-${stage}`,
        `${fixture}/sources/stage-${stage}.png`,
      ]),
      "--output-dir",
      outputDirectory,
    ];

    const stdout = execFileSync(".venv-assets/bin/python", args, { encoding: "utf8" });
    expect(JSON.parse(stdout).acceptedByCode).toBe(true);

    const report = JSON.parse(
      readFileSync(join(outputDirectory, "report.json"), "utf8"),
    );
    expect(report.errors).toEqual([]);
    expect(report.geometry).toMatchObject({
      spriteCanvasPx: [144, 280],
      physicalFootprintCells: [18, 16],
      projectedRoofDepthCells: 7,
      foundationTotalHeightPx: 72,
      constructionClearanceCells: 1,
      constructionEnvelopeCells: [20, 18],
      anchorPx: [72, 280],
      doorSizePx: [8, 16],
      doorLeafSizePx: [6, 14],
      doorBottomInsetPx: 0,
      finishedOccupiedWidthPxRange: null,
      finishedOccupiedHeightPxRange: null,
    });
    expect(report.geometry.depthProjectionRatio).toBeCloseTo(0.4375);
    expect(report.stages["1"]).toBeUndefined();
    expect(report.stages["2"]).toBeUndefined();
    expect(report.stages["3"].heightCoverage).toBeGreaterThanOrEqual(0.45);
    expect(report.stages["4"].heightCoverage).toBeGreaterThanOrEqual(0.85);
    expect(report.stages["5"].baselineYPx).toBe(280);
  }, 15_000);
});
