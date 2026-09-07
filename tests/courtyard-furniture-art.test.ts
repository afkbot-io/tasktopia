import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { COURTYARD_FURNITURE } from "../src/shared/courtyard-furniture";
import { PROP_ATLAS, PROP_CATALOG } from "../src/shared/catalog";

const root = fileURLToPath(new URL("../", import.meta.url));
const family = `${root}assets/pixel-city-pack/reference/ai-authored/compact-courtyard-furniture-v1`;
const python = `${root}.venv-assets/bin/python`;
const temporary: string[] = [];
const tempDirectory = () => { const dir = mkdtempSync(`${root}tmp/courtyard-art-test-`); temporary.push(dir); return dir; };
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true }); });

describe("courtyard art source acceptance", () => {
  it("registers all three accepted props in the live catalog, public tree and shared atlas", () => {
    const review = JSON.parse(readFileSync(`${family}/visual-review.json`, "utf8"));
    const manifest = JSON.parse(readFileSync(`${root}assets/pixel-city-pack/manifest.json`, "utf8"));
    for (const [kind, shape] of Object.entries(COURTYARD_FURNITURE)) {
      expect(PROP_CATALOG[kind]?.footprint).toEqual(shape);
      expect(PROP_ATLAS.frames[kind]).toMatchObject({ width: shape.width * 8, height: shape.height * 8 });
      const published = `${root}public/game-assets/v5/${manifest.props[kind].path}`;
      expect(createHash("sha256").update(readFileSync(published)).digest("hex"))
        .toBe(review.objects[kind].runtimeSha256);
    }
    const script = `import json;from PIL import Image;from pathlib import Path
root=Path(${JSON.stringify(root)})
manifest=json.loads((root/'assets/pixel-city-pack/manifest.json').read_text())
atlas=Image.open(root/'public/game-assets/v5'/manifest['propAtlas']['path']).convert('RGBA')
for key in ${JSON.stringify(Object.keys(COURTYARD_FURNITURE))}:
 frame=manifest['propAtlas']['frames'][key]
 native=Image.open(root/'public/game-assets/v5'/manifest['props'][key]['path']).convert('RGBA')
 crop=atlas.crop((frame['x'],frame['y'],frame['x']+frame['width'],frame['y']+frame['height']))
 assert crop.tobytes()==native.tobytes(), key
print('pixel-identical')`;
    expect(execFileSync(python, ["-c", script], { encoding: "utf8" }).trim()).toBe("pixel-identical");
  });
  it.each(["a", "c"])("rejects rack-%s when a top or supporting leg disappears at native size", revision => {
    const draft = tempDirectory();
    cpSync(`${family}/geometry.json`, `${draft}/geometry.json`);
    cpSync(`${family}/sources`, `${draft}/sources`, { recursive: true });
    cpSync(`${root}tests/fixtures/courtyard-art/rack-${revision}-invalid-source.png`, `${draft}/sources/courtyard-cycle-rack.png`);
    const result = spawnSync(python, [`${family}/normalize-verify.py`, "--family", draft, "--require-complete"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(`${draft}/report.json`, "utf8"));
    expect(report.errors).toContain("courtyard-cycle-rack: requires three closed U-hoops with connected tops and both legs");
  });

  it("keeps all three accepted openings with one 4-connected supporting rack", () => {
    const result = execFileSync(python, ["-c", `import sys;sys.path.insert(0,${JSON.stringify(`${root}scripts`)});from PIL import Image;from courtyard_furniture_contract import rack_supports_valid;print(rack_supports_valid(Image.open(${JSON.stringify(`${family}/normalized/courtyard-cycle-rack.png`)})))`], { encoding: "utf8" });
    expect(result.trim()).toBe("True");
  });

  it("publishes only unchanged accepted bytes and matching worker geometry into an isolated pack", () => {
    const fixture = tempDirectory();
    const pack = `${fixture}/assets/pixel-city-pack`;
    const draft = `${pack}/reference/ai-authored/compact-courtyard-furniture-v1`;
    mkdirSync(draft, { recursive: true });
    mkdirSync(`${pack}/catalog`);
    symlinkSync(`${root}scripts`, `${fixture}/scripts`, "dir");
    for (const file of ["geometry.json", "visual-review.json", "normalize-verify.py"]) cpSync(`${family}/${file}`, `${draft}/${file}`);
    cpSync(`${family}/sources`, `${draft}/sources`, { recursive: true });
    cpSync(`${family}/normalized`, `${draft}/normalized`, { recursive: true });
    writeFileSync(`${pack}/catalog/ai-authored-props.json`, "[]");
    const script = `import sys,json;from pathlib import Path;sys.path.insert(0,${JSON.stringify(`${root}scripts`)});from courtyard_furniture_contract import publish_courtyard_furniture;manifest={'props':{}};publish_courtyard_furniture(Path(${JSON.stringify(fixture)}),manifest);print(json.dumps(manifest))`;
    const manifest = JSON.parse(execFileSync(python, ["-c", script], { encoding: "utf8" }));
    const review = JSON.parse(readFileSync(`${family}/visual-review.json`, "utf8"));
    expect(Object.keys(manifest.props).sort()).toEqual(Object.keys(COURTYARD_FURNITURE).sort());
    for (const [kind, shape] of Object.entries(COURTYARD_FURNITURE)) {
      const prop = manifest.props[kind];
      expect(prop.footprintCells).toEqual([shape.width, shape.height]);
      expect(prop.anchorPx).toEqual([shape.width * 4, shape.height * 8]);
      expect(prop.visualProfile).toBe("TASKTOPIA_COMPACT_COURTYARD_HIGH_45_V1");
      for (const prefix of [`${pack}/runtime`, `${fixture}/public/game-assets/v5`]) {
        expect(createHash("sha256").update(readFileSync(`${prefix}/${prop.path}`)).digest("hex"))
          .toBe(review.objects[kind].runtimeSha256);
      }
    }
    // Invalid provenance must fail before copying any runtime asset.
    const unreviewed = JSON.parse(readFileSync(`${draft}/visual-review.json`, "utf8"));
    unreviewed.objects["courtyard-cycle-rack"].runtimeSha256 = "stale";
    writeFileSync(`${draft}/visual-review.json`, JSON.stringify(unreviewed));
    const blockedFixture = `${fixture}/public/game-assets/v5/props/courtyard-cycle-rack.png`;
    rmSync(blockedFixture);
    expect(spawnSync(python, ["-c", script], { encoding: "utf8" }).status).toBe(1);
    expect(existsSync(blockedFixture)).toBe(false);
  });
});
