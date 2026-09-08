import { describe, expect, it } from "vitest";
import { atlasTerrainTile } from "../src/shared/atlas-scene";
import { overviewTerrainPatches } from "../src/shared/overview-terrain-presentation";

describe("overview material detail without new geography", () => {
  it("uses the same material frequency on country and planet", () => {
    const patches = overviewTerrainPatches("forest", "country", 2, 7, 15);
    expect(patches).toHaveLength(4);
    // A COUNTRY semantic cell is four atlas units; a block glyph is1.45.
    expect(patches.every(patch => patch.size === .5)).toBe(true);
    expect(patches.reduce((area, patch) => area + patch.size ** 2, 0)).toBe(1);
    expect(new Set(patches.map(patch => `${patch.x}:${patch.y}`)).size).toBe(4);
  });

  it("keeps all four edges exactly inherited, including negative macro coordinates", () => {
    for (const level of ["country", "planet"] as const) for (let mask = 0; mask < 16; mask++) {
      const patches = overviewTerrainPatches("coast", level, -2, -3, mask);
      const resolution = 2;
      expect(patches).toHaveLength(resolution ** 2);
      for (const patch of patches) {
        const x = patch.x * resolution, y = patch.y * resolution;
        const expected = (y > 0 || mask & 1 ? 1 : 0) | (x < resolution - 1 || mask & 2 ? 2 : 0)
          | (y < resolution - 1 || mask & 4 ? 4 : 0) | (x > 0 || mask & 8 ? 8 : 0);
        expect(patch.tile).toEqual(atlasTerrainTile("coast", level, -2 * resolution + x, -3 * resolution + y, expected));
        expect(patch.x + patch.size).toBeLessThanOrEqual(1);
        expect(patch.y + patch.size).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never changes terrain family, depends only on the canonical cell and survives reload/order changes", () => {
    for (const kind of ["forest", "river", "mountain", "coast", "grass", "deep_water"] as const) {
      const first = overviewTerrainPatches(kind, "planet", 8, -1, 3);
      overviewTerrainPatches("hill", "planet", -70, 32, 10);
      expect(overviewTerrainPatches(kind, "planet", 8, -1, 3)).toEqual(first);
      expect(first.every(patch => patch.tile.url === `atlas/terrain-v4/planet/${kind}.png`)).toBe(true);
      expect(first).toHaveLength(4); // Explicit bounded work per macro cell.
    }
  });
});
