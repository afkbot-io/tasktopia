import { describe, expect, it } from "vitest";
import { atlasBuildingPresentation } from "../src/client/country-atlas-presentation";

describe("country atlas semantic building presentation", () => {
  it("sizes overview glyphs from the projected footprint instead of the full facade", () => {
    const house = atlasBuildingPresentation("HOUSE", { width: 128, height: 176 }, {
      identity: "task-house-1",
      assetKey: "house-rowhomes",
      projectedFootprint: { width: 7, height: 5 },
    });
    const tower = atlasBuildingPresentation("HIGHRISE", { width: 112, height: 240 }, {
      identity: "task-tower-1",
      assetKey: "highrise-residential-tower",
      projectedFootprint: { width: 5, height: 4 },
    });

    expect(house.width).toBeLessThanOrEqual(12);
    expect(house.height).toBeLessThanOrEqual(13);
    expect(tower.width).toBeLessThanOrEqual(10);
    expect(tower.height).toBeLessThanOrEqual(19);
    expect(house.doorWidth).toBeLessThanOrEqual(2);
    expect(tower.doorWidth).toBeLessThanOrEqual(2);
  });

  it("keeps a coherent overview projection for unusually wide source art", () => {
    const marker = atlasBuildingPresentation("COMMERCIAL", { width: 176, height: 120 }, {
      identity: "task-market",
      assetKey: "commercial-market-stalls",
      projectedFootprint: { width: 14, height: 6 },
    });
    expect(marker.width).toBeLessThanOrEqual(16);
    expect(marker.height).toBeLessThanOrEqual(11);
    expect(marker.sideDepth).toBeLessThanOrEqual(2);
  });

  it("is deterministic while varying massing and muted palettes across atlas buildings", () => {
    const options = {
      assetKey: "house-rowhomes",
      projectedFootprint: { width: 10, height: 6 },
    } as const;
    const first = atlasBuildingPresentation("HOUSE", { width: 96, height: 80 }, { ...options, identity: "task-a" });
    const repeated = atlasBuildingPresentation("HOUSE", { width: 96, height: 80 }, { ...options, identity: "task-a" });
    const neighbour = atlasBuildingPresentation("HOUSE", { width: 96, height: 80 }, { ...options, identity: "task-b" });

    expect(repeated).toEqual(first);
    expect([neighbour.profile, neighbour.facade, neighbour.roof]).not.toEqual([first.profile, first.facade, first.roof]);
    expect(["gable", "flat", "stepped", "courtyard"]).toContain(first.profile);
    expect(first.outline).toBe("#2a4140");
  });
});
