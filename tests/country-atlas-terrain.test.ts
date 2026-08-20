import { describe, expect, it } from "vitest";
import { seededAtlasCutoutTerrain, seededAtlasMacroTerrain } from "../src/shared/country-atlas-terrain";

describe("client-seeded country atlas terrain", () => {
  it("covers the exact atlas bounds with deterministic square macro tiles", () => {
    const bounds = { minX: -2, minY: 3, maxX: 8, maxY: 12 };
    const cities = [
      { sourceCenter: { x: -100, y: 40 }, atlasCenter: { x: 0, y: 5 } },
      { sourceCenter: { x: 180, y: 220 }, atlasCenter: { x: 7, y: 11 } },
    ];
    const first = seededAtlasMacroTerrain(91_573, bounds, cities);
    expect(seededAtlasMacroTerrain(91_573, bounds, cities)).toEqual(first);
    const covered = new Set(first.flatMap((tile) => Array.from({ length: tile.heightCells }, (_, dy) =>
      Array.from({ length: tile.widthCells }, (_unused, dx) => `${tile.atlasOrigin.x + dx}:${tile.atlasOrigin.y + dy}`),
    )).flat());
    expect(covered.size).toBe((bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1));
    expect(first.every((tile) => tile.widthCells <= 4 && tile.heightCells <= 4)).toBe(true);
  });

  it("reconstructs city cutout source cells without a backend terrain payload", () => {
    const cutout = seededAtlasCutoutTerrain(777, {
      sourceCenter: { x: 100, y: 200 },
      atlasCenter: { x: 10, y: 10 },
      scale: 0.5,
      cutoutMask: [{ x: 8, y: 9 }, { x: 9, y: 9 }],
      districts: [{
        id: "district",
        name: "District",
        status: "ACTIVE",
        color: "#fff",
        sourceCenter: { x: 96, y: 198 },
        sourceBounds: { minX: 90, minY: 190, maxX: 105, maxY: 205 },
        atlasCenter: { x: 8, y: 9 },
        atlasCells: [],
        displayCells: [],
      }],
    });
    expect(cutout.map((tile) => tile.sourceCell)).toEqual([{ x: 96, y: 198 }, { x: 98, y: 198 }]);
    expect(cutout.every((tile) => Number.isInteger(tile.variant))).toBe(true);
  });
});
