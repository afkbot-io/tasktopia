import { describe, expect, it } from "vitest";
import type { PlanetAtlasDto } from "../src/shared/planet-atlas-contract";
import { layoutPlanetCountryLabels, planetHexPath, projectPlanetAtlas, projectPlanetMap, projectProjectedPlanetMap, zoomPlanetCameraAtFocus } from "../src/shared/planet-atlas";
import { planetAtlasCacheKey } from "../src/client/planet-atlas-cache";

const fixture: PlanetAtlasDto = {
  schemaVersion: 2,
  planetSeed: 782_441,
  revision: "planet-fixture",
  countries: [
    { id: "country-a", name: "Атуаленда", seed: 11, worldVersion: 4, cityCount: 1, districtCount: 3, buildingCount: 12, unfinishedBuildingCount: 8, progress: 30 },
    { id: "country-b", name: "Северия", seed: 22, worldVersion: 7, cityCount: 4, districtCount: 12, buildingCount: 80, unfinishedBuildingCount: 14, progress: 65 },
    { id: "country-c", name: "Острова", seed: 33, worldVersion: 2, cityCount: 2, districtCount: 6, buildingCount: 25, unfinishedBuildingCount: 2, progress: 90 },
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
      const queue: Array<{ q: number; r: number }> = [country.cells[0]!];
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

  it("builds terrain, fixed airport anchors and airport-only routes", () => {
    const projected = projectPlanetAtlas(fixture);
    const airportIds = new Set(projected.countries.flatMap((country) => country.airports.map((airport) => airport.id)));
    expect(projected.oceanCells.length).toBeGreaterThan(100);
    expect(projected.clouds.length).toBeGreaterThanOrEqual(12);
    expect(projected.stars.length).toBeGreaterThanOrEqual(40);
    expect(projected.edgeFog.length).toBeGreaterThanOrEqual(40);
    expect(projected.countries.flatMap((country) => country.airports)).toHaveLength(
      fixture.countries.reduce((total, country) => total + country.cityCount, 0),
    );
    expect(new Set(projected.countries.flatMap((country) => country.cells.map((cell) => cell.terrain))).size).toBeGreaterThan(3);
    for (const route of projected.routes) {
      if (route.fromAirportId) expect(airportIds.has(route.fromAirportId)).toBe(true);
      expect(airportIds.has(route.toAirportId)).toBe(true);
      expect(route.fromAirportId).not.toBe(route.toAirportId);
      expect(route.path).toMatch(/^M/);
    }
  });

  it("does not create flights when fewer than two airports exist", () => {
    const withoutAirports = projectPlanetAtlas({ ...fixture, countries: fixture.countries.map((country) => ({ ...country, cityCount: 0 })) });
    const oneAirport = projectPlanetAtlas({ ...fixture, countries: [{ ...fixture.countries[0]!, cityCount: 1 }] });
    expect(withoutAirports.routes).toEqual([]);
    expect(oneAirport.routes).toHaveLength(1);
    expect(oneAirport.routes[0]!.fromAirportId).toBeNull();
  });

  it("keeps browser snapshots isolated between accounts", () => {
    expect(planetAtlasCacheKey("user-a")).not.toBe(planetAtlasCacheKey("user-b"));
  });

  it("keeps cell and airport identity stable while the flat map pans", () => {
    const first = projectPlanetMap(fixture, { panX: 0, panY: 0, zoom: 1 });
    const moved = projectPlanetMap(fixture, { panX: .35, panY: -.2, zoom: 1 });
    expect(moved.countries.flatMap((country) => country.cells).map((cell) => cell.id)).toEqual(
      first.countries.flatMap((country) => country.cells).map((cell) => cell.id),
    );
    expect(moved.countries.flatMap((country) => country.airports).map((airport) => airport.cellId)).toEqual(
      first.countries.flatMap((country) => country.airports).map((airport) => airport.cellId),
    );
    expect(moved.countries.map((country) => country.center)).not.toEqual(first.countries.map((country) => country.center));
  });

  it("uses one affine transform for terrain, airports and routes", () => {
    const projected = projectPlanetAtlas(fixture);
    const first = projectProjectedPlanetMap(projected, { panX: 0, panY: 0, zoom: 1 });
    const second = projectProjectedPlanetMap(projected, { panX: .4, panY: .1, zoom: 1.2 });
    const firstAirport = first.countries.flatMap((country) => country.airports)[0]!;
    const secondAirport = second.countries.flatMap((country) => country.airports)[0]!;
    const firstCell = first.countries.flatMap((country) => country.cells).find((cell) => cell.id === firstAirport.cellId)!;
    const secondCell = second.countries.flatMap((country) => country.cells).find((cell) => cell.id === secondAirport.cellId)!;
    expect(firstAirport.center).toEqual(firstCell.center);
    expect(secondAirport.center).toEqual(secondCell.center);
    expect(second.routes.every((route) => route.path.startsWith("M") && route.rotateWithPath)).toBe(true);
  });

  it("keeps the planet surface and edge fog fixed while drag rotates only world content", () => {
    const projected = projectPlanetAtlas(fixture);
    const still = projectProjectedPlanetMap(projected, { panX: 0, panY: 0, zoom: 1 });
    const dragged = projectProjectedPlanetMap(projected, { panX: .45, panY: -.2, zoom: 1 });

    expect(dragged.surface).toEqual(still.surface);
    expect(dragged.edgeFog).toEqual(still.edgeFog);
    expect(dragged.clouds).toEqual(still.clouds);
    expect(dragged.countries.map((country) => country.center)).not.toEqual(still.countries.map((country) => country.center));
  });

  it("projects adjacent terrain cells onto one shared pixel edge without gaps", () => {
    const map = projectPlanetMap(fixture, { panX: .17, panY: -.11, zoom: 2.35 });
    const byGrid = new Map(map.countries.flatMap((country) => country.cells).map((cell) => [`${cell.q}:${cell.r}`, cell]));
    let adjacentPairs = 0;
    for (const cell of byGrid.values()) {
      const right = byGrid.get(`${cell.q + 1}:${cell.r}`);
      if (!right) continue;
      adjacentPairs += 1;
      expect(cell.x + cell.width).toBe(right.x);
    }
    expect(adjacentPairs).toBeGreaterThan(8);
  });

  it("keeps pixel terrain integer-aligned at maximum zoom", () => {
    const map = projectPlanetMap(fixture, { panX: 0, panY: 0, zoom: 5.5 });
    for (const cell of map.countries.flatMap((country) => country.cells)) {
      expect(Number.isInteger(cell.x)).toBe(true);
      expect(Number.isInteger(cell.y)).toBe(true);
      expect(Number.isInteger(cell.size)).toBe(true);
    }
  });

  it("uses square terrain paths and keeps focal world content stable during zoom", () => {
    expect(planetHexPath({ q: 2, r: 3 }, 6)).toBe("M24,36H36V48H24Z");
    const base = projectPlanetAtlas(fixture);
    const focus = { x: 230, y: 510 };
    const before = projectProjectedPlanetMap(base, { panX: .1, panY: -.08, zoom: 1.2 });
    const nextCamera = zoomPlanetCameraAtFocus(base, { panX: .1, panY: -.08, zoom: 1.2 }, 2.4, focus);
    const after = projectProjectedPlanetMap(base, nextCamera);
    const nearestBefore = [...before.countries.flatMap((country) => country.cells)].sort((left, right) => Math.hypot(left.center.x - focus.x, left.center.y - focus.y) - Math.hypot(right.center.x - focus.x, right.center.y - focus.y))[0]!;
    const matchingAfter = after.countries.flatMap((country) => country.cells).find((cell) => cell.id === nearestBefore.id)!;
    expect(Math.hypot(matchingAfter.center.x - focus.x, matchingAfter.center.y - focus.y)).toBeLessThanOrEqual(Math.hypot(nearestBefore.center.x - focus.x, nearestBefore.center.y - focus.y) * 2 + 3);
  });

  it("lays out equal screen-space country labels without collisions", () => {
    const map = projectPlanetMap(fixture, { panX: 0, panY: 0, zoom: 1 });
    const labels = layoutPlanetCountryLabels(map.countries, map.width, map.height);
    expect(new Set(labels.map((label) => label.width))).toEqual(new Set([132]));
    expect(new Set(labels.map((label) => label.height))).toEqual(new Set([34]));
    for (let left = 0; left < labels.length; left += 1) for (let right = left + 1; right < labels.length; right += 1) {
      const a = labels[left]!;
      const b = labels[right]!;
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
  });
});
