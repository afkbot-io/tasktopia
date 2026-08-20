import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("requires auditable frontal-top projection evidence when requested", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "tasktopia-projection-review-"));
    outputDirectories.push(outputDirectory);
    const reviewPath = join(outputDirectory, "projection-review.json");
    writeFileSync(
      reviewPath,
      JSON.stringify({
        key: "highrise-balcony-tower-study",
        stage: 5,
        facadeVerticals: [
          [[20, 50], [20, 250]],
          [[120, 50], [120, 250]],
        ],
        floorHorizontals: [
          [[20, 200], [120, 200]],
        ],
        topPlanes: [
          {
            name: "main-roof",
            role: "primary-roof",
            backEdge: [[30, 20], [114, 20]],
            frontEdge: [[20, 27], [124, 27]],
          },
        ],
        sideFacadeWidthPx: 2,
        primaryRoofIsDominantSurface: true,
        primaryRoofFrontEdgeMatchesEave: true,
        annotationsMatchVisiblePixels: true,
        sameCameraAcrossStages: true,
      }),
    );

    const stdout = execFileSync(
      ".venv-assets/bin/python",
      [
        ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
        "--contract",
        `${fixture}/geometry.json`,
        ...[3, 4, 5].flatMap((stage) => [
          `--stage-${stage}`,
          `${fixture}/sources/stage-${stage}.png`,
        ]),
        "--output-dir",
        outputDirectory,
        "--projection-review",
        reviewPath,
        "--require-projection-review",
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(stdout).acceptedByCode).toBe(true);
    const report = JSON.parse(readFileSync(join(outputDirectory, "report.json"), "utf8"));
    expect(report.projectionReview.metrics).toMatchObject({
      maxFacadeVerticalDriftPx: 0,
      maxFloorHorizontalDriftPx: 0,
      topPlaneDepthsPx: [7],
      primaryRoofSpansPx: [84],
      minimumPrimaryRoofSpanPx: 72,
      sideFacadeWidthPx: 2,
      maxSideFacadeWidthPx: 12,
    });
    expect(report.projectionReview.visuallyConfirmed).toBe(true);
    expect(report.projectionReview.outputs.overlay4x).toContain("stage-5-projection-4x.png");
  }, 15_000);

  it("rejects a diagonal facade, flat roof evidence, or wide side wall", () => {
    const script = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location(
    "tasktopia_stage_verifier",
    ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
geometry = module.load_geometry(module.Path("${fixture}/geometry.json"))
metrics, errors = module.validate_projection_review({
    "key": "highrise-balcony-tower-study",
    "stage": 5,
    "facadeVerticals": [[[20, 50], [24, 250]], [[120, 50], [120, 250]]],
    "floorHorizontals": [[[20, 200], [120, 205]]],
    "topPlanes": [{"name": "roof", "role": "primary-roof", "backEdge": [[30, 20], [114, 20]], "frontEdge": [[20, 20], [124, 20]]}],
    "sideFacadeWidthPx": 20,
    "annotationsMatchVisiblePixels": True,
    "sameCameraAcrossStages": True,
}, geometry)
print(json.dumps({"metrics": metrics, "errors": errors}))
`;
    const result = JSON.parse(
      execFileSync(".venv-assets/bin/python", ["-c", script], { encoding: "utf8" }),
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("facade vertical drifts 4px"),
        expect.stringContaining("floor edge drifts 5px"),
        expect.stringContaining("visible top-plane depth is 0px"),
        expect.stringContaining("side facade is 20px wide"),
      ]),
    );
  });

  it("does not accept a small canopy as primary-roof evidence", () => {
    const script = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location(
    "tasktopia_stage_verifier",
    ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
geometry = module.load_geometry(module.Path("${fixture}/geometry.json"))
_, errors = module.validate_projection_review({
    "key": "highrise-balcony-tower-study",
    "stage": 5,
    "facadeVerticals": [[[20, 50], [20, 250]], [[120, 50], [120, 250]]],
    "floorHorizontals": [[[20, 200], [120, 200]]],
    "topPlanes": [{"name": "entrance-canopy", "role": "primary-roof", "backEdge": [[66, 220], [74, 220]], "frontEdge": [[66, 224], [74, 224]]}],
    "sideFacadeWidthPx": 0,
    "annotationsMatchVisiblePixels": True,
    "sameCameraAcrossStages": True,
}, geometry)
print(json.dumps(errors))
`;
    const errors = JSON.parse(
      execFileSync(".venv-assets/bin/python", ["-c", script], { encoding: "utf8" }),
    );
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("primary roof evidence is too narrow")]));
  });

  it("rejects a weak primary roof plane that still reads as a flat elevation", () => {
    const script = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location(
    "tasktopia_stage_verifier",
    ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
geometry = module.load_geometry(module.Path("${fixture}/geometry.json"))
_, errors = module.validate_projection_review({
    "key": "highrise-balcony-tower-study",
    "stage": 5,
    "facadeVerticals": [[[20, 30], [20, 250]], [[120, 30], [120, 250]]],
    "floorHorizontals": [[[20, 200], [120, 200]]],
    "topPlanes": [{"name": "main-roof", "role": "primary-roof", "backEdge": [[30, 24], [110, 24]], "frontEdge": [[20, 28], [120, 28]]}],
    "sideFacadeWidthPx": 0,
    "annotationsMatchVisiblePixels": True,
    "sameCameraAcrossStages": True,
}, geometry)
print(json.dumps(errors))
`;
    const errors = JSON.parse(
      execFileSync(".venv-assets/bin/python", ["-c", script], { encoding: "utf8" }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining("primary roof depth is 4px; expected at least 6px")]),
    );
  });

  it("rejects a decorative top strip mislabeled as the main roof", () => {
    const script = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location(
    "tasktopia_stage_verifier",
    ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
geometry = module.load_geometry(module.Path("${fixture}/geometry.json"))
_, errors = module.validate_projection_review({
    "key": "highrise-balcony-tower-study",
    "stage": 5,
    "facadeVerticals": [[[20, 50], [20, 250]], [[120, 50], [120, 250]]],
    "floorHorizontals": [[[20, 200], [120, 200]]],
    "topPlanes": [{"name": "decorative-ridge", "role": "primary-roof", "backEdge": [[30, 12], [110, 12]], "frontEdge": [[20, 20], [120, 20]]}],
    "sideFacadeWidthPx": 0,
    "primaryRoofIsDominantSurface": False,
    "primaryRoofFrontEdgeMatchesEave": False,
    "annotationsMatchVisiblePixels": True,
    "sameCameraAcrossStages": True,
}, geometry)
print(json.dumps(errors))
`;
    const errors = JSON.parse(
      execFileSync(".venv-assets/bin/python", ["-c", script], { encoding: "utf8" }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must trace the dominant roof surface"),
        expect.stringContaining("front edge must trace the facade eave"),
      ]),
    );
  });

  it("requires the main roof evidence to span at least half the building canvas", () => {
    const script = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location(
    "tasktopia_stage_verifier",
    ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
geometry = module.load_geometry(module.Path("${fixture}/geometry.json"))
_, errors = module.validate_projection_review({
    "key": "highrise-balcony-tower-study",
    "stage": 5,
    "facadeVerticals": [[[20, 30], [20, 250]], [[120, 30], [120, 250]]],
    "floorHorizontals": [[[20, 200], [120, 200]]],
    "topPlanes": [{"name": "main-roof", "role": "primary-roof", "backEdge": [[47, 20], [97, 20]], "frontEdge": [[44, 28], [100, 28]]}],
    "sideFacadeWidthPx": 0,
    "primaryRoofIsDominantSurface": True,
    "primaryRoofFrontEdgeMatchesEave": True,
    "annotationsMatchVisiblePixels": True,
    "sameCameraAcrossStages": True,
}, geometry)
print(json.dumps(errors))
`;
    const errors = JSON.parse(
      execFileSync(".venv-assets/bin/python", ["-c", script], { encoding: "utf8" }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining("expected at least 72px")]),
    );
  });

  it("accepts grouped parallel pitched planes as one dominant sawtooth roof", () => {
    const script = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location(
    "tasktopia_stage_verifier",
    ".agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py",
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
geometry = module.load_geometry(module.Path("${fixture}/geometry.json"))
metrics, errors = module.validate_projection_review({
    "key": "highrise-balcony-tower-study",
    "stage": 5,
    "facadeVerticals": [[[20, 50], [20, 250]], [[120, 50], [120, 250]]],
    "floorHorizontals": [[[20, 200], [120, 200]]],
    "topPlanes": [
        {
            "name": "left-sawtooth",
            "role": "primary-roof",
            "primaryRoofGroup": "main-sawtooth",
            "edgeProfile": "parallel-pitched",
            "backEdge": [[20, 20], [70, 35]],
            "frontEdge": [[20, 28], [70, 43]]
        },
        {
            "name": "right-sawtooth",
            "role": "primary-roof",
            "primaryRoofGroup": "main-sawtooth",
            "edgeProfile": "parallel-pitched",
            "backEdge": [[70, 20], [120, 35]],
            "frontEdge": [[70, 28], [120, 43]]
        }
    ],
    "sideFacadeWidthPx": 0,
    "primaryRoofIsDominantSurface": True,
    "primaryRoofFrontEdgeMatchesEave": True,
    "annotationsMatchVisiblePixels": True,
    "sameCameraAcrossStages": True,
}, geometry)
print(json.dumps({"metrics": metrics, "errors": errors}))
`;
    const result = JSON.parse(
      execFileSync(".venv-assets/bin/python", ["-c", script], { encoding: "utf8" }),
    );
    expect(result.errors).toEqual([]);
    expect(result.metrics).toMatchObject({
      primaryRoofCoveragePx: 100,
      minimumPrimaryRoofSpanPx: 72,
    });
  });
});
