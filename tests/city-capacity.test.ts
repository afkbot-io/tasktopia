import { describe, expect, it } from "vitest";
import { CITY_SCENE_MAX_CHUNKS, CITY_SCENE_LEGACY_MAX_CHUNKS, citySceneChunkRange } from "../src/shared/city-capacity";

describe("finite city scene capacity policy", () => {
  it("allows native extents beyond legacy 256 while retaining a finite 4096 budget", () => {
    expect(CITY_SCENE_LEGACY_MAX_CHUNKS).toBe(256);
    expect(CITY_SCENE_MAX_CHUNKS).toBe(4096);
    expect(citySceneChunkRange({ minX: 0, minY: 0, maxX: 256 * 64, maxY: 63 }).count).toBe(257);
    expect(citySceneChunkRange({ minX: 0, minY: 0, maxX: 4095, maxY: 4095 }).count).toBe(CITY_SCENE_MAX_CHUNKS);
    expect(citySceneChunkRange({ minX: 0, minY: 0, maxX: 4096 * 64, maxY: 63 }).count).toBeGreaterThan(CITY_SCENE_MAX_CHUNKS);
  });
  it("uses inclusive floor-aligned chunk bounds for negative coordinates", () => {
    expect(citySceneChunkRange({ minX: -64, minY: -128, maxX: -1, maxY: -65 })).toEqual({
      minChunkX: -1, minChunkY: -2, maxChunkX: -1, maxChunkY: -2, columns: 1, rows: 1, count: 1,
    });
    expect(citySceneChunkRange({ minX: -1, minY: -1, maxX: 0, maxY: 0 }).count).toBe(4);
    expect(citySceneChunkRange({ minX: -8, minY: 0, maxX: 7, maxY: 7 }, 8).count).toBe(2);
  });
  it.each([0, -1, 0.5, NaN, Infinity])("rejects invalid chunk size %s", size => {
    expect(() => citySceneChunkRange({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, size)).toThrow(RangeError);
  });
  it.each([
    { minX: NaN, minY: 0, maxX: 1, maxY: 1 },
    { minX: 0, minY: 0, maxX: Infinity, maxY: 1 },
    { minX: 0.5, minY: 0, maxX: 1, maxY: 1 },
    { minX: 2, minY: 0, maxX: 1, maxY: 1 },
    { minX: 0, minY: 2, maxX: 1, maxY: 1 },
    { minX: -Number.MAX_SAFE_INTEGER, minY: -Number.MAX_SAFE_INTEGER, maxX: Number.MAX_SAFE_INTEGER, maxY: Number.MAX_SAFE_INTEGER },
  ])("rejects malformed or unsafe bounds %j", bounds => {
    expect(() => citySceneChunkRange(bounds)).toThrow(RangeError);
  });
});
