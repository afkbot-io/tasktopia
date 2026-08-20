import { describe, expect, it } from "vitest";
import { atlasBuildingPresentation } from "../src/client/country-atlas-presentation";

describe("country atlas semantic building presentation", () => {
  it("keeps buildings readable without loading and shrinking full runtime sprites", () => {
    expect(atlasBuildingPresentation("HOUSE", { width: 128, height: 176 })).toMatchObject({
      width: 18,
      height: 18,
      roofDepth: 4,
      doorWidth: 3,
    });
    expect(atlasBuildingPresentation("HIGHRISE", { width: 112, height: 240 })).toMatchObject({
      width: 14,
      height: 30,
      roofDepth: 4,
      doorWidth: 3,
    });
  });

  it("uses one coherent overview projection for unusually wide source art", () => {
    const marker = atlasBuildingPresentation("COMMERCIAL", { width: 176, height: 120 });
    expect(marker.width).toBeLessThanOrEqual(24);
    expect(marker.height).toBeGreaterThanOrEqual(14);
    expect(marker.sideDepth).toBeLessThanOrEqual(2);
  });
});
