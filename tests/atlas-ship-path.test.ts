import { describe, expect, it } from "vitest";
import { atlasShipPath } from "../src/shared/atlas-ship-path";
import { overviewBuildingArt } from "../src/shared/overview-building-art";

describe("atlas presentation", () => {
  it("grows houses with the map while preserving their native aspect", () => {
    for (const zoom of [.55, 1, 2.6, 8.5]) {
      const art = overviewBuildingArt("city", zoom);
      expect(Math.max(art.width, art.height)).toBeCloseTo(10 * zoom);
      expect(art.width / art.height).toBeCloseTo(art.nativeWidth / art.nativeHeight);
    }
  });
  it("rounds a sea corner locally without moving route endpoints", () => {
    expect(atlasShipPath([{x:0,y:0},{x:20,y:0},{x:20,y:20}]))
      .toBe("M0,0 L17,0 Q20,0 20,3 L20,20");
    expect(atlasShipPath([])).toBe("");
    expect(atlasShipPath([{x:1,y:2},{x:1,y:2}])).not.toContain("NaN");
  });
});
