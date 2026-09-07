import { describe, expect, it } from "vitest";
import { createDistrictTerritory } from "../src/client/district-territory";

describe("district interaction uses owned cells across detached blocks", () => {
  const district = [{ x: -2, y: 0 }, { x: -1, y: 0 }, { x: 9, y: 0 }, { x: 10, y: 0 }];
  it("does not hit a foreign block, a street or a flag outside the owned cells", () => {
    const territory = createDistrictTerritory(district, 8);
    expect(territory.contains(-16, 0)).toBe(true);
    expect(territory.contains(-.01, 7.99)).toBe(true);
    expect(territory.contains(72, 0)).toBe(true);
    for (const [x, y] of [[0, 0], [40, 4], [88, 0], [-16, -.01], [80, 8]]) {
      expect(territory.contains(x!, y!)).toBe(false);
      expect(territory.anchorAt(x!, y!)).toBeUndefined();
    }
  });
  it("anchors the tooltip at the hovered detached block, never the first distant block", () => {
    const territory = createDistrictTerritory(district, 8);
    expect(territory.anchorAt(83, 3)).toEqual({ x: 10, y: 0 });
    expect(territory.anchorAt(-6, 2)).toEqual({ x: -1, y: 0 });
    expect(createDistrictTerritory([...district].reverse(), 8).anchorAt(83, 3)).toEqual({ x: 10, y: 0 });
  });
  it("has no phantom target for an empty district", () => {
    expect(createDistrictTerritory([], 8).contains(0, 0)).toBe(false);
    expect(createDistrictTerritory([], 8).anchorAt(0, 0)).toBeUndefined();
  });
});
