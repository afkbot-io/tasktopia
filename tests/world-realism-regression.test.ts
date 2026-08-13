import { describe, expect, it } from "vitest";
import manifest from "../assets/pixel-city-pack/manifest.json";
import { planComplex } from "../src/server/world/complex-planner";
import { rectangleFootprint } from "../src/server/world/grid";

describe("world realism release invariants", () => {
  it("does not publish a curb tile that can leak back into road rendering", () => {
    expect(Object.hasOwn(manifest.tiles, "curb")).toBe(false);
  });

  it("provides ten deterministic complex compositions instead of mirrored copies", () => {
    const cells = rectangleFootprint({ x: 20, y: 30 }, 48, 32);
    const signatures = Array.from({ length: 10 }, (_, complexIndex) => {
      const plan = planComplex({
        districtId: "district",
        complexIndex,
        rect: { minX: 20, minY: 30, maxX: 67, maxY: 61 },
        cells,
        archetype: "PRIVATE",
        targetLots: 14,
        seed: 4242 + complexIndex * 131,
      });
      return JSON.stringify({
        shape: plan.shape,
        streets: plan.streets,
        lots: plan.lots.map((lot) => [lot.origin, lot.width, lot.height, lot.position]),
        access: plan.courtyard,
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
