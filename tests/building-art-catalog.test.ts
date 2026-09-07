import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../assets/pixel-city-pack/catalog/buildings.json";
import manifest from "../assets/pixel-city-pack/manifest.json";
import { COMPACT_BUILDING_SHAPES } from "../src/shared/compact-building-families";

const pack = resolve("assets/pixel-city-pack");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("compact building authoring contract", () => {
  it("publishes distinct compact geometries and rejects restoration of large legacy buildings", () => {
    const keys = catalog.buildings.map(({ key }) => key);
    expect(keys).toEqual(expect.arrayContaining(["compact-apartment-v1", "compact-row-v1", "compact-wide-v1", "compact-long-gallery-v1", "compact-fire-station-v1", "compact-clinic-v1", "compact-roofgarden-v1", "compact-bungalow-v1", "compact-workshop-home-v1", "compact-terrace-v1"]));
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of catalog.buildings) {
      expect(entry.reviewed).toBe(true);
      const approvedSizes = Object.values(COMPACT_BUILDING_SHAPES).map(shape => [shape.width * 8, shape.height * 8]);
      expect(approvedSizes, entry.key).toContainEqual(entry.spriteSize);
      expect(entry.footprintCells).toEqual(entry.spriteSize.map(size => size / 8));
    }
    expect(Object.keys(manifest.buildings)).toEqual(keys);
    const family = (key: string) => catalog.buildings.find(entry => entry.key === key)!;
    expect(family("compact-apartment-v1")).toMatchObject({
      spriteSize: [48, 48], footprintCells: [6, 6], anchorPx: [24, 48],
      entrances: [{ side: "S", offset: 3 }], reviewed: true,
    });
    expect([family("compact-row-v1"), family("compact-wide-v1")].map(({ spriteSize, footprintCells, anchorPx }) => ({ spriteSize, footprintCells, anchorPx }))).toEqual([
      { spriteSize: [48, 24], footprintCells: [6, 3], anchorPx: [24, 24] },
      { spriteSize: [48, 32], footprintCells: [6, 4], anchorPx: [24, 32] },
    ]);
    expect(family("compact-fire-station-v1")).toMatchObject({ serviceRole: "FIRE", spriteSize: [48, 32], footprintCells: [6, 4], anchorPx: [24, 32] });
    expect(family("compact-clinic-v1")).toMatchObject({ serviceRole: "MEDICAL", spriteSize: [48, 32], footprintCells: [6, 4], anchorPx: [24, 32] });
    for (const base of [resolve(pack, "runtime/buildings"), resolve("public/game-assets/v5/buildings")]) {
      const pngs = readdirSync(base, { recursive: true }).filter((path) => String(path).endsWith(".png"));
      expect(pngs).toHaveLength(keys.length * 5);
      expect(pngs.every((path) => keys.some((key) => String(path).includes(`${key}/`)))).toBe(true);
    }
  });

  it.each(catalog.buildings)("keeps three separate source stages and exact accepted runtime bytes: $key", (entry) => {
    const family = resolve(pack, "reference/ai-authored", entry.key);
    expect(entry.stageSources).toHaveLength(3);
    expect(entry.stageSha256).toHaveLength(3);
    expect(new Set(entry.stageSources).size).toBe(3);
    const report = JSON.parse(readFileSync(resolve(family, "report.json"), "utf8"));
    const review = JSON.parse(readFileSync(resolve(family, "visual-review.json"), "utf8"));
    expect(report.errors).toEqual([]);
    const published = manifest.buildings[entry.key as keyof typeof manifest.buildings];
    for (const stage of [3, 4, 5]) {
      const source = resolve(pack, "reference", entry.stageSources[stage - 3]!);
      expect(existsSync(source)).toBe(true);
      expect(sha(source)).toBe(entry.stageSha256[stage - 3]);
      const runtime = resolve(pack, "runtime", published.stages[stage - 1]!);
      const normalized = resolve(family, "normalized", `stage-${stage}.png`);
      expect(sha(runtime)).toBe(sha(normalized));
      expect(report.stages[String(stage)].runtimeSha256).toBe(sha(runtime));
      expect(review.stages[String(stage)]).toMatchObject({ accepted: true, runtimeSha256: sha(runtime) });
    }
  });

  it.each(catalog.buildings)("fixes the roof-dominant camera and common transform: $key", (entry) => {
    const family = resolve(pack, "reference/ai-authored", entry.key);
    const geometry = JSON.parse(readFileSync(resolve(family, "geometry.json"), "utf8"));
    const report = JSON.parse(readFileSync(resolve(family, "report.json"), "utf8"));
    const review = JSON.parse(readFileSync(resolve(family, "visual-review.json"), "utf8"));
    expect(geometry.roofDepthPxRange[0]).toBeGreaterThan(geometry.facadeHeightPxRange[1]);
    expect(geometry.constructionClearanceCells).toBe(1);
    expect(report.commonSourceFrame).toHaveLength(4);
    expect(report.targetSize).toHaveLength(2);
    for (const stage of [3, 4, 5]) {
      const measured = report.stages[String(stage)];
      expect(measured.transparentHolePixels).toBe(0);
      expect(measured.centreDriftPx).toBeLessThanOrEqual(1);
      expect(measured.baselineDriftPx).toBeLessThanOrEqual(1);
      expect(measured.paletteColors).toBeLessThanOrEqual(32);
    }
    expect(review.projection.roofDepthPx).toBeGreaterThan(review.projection.facadeHeightPx);
  });
});
