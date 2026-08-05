import { describe, expect, it } from "vitest";
import manifest from "../assets/pixel-city-pack-v4/manifest.json";
import { planBlockDistrict } from "../src/server/world/block-planner";
import { rectangleFootprint } from "../src/server/world/grid";

describe("world realism release invariants", () => {
  it("does not publish a curb tile that can leak back into road rendering", () => {
    expect(Object.hasOwn(manifest.tiles, "curb")).toBe(false);
  });

  it("provides ten deterministic district compositions instead of mirrored copies", () => {
    const origin = { x: 20, y: 30 };
    const cells = rectangleFootprint(origin, 48, 32);
    const signatures = Array.from({ length: 10 }, (_, groupOffset) => {
      const plan = planBlockDistrict({
        districtId: "district",
        origin,
        width: 48,
        height: 32,
        cells,
        archetype: "PRIVATE",
        groupOffset,
      });
      return JSON.stringify({
        road: plan.main,
        lots: plan.lots.map((lot) => [lot.origin, lot.width, lot.height, lot.rowIndex]),
        access: plan.lots.map((lot) => lot.sharedAccess),
      });
    });
    expect(new Set(signatures).size).toBe(10);
  });

  it("limits city parking to one generated building per city", () => {
    const parking = manifest.buildings["commercial-parking-lot"];
    expect(parking.maxPerCity).toBe(1);
    expect(parking.maxPerDistrict).toBe(1);
  });
});
