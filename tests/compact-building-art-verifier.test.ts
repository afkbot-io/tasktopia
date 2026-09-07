import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const python = resolve(".venv-assets/bin/python");
const verifier = resolve("scripts/verify-compact-building-art.py");
const acceptedFamily = resolve("assets/pixel-city-pack/reference/ai-authored/compact-apartment-v1");
const temporaryFamilies: string[] = [];

type StageReport = { runtimeSha256: string; sourceSha256: string; occupiedBoundsPx: number[]; foundationMaskMaxDriftPx: number; foundationMaskDifferencePixels: number };
type Report = { errors: string[]; stages: Record<string, StageReport>; commonSourceFrame: number[]; targetSize: number[]; offset: number[] };

function fixture(mode = "valid") {
  const family = mkdtempSync(join(tmpdir(), "tasktopia-compact-verifier-test-"));
  temporaryFamilies.push(family);
  writeFileSync(join(family, "geometry.json"), readFileSync(join(acceptedFamily, "geometry.json")));
  if (mode === "chroma-noise") {
    const contract = JSON.parse(readFileSync(join(family, "geometry.json"), "utf8"));
    contract.sourceBackground = "magenta-chroma-family";
    writeFileSync(join(family, "geometry.json"), JSON.stringify(contract));
  }
  // Synthetic raster test masks, never production art. Stage 3 retains room
  // depth while its roof/parapet is absent; all stages keep one common frame.
  execFileSync(python, ["-c", `
from pathlib import Path
import sys
from PIL import Image, ImageDraw
family, mode = Path(sys.argv[1]), sys.argv[2]
(family / 'sources').mkdir()
for stage, color in ((5, '#97704d'), (4, '#776043'), (3, '#746548')):
    image = Image.new('RGBA', (48, 48), '#ff00ff' if mode == 'chroma-noise' else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((1, 7, 46, 47) if stage == 3 else (0, 3, 47, 47), fill=color)
    if stage == 3 and mode == 'chroma-noise':
        image.putpixel((0, 0), (182, 34, 175, 255))
    if mode == 'chroma-noise':
        draw.rectangle((20, 15, 23, 18), fill=(170, 70, 100, 255))
    if stage == 4 and mode == 'hole':
        draw.rectangle((20, 15, 23, 18), fill=(0, 0, 0, 0))
    if stage == 4 and mode == 'opaque':
        image = Image.new('RGBA', (48, 48), '#778877')
    if stage == 3 and mode == 'mask-drift':
        draw.rectangle((12, 47, 35, 47), fill=(0, 0, 0, 0))
    if stage == 3 and mode == 'canvas':
        image = image.resize((64, 48))
    if stage == 4 and mode == 'duplicate':
        image = Image.open(family / 'sources' / 'stage-5.png')
    if stage != 3 or mode != 'incomplete':
        image.save(family / 'sources' / f'stage-{stage}.png')
`, family, mode]);
  return family;
}

function run(family: string, requireReview = false) {
  const result = spawnSync(python, [verifier, "--family", family, "--require-complete", ...(requireReview ? ["--require-review"] : [])], { encoding: "utf8" });
  if (!result.stdout.trim()) throw new Error(result.stderr || "Verifier returned no report");
  return { status: result.status, report: JSON.parse(result.stdout) as Report };
}

function framedFixture() {
  const family = fixture();
  execFileSync(python, ["-c", `
from PIL import Image
from pathlib import Path
import sys
p = Path(sys.argv[1]) / 'sources'
for stage in (5, 4, 3):
    image = Image.open(p / f'stage-{stage}.png').convert('RGBA').resize((192, 192), Image.Resampling.NEAREST)
    source = Image.new('RGBA', (200, 200))
    source.paste(image, (4, 4))
    source.save(p / f'stage-{stage}.png')
`, family]);
  return family;
}

function reviewedFixture() {
  const family = fixture();
  const measured = run(family);
  expect(measured.status).toBe(0);
  const review = JSON.parse(readFileSync(join(acceptedFamily, "visual-review.json"), "utf8"));
  for (const [stage, report] of Object.entries(measured.report.stages)) {
    review.stages[stage].runtimeSha256 = report.runtimeSha256;
    review.stages[stage].sourceSha256 = report.sourceSha256;
  }
  writeFileSync(join(family, "visual-review.json"), JSON.stringify(review));
  return { family, review };
}

afterEach(() => {
  for (const family of temporaryFamilies.splice(0)) rmSync(family, { recursive: true });
});

describe("compact building art verifier CLI", () => {
  it("uses one explicitly declared outward-background frame for every reverse stage", () => {
    const family = framedFixture();
    const contract = JSON.parse(readFileSync(join(family, "geometry.json"), "utf8"));
    contract.commonSourceFrame = [2, 14, 198, 198];
    writeFileSync(join(family, "geometry.json"), JSON.stringify(contract));
    const { status, report } = run(family);
    expect(status).toBe(0);
    expect(report.commonSourceFrame).toEqual([2, 14, 198, 198]);
    expect(report.targetSize).toEqual([48, 45]);
    expect(report.offset).toEqual([0, 3]);
    expect(Object.keys(report.stages).sort()).toEqual(["3", "4", "5"]);
    for (const stage of Object.values(report.stages)) expect(stage.occupiedBoundsPx[3]).toBe(48);
    expect(report.stages["3"].foundationMaskMaxDriftPx).toBeLessThanOrEqual(1);
  });
  it.each([
    ["opaque crop", [5, 16, 196, 196], "fully contain stage-5 visible bounds"],
    ["fractional coordinate", [2.5, 14, 198, 198], "four safe integer coordinates"],
    ["boolean coordinate", [true, 14, 198, 198], "four safe integer coordinates"],
    ["unsafe integer", [2, 14, 9007199254740992, 198], "four safe integer coordinates"],
    ["wrong length", [2, 14, 198], "four safe integer coordinates"],
    ["per-stage overrides", { 5: [2, 14, 198, 198], 4: [4, 16, 196, 196] }, "four safe integer coordinates"],
    ["explicit null", null, "four safe integer coordinates"],
    ["excess horizontal margin", [0, 16, 196, 196], "each outward margin must be at most 2%"],
    ["excess vertical margin", [4, 12, 196, 196], "each outward margin must be at most 2%"],
    ["outside canvas", [-1, 16, 196, 196], "inside the source canvas"],
    ["empty frame", [4, 16, 4, 196], "inside the source canvas"],
  ])("rejects a declared frame with %s before writing normalized art", (_label, frame, message) => {
    const family = framedFixture();
    const contract = JSON.parse(readFileSync(join(family, "geometry.json"), "utf8"));
    contract.commonSourceFrame = frame;
    writeFileSync(join(family, "geometry.json"), JSON.stringify(contract));
    const result = spawnSync(python, [verifier, "--family", family], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(existsSync(join(family, "normalized/stage-5.png"))).toBe(false);
  });

  it("keeps the reviewed default tight-frame PNG hashes unchanged", () => {
    const family = fixture();
    for (const stage of [3, 4, 5]) copyFileSync(join(acceptedFamily, `sources/stage-${stage}.png`), join(family, `sources/stage-${stage}.png`));
    const { status, report } = run(family);
    expect(status).toBe(0);
    expect(Object.fromEntries(Object.entries(report.stages).map(([stage, value]) => [stage, value.runtimeSha256]))).toEqual({
      3: "edd2b84ec7d82b81b8712326caaa4406bc35aaa04e998afe78e9f00da2a15ad1",
      4: "da475d33b86c1c055fc9be7c7aa2e7ffa74a91823798a6e0978575784bdf3d2a",
      5: "1a6ee9c98df6579161efc19405117515072312256e4ad572d5bc4e259550e4a9",
    });
  });
  it("preserves rare window accents with an explicitly selected coverage palette", () => {
    const family = fixture();
    const copper = resolve("assets/pixel-city-pack/reference/ai-authored/compact-copper-court-v1");
    copyFileSync(join(copper, "geometry.json"), join(family, "geometry.json"));
    for (const stage of [3, 4, 5]) copyFileSync(join(copper, `sources/stage-${stage}.png`), join(family, `sources/stage-${stage}.png`));
    // Diagnostic source fixture, not generated architecture: the real family
    // exposes median-cut merging every teal window into warm facade colors.
    expect(run(family).status).toBe(0);
    const count = Number(execFileSync(python, ["-c", `
from PIL import Image
import sys
im=Image.open(sys.argv[1]).convert('RGBA')
print(sum(1 for r,g,b,a in im.get_flattened_data() if a and b>r*1.3 and g>r*1.3))
`, join(family, "normalized/stage-5.png")], { encoding: "utf8" }));
    expect(count).toBeGreaterThanOrEqual(8);
  });

  it("rejects an unsupported palette algorithm instead of silently changing art", () => {
    const family = fixture();
    const contract = JSON.parse(readFileSync(join(family, "geometry.json"), "utf8"));
    contract.paletteMethod = "UNKNOWN";
    writeFileSync(join(family, "geometry.json"), JSON.stringify(contract));
    const result = spawnSync(python, [verifier, "--family", family], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unsupported paletteMethod");
  });
  it("does not clip long or tall families in grid and stage-sequence previews", () => {
    for (const [width, height] of [[96, 48], [48, 96]]) {
      const family = fixture();
      const contract = JSON.parse(readFileSync(join(family, "geometry.json"), "utf8"));
      Object.assign(contract, { spriteSize: [width, height], anchorPx: [width / 2, height],
        footprintCells: [width / 8, height / 8], foundationMaskRowsPx: [height - 2, height - 1],
        finishedOccupiedWidthPxRange: [width, width], finishedOccupiedHeightPxRange: [height, height],
        stage3OccupiedHeightPxRange: [height, height] });
      writeFileSync(join(family, "geometry.json"), JSON.stringify(contract));
      execFileSync(python, ["-c", `
from pathlib import Path
from PIL import Image
import sys
family, w, h = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
for stage, color in ((5, '#97704d'), (4, '#776043'), (3, '#746548')):
    image = Image.new('RGBA', (w+2, h+2))
    image.paste(color, (1, 1, w+1, h+1))
    image.save(family / 'sources' / f'stage-{stage}.png')
`, family, String(width), String(height)]);
      expect(run(family).status).toBe(0);
      const dimensions = JSON.parse(execFileSync(python, ["-c", `
from PIL import Image
from pathlib import Path
import json,sys
p = Path(sys.argv[1]) / 'previews'
print(json.dumps([Image.open(p / name).size for name in ['stage-5-grid.png','stage-sequence.png']]))
`, family], { encoding: "utf8" }));
      expect(dimensions).toEqual([[Math.max(64, width + 16), Math.max(64, height + 16)],
        [4 + 3 * (width + 4), Math.max(56, height + 8)]]);
    }
  });
  it("does not treat dark magenta background noise as displaced architecture", () => {
    const { status, report } = run(fixture("chroma-noise"));
    expect(status).toBe(0);
    expect(report.commonSourceFrame).toEqual([0, 3, 48, 48]);
    expect(report.stages["3"].occupiedBoundsPx).toEqual([1, 7, 47, 48]);
  });
  it("keeps one source frame and allows the documented one-pixel structural inset", () => {
    const { status, report } = run(fixture());
    expect(status).toBe(0);
    expect(report.errors).toEqual([]);
    expect(report.commonSourceFrame).toEqual([0, 3, 48, 48]);
    expect(report.targetSize).toEqual([48, 45]);
    expect(report.offset).toEqual([0, 3]);
    expect(report.stages["3"].occupiedBoundsPx).toEqual([1, 7, 47, 48]);
    expect(report.stages["3"].foundationMaskDifferencePixels).toBe(4);
    expect(report.stages["3"].foundationMaskMaxDriftPx).toBe(1);
  });

  it.each([
    ["hole", "transparent pixels inside roof/rooms/facade"],
    ["opaque", "opaque source background"],
    ["canvas", "source canvas differs from stage 5"],
    ["duplicate", "Consecutive construction stages must be visually distinct"],
    ["incomplete", "requires all three authored stages"],
    ["mask-drift", "foundation-mask drift"],
  ])("rejects %s independently of the old image-height ratio", (mode, message) => {
    const { status, report } = run(fixture(mode));
    expect(status).toBe(1);
    expect(report.errors.some((error) => error.includes(message))).toBe(true);
  });

  it("requires a hash-pinned review before publication", () => {
    const unreviewed = run(fixture(), true);
    expect(unreviewed.status).toBe(1);
    expect(unreviewed.report.errors).toContain("Semantic visual review is required before publishing");
    const { family } = reviewedFixture();
    expect(run(family, true).status).toBe(0);
  });

  it("rejects review approval when the source or camera assertions are stale", () => {
    const { family, review } = reviewedFixture();
    review.stages["3"].sourceSha256 = "old-source";
    review.projection.roofAndFloorLinesAreAxisAligned = false;
    writeFileSync(join(family, "visual-review.json"), JSON.stringify(review));
    const { status, report } = run(family, true);
    expect(status).toBe(1);
    expect(report.errors.some((error) => error.includes("source review missing or stale"))).toBe(true);
    expect(report.errors.some((error) => error.includes("roofAndFloorLinesAreAxisAligned"))).toBe(true);
  });

  it("rejects an opening-size annotation borrowed from another compact family", () => {
    const { family, review } = reviewedFixture();
    review.projection.doorLeafSizePx = [3, 3];
    writeFileSync(join(family, "visual-review.json"), JSON.stringify(review));
    const { status, report } = run(family, true);
    expect(status).toBe(1);
    expect(report.errors.some((error) => error.includes("doorLeafSizePx differs from immutable family geometry"))).toBe(true);
  });
});
