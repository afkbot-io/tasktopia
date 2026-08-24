import { describe, expect, it } from "vitest";
import type { PlanetAtlasDto } from "../src/shared/planet-atlas-contract";
import { projectPlanetAtlas } from "../src/shared/planet-atlas";
import { planetAtlasCacheKey } from "../src/client/planet-atlas-cache";

const fixture: PlanetAtlasDto = {
  schemaVersion: 1,
  planetSeed: 782_441,
  revision: "planet-fixture",
  countries: [
    { id: "country-a", name: "Атуаленда", seed: 11, worldVersion: 4, cityCount: 1, districtCount: 3, buildingCount: 12, progress: 30 },
    { id: "country-b", name: "Северия", seed: 22, worldVersion: 7, cityCount: 4, districtCount: 12, buildingCount: 80, progress: 65 },
    { id: "country-c", name: "Острова", seed: 33, worldVersion: 2, cityCount: 2, districtCount: 6, buildingCount: 25, progress: 90 },
  ],
};

function cellKey(cell: { q: number; r: number }): string {
  return `${cell.q}:${cell.r}`;
}

describe("planet atlas projection", () => {
  it("is deterministic, connected and never assigns one hex to two countries", () => {
    const first = projectPlanetAtlas(fixture);
    const second = projectPlanetAtlas(fixture);
    expect(second).toEqual(first);

    const occupied = new Set<string>();
    for (const country of first.countries) {
      expect(country.cells.length).toBeGreaterThan(0);
      for (const cell of country.cells) {
        expect(occupied.has(cellKey(cell))).toBe(false);
        occupied.add(cellKey(cell));
      }
      const countryCells = new Set(country.cells.map(cellKey));
      const visited = new Set<string>();
      const queue = [country.cells[0]!];
      while (queue.length > 0) {
        const cell = queue.shift()!;
        const key = cellKey(cell);
        if (visited.has(key)) continue;
        visited.add(key);
        for (const neighbor of [
          { q: cell.q + 1, r: cell.r }, { q: cell.q - 1, r: cell.r },
          { q: cell.q, r: cell.r + 1 }, { q: cell.q, r: cell.r - 1 },
          { q: cell.q + 1, r: cell.r - 1 }, { q: cell.q - 1, r: cell.r + 1 },
        ]) if (countryCells.has(cellKey(neighbor))) queue.push(neighbor);
      }
      expect(visited.size).toBe(country.cells.length);
    }
  });

  it("gives a visibly larger territory to a larger country", () => {
    const projected = projectPlanetAtlas(fixture);
    const small = projected.countries.find((country) => country.id === "country-a")!;
    const large = projected.countries.find((country) => country.id === "country-b")!;
    expect(large.cells.length).toBeGreaterThan(small.cells.length);
  });

  it("builds valid inter-country routes, clouds and ocean cells", () => {
    const projected = projectPlanetAtlas(fixture);
    const ids = new Set(projected.countries.map((country) => country.id));
    expect(projected.oceanCells.length).toBeGreaterThan(100);
    expect(projected.clouds.length).toBeGreaterThanOrEqual(6);
    expect(projected.edgeFog).toHaveLength(28);
    expect(projected.routes.length).toBeGreaterThanOrEqual(fixture.countries.length - 1);
    for (const route of projected.routes) {
      expect(ids.has(route.fromCountryId)).toBe(true);
      expect(ids.has(route.toCountryId)).toBe(true);
      expect(route.fromCountryId).not.toBe(route.toCountryId);
      expect(route.path).toMatch(/^M/);
    }
  });

  it("keeps browser snapshots isolated between accounts", () => {
    expect(planetAtlasCacheKey("user-a")).not.toBe(planetAtlasCacheKey("user-b"));
  });
});
