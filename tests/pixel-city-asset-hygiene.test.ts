import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import buildings from "../assets/pixel-city-pack/catalog/buildings.json";
import authoredProps from "../assets/pixel-city-pack/catalog/ai-authored-props.json";
import { COURTYARD_FURNITURE } from "../src/shared/courtyard-furniture";

const pack = resolve("assets/pixel-city-pack");
const reference = resolve(pack, "reference");

describe("Pixel City source hygiene", () => {
  it("publishes the compact building camera with the accepted ambient contracts", () => {
    expect(buildings.projectionProfile).toBe("TASKTOPIA_COMPACT_CARTOON_HIGH_45_V1");
    expect(authoredProps.filter(prop => prop.key.startsWith("courtyard-")).map(prop => prop.key).sort())
      .toEqual(Object.keys(COURTYARD_FURNITURE).sort());
    for (const prop of authoredProps) {
      if (/^compact-park-(fountain|monument)-stage-[345]$/.test(prop.key)) {
        expect(prop.visualProfile, prop.key).toBe("TASKTOPIA_COMPACT_PARK_HIGH_45_V1");
      } else if (prop.key.startsWith("tree-")) {
        expect(prop.visualProfile, prop.key).toBe("TASKTOPIA_V7_TREE_COMPACT_45_GRID");
      } else if (Object.hasOwn(COURTYARD_FURNITURE, prop.key)) {
        const shape = COURTYARD_FURNITURE[prop.key as keyof typeof COURTYARD_FURNITURE];
        expect(prop.visualProfile, prop.key).toBe("TASKTOPIA_COMPACT_COURTYARD_HIGH_45_V1");
        expect(prop.footprintCells, prop.key).toEqual([shape.width, shape.height]);
        expect(prop.size, prop.key).toEqual([shape.width * 8, shape.height * 8]);
        expect(prop.anchorPx, prop.key).toEqual([shape.width * 4, shape.height * 8]);
        expect(prop.sheet, prop.key).toBe(`ai-authored/compact-courtyard-furniture-v1/sources/${prop.key}.png`);
      } else expect(prop.visualProfile, prop.key).toMatch(/^TASKTOPIA_V[56]_/);
    }
  });

  it("keeps no replaced ambient source beside the catalog-reachable sheets", () => {
    const used = new Set(authoredProps.map((entry) => entry.sheet));
    const ambient = resolve(reference, "ai-authored/ambient");
    const pngs = readdirSync(ambient).filter((name) => name.endsWith(".png"));
    const unreferenced = pngs.filter((name) => !used.has(`ai-authored/ambient/${name}`));
    expect(unreferenced).toEqual([]);
    expect(existsSync(resolve(reference, "rejected"))).toBe(false);
  });

  it("retires legacy studies and keeps source, normalization and approval evidence for the compact family", () => {
    const study = resolve(reference, "ai-authored/building-stage-study");
    expect(existsSync(study)).toBe(false);
    for (const entry of buildings.buildings) {
      const family = resolve(reference, "ai-authored", entry.key);
      for (const path of ["sources", "normalized", "geometry.json", "report.json", "visual-review.json"]) {
        expect(existsSync(resolve(family, path)), `${entry.key}/${path}`).toBe(true);
      }
    }
  });
});
