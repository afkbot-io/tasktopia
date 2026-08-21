import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import buildings from "../assets/pixel-city-pack/catalog/buildings.json";
import authoredProps from "../assets/pixel-city-pack/catalog/ai-authored-props.json";
import authoredVehicles from "../assets/pixel-city-pack/catalog/ai-authored-vehicles.json";

const pack = resolve("assets/pixel-city-pack");
const reference = resolve(pack, "reference");

describe("Pixel City source hygiene", () => {
  it("publishes only active V5/V6 visual contracts", () => {
    expect(buildings.projectionProfile).toBe("TASKTOPIA_V5_STRICT_FRONTAL_TOP");
    for (const prop of authoredProps) expect(prop.visualProfile, prop.key).toMatch(/^TASKTOPIA_V[56]_/);
  });

  it("keeps no replaced ambient source beside the catalog-reachable sheets", () => {
    const used = new Set([...authoredProps, ...authoredVehicles].map((entry) => entry.sheet));
    const ambient = resolve(reference, "ai-authored/ambient");
    const pngs = readdirSync(ambient).filter((name) => name.endsWith(".png"));
    const unreferenced = pngs.filter((name) => !used.has(`ai-authored/ambient/${name}`));
    expect(unreferenced).toEqual([]);
    expect(existsSync(resolve(reference, "rejected"))).toBe(false);
  });

  it("keeps only canonical sources, geometry, and projection evidence in each building study", () => {
    const study = resolve(reference, "ai-authored/building-stage-study");
    const unexpected = readdirSync(study).flatMap((family) =>
      readdirSync(resolve(study, family))
        .filter((name) => name !== "sources" && name !== "geometry.json" && name !== "projection-review.json")
        .map((name) => `${family}/${name}`));
    expect(unexpected).toEqual([]);
  });
});
