import { describe, expect, it } from "vitest";
import { findCompactCitySite } from "../src/server/world/compact-city-site";
import { isBuildableTerrain, terrainAt } from "../src/shared/world-terrain";

describe("bounded compact city site search", () => {
  it("preserves the established first-city location before extending the search", () => {
    expect(findCompactCitySite(424242, [])).toEqual({ x: 96, y: -128 });
  });
  it("finds dry land outside the exhausted 16-ring inner search without moving existing cities", () => {
    const occupied = [{ minX: -600, minY: -600, maxX: 600, maxY: 600 }];
    const before = JSON.stringify(occupied);
    const site = findCompactCitySite(424242, occupied);
    expect(site).toBeDefined();
    expect(Math.max(Math.abs(site!.x), Math.abs(site!.y))).toBeGreaterThan(512);
    expect(Math.max(Math.abs(site!.x), Math.abs(site!.y))).toBeLessThanOrEqual(2048);
    expect(JSON.stringify(occupied)).toBe(before);
    for (let y = site!.y - 2; y <= site!.y + 34; y++) for (let x = site!.x - 2; x <= site!.x + 34; x++) {
      expect(isBuildableTerrain(terrainAt(424242, x, y).terrain)).toBe(true);
    }
    expect(findCompactCitySite(424242, occupied)).toEqual(site);
  });
  it("terminates without a speculative road or water crossing when every candidate is occupied", () => {
    expect(findCompactCitySite(424242, [{ minX: -4096, minY: -4096, maxX: 4096, maxY: 4096 }])).toBeUndefined();
  });
});
