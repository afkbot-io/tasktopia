import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(".");
const python = resolve(".venv-assets/bin/python");
const authored = "assets/pixel-city-pack/reference/ai-authored";
const temporary: string[] = [];
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const cases = [
  { kind: "building", family: "compact-apartment-v1", section: "stages", target: "5", png: "stage-5.png" },
  { kind: "park", family: "compact-park-monument-v1", section: "stages", target: "5", png: "stage-5.png" },
  { kind: "tree", family: "compact-trees-v7", section: "trees", target: "tree-oak", png: "tree-oak.png" },
  { kind: "courtyard", family: "compact-courtyard-furniture-v1", section: "objects", target: "courtyard-square-planter", png: "courtyard-square-planter.png" },
] as const;
type ArtCase = typeof cases[number];

function fixture(spec: ArtCase) {
  const directory = mkdtempSync(join(tmpdir(), "tasktopia-reviewed-png-"));
  temporary.push(directory);
  const family = join(directory, authored, spec.family);
  mkdirSync(family, { recursive: true });
  mkdirSync(join(directory, "scripts"));
  // Copy entrypoints, never symlink a writable source family into the fixture.
  for (const name of ["verify-compact-building-art.py", "compact_asset_contract.py", "courtyard_furniture_contract.py", "normalize-compact-trees.py", "reviewed_png.py"]) {
    if (existsSync(join(root, "scripts", name))) copyFileSync(join(root, "scripts", name), join(directory, "scripts", name));
  }
  const original = join(root, authored, spec.family);
  for (const name of ["geometry.json", "visual-review.json"]) {
    if (existsSync(join(original, name))) copyFileSync(join(original, name), join(family, name));
  }
  for (const name of ["sources", "normalized"]) {
    if (spec.kind === "tree") {
      mkdirSync(join(family, name));
      copyFileSync(join(original, name, spec.png), join(family, name, spec.png));
    } else cpSync(join(original, name), join(family, name), { recursive: true });
  }
  if (spec.kind === "tree") {
    for (const key of ["compact-row-v1", "compact-wide-v1"]) {
      const target = join(directory, authored, key, "normalized/stage-5.png");
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, authored, key, "normalized/stage-5.png"), target);
    }
  }
  const cli = spec.kind === "building" ? join(directory, "scripts/verify-compact-building-art.py")
    : spec.kind === "tree" ? join(directory, "scripts/normalize-compact-trees.py")
      : join(root, authored, spec.kind === "park" ? "compact-park-fountain-v1" : spec.family, "normalize-verify.py");
  const run = (requireReview = true) => spawnSync(python, [cli, ...(spec.kind === "tree" ? [] : ["--family", family, "--require-complete", ...(requireReview ? ["--require-review"] : [])])], { encoding: "utf8" });
  const png = join(family, "normalized", spec.png);
  const reviewPath = join(family, "visual-review.json");
  const review = JSON.parse(readFileSync(reviewPath, "utf8"));
  return { family, png, reviewPath, review, run };
}

function reencode(path: string, mode = "encoding") {
  // A distinct lossless encoder output models different Pillow/zlib platforms.
  // Pixel/dimension variants are deliberately invalid test artifacts only.
  execFileSync(python, ["-c", `
from PIL import Image
import sys
p, mode = sys.argv[1:]
im = Image.open(p).convert('RGBA')
if mode == 'pixels':
    x, y = next((x,y) for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))[3])
    r,g,b,a = im.getpixel((x,y)); im.putpixel((x,y), (r ^ 1,g,b,a))
elif mode == 'dimensions':
    im = im.crop((0,0,im.width,im.height-1))
elif mode == 'invisible-rgb':
    x, y = next((x,y) for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))[3] == 0)
    im.putpixel((x,y), (1,2,3,0))
im.save(p, compress_level=0)
`, path, mode]);
}

afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true }); });

describe.each(cases)("$kind reviewed PNG normalization", spec => {
  it("preserves hash-pinned canonical encoding when fresh RGBA is exactly equal", () => {
    const f = fixture(spec);
    const original = hash(f.png);
    reencode(f.png);
    const canonical = readFileSync(f.png);
    expect(hash(f.png)).not.toBe(original);
    // Approval belongs to this isolated test artifact, never production review.
    f.review[spec.section][spec.target].runtimeSha256 = hash(f.png);
    writeFileSync(f.reviewPath, JSON.stringify(f.review));
    const result = f.run();
    expect(result.status, result.stderr || JSON.stringify(JSON.parse(result.stdout).errors)).toBe(0);
    expect(readFileSync(f.png).equals(canonical)).toBe(true);
  });

  it.each(["missing", "corrupt"])("rejects a %s canonical file rather than silently repairing it", mode => {
    const f = fixture(spec);
    if (mode === "missing") rmSync(f.png);
    else reencode(f.png); // Same pixels are insufficient without the approved file SHA.
    const before = existsSync(f.png) ? hash(f.png) : null;
    const reviewBefore = readFileSync(f.reviewPath);
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/reviewed canonical PNG (?:is missing|byte SHA)/);
    expect(existsSync(f.png) ? hash(f.png) : null).toBe(before);
    expect(readFileSync(f.reviewPath).equals(reviewBefore)).toBe(true);
  });

  it.each(["pixels", "dimensions", "invisible-rgb"])("requires exact fresh RGBA and dimensions even when canonical %s has a pinned file SHA", mode => {
    const f = fixture(spec);
    reencode(f.png, mode);
    f.review[spec.section][spec.target].runtimeSha256 = hash(f.png);
    writeFileSync(f.reviewPath, JSON.stringify(f.review));
    const before = hash(f.png);
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("fresh normalized pixels or dimensions differ");
    expect(hash(f.png)).toBe(before);
  });

  it("rejects undecodable canonical bytes even if their file SHA was pinned", () => {
    const f = fixture(spec);
    writeFileSync(f.png, "not a PNG: deliberately invalid test artifact");
    f.review[spec.section][spec.target].runtimeSha256 = hash(f.png);
    writeFileSync(f.reviewPath, JSON.stringify(f.review));
    const before = hash(f.png);
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("reviewed canonical PNG cannot be decoded");
    expect(hash(f.png)).toBe(before);
  });

  it("rejects a changed source file even when its decoded pixels are identical", () => {
    const f = fixture(spec);
    const source = join(f.family, "sources", spec.png);
    execFileSync(python, ["-c", `
from PIL import Image, PngImagePlugin
import sys
p=sys.argv[1]; im=Image.open(p).convert('RGBA'); before=im.tobytes()
info=PngImagePlugin.PngInfo(); info.add_text('test-only-source-change','unapproved')
im.save(p,pnginfo=info)
assert Image.open(p).convert('RGBA').tobytes()==before
`, source]);
    const canonicalBefore = hash(f.png);
    expect(hash(source)).not.toBe(f.review[spec.section][spec.target].sourceSha256);
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("source review missing or stale");
    expect(hash(f.png)).toBe(canonicalBefore);
  });

  it("continues to normalize an unapproved draft with no canonical file", () => {
    const f = fixture(spec);
    rmSync(f.reviewPath);
    rmSync(join(f.family, "normalized"), { recursive: true });
    const result = f.run(false);
    expect(result.status, result.stderr || JSON.stringify(JSON.parse(result.stdout).errors)).toBe(0);
    expect(existsSync(f.png)).toBe(true);
  });
});

describe.each(cases.filter(spec => spec.kind === "building" || spec.kind === "park"))("$kind stage identity", spec => {
  it("rejects equal stage pixels despite distinct approved PNG encodings", () => {
    const f = fixture(spec);
    copyFileSync(join(f.family, "sources/stage-5.png"), join(f.family, "sources/stage-4.png"));
    const fourth = join(f.family, "normalized/stage-4.png");
    copyFileSync(f.png, fourth);
    reencode(fourth);
    expect(hash(fourth)).not.toBe(hash(f.png));
    f.review.stages["4"].sourceSha256 = hash(join(f.family, "sources/stage-4.png"));
    f.review.stages["4"].runtimeSha256 = hash(fourth);
    writeFileSync(f.reviewPath, JSON.stringify(f.review));
    const before = hash(fourth);
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/visually distinct|Duplicate normalized stages/);
    expect(hash(fourth)).toBe(before);
  });
});
