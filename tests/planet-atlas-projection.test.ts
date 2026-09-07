import { describe, expect, it } from "vitest";
import type { PlanetAtlasDto } from "../src/shared/planet-atlas-contract";
import { layoutPlanetCountryLabels, planetHexPath, projectPlanetAtlas, projectPlanetMap, projectProjectedPlanetMap, zoomPlanetCameraAtFocus } from "../src/shared/planet-atlas";
import { planetAtlasCacheKey } from "../src/client/planet-atlas-cache";

const fixture: PlanetAtlasDto = {
  schemaVersion: 4,
  planetSeed: 782_441,
  revision: "planet-fixture",
  countries: [
    { id: "country-a", name: "Атуаленда", seed: 11, worldVersion: 4, cityCount: 1, districtCount: 3, buildingCount: 12, unfinishedBuildingCount: 8, progress: 30, cities:[{id:"a-city",center:{x:0,y:0},districts:[{id:"a-d1",center:{x:-20,y:0}},{id:"a-d2",center:{x:20,y:0}},{id:"a-d3",center:{x:0,y:30}}],airports:[{taskId:"a-airport",center:{x:40,y:40}}]}], worldBounds: { minX: -200, minY: -120, maxX: 240, maxY: 180 } },
    { id: "country-b", name: "Северия", seed: 22, worldVersion: 7, cityCount: 4, districtCount: 12, buildingCount: 80, unfinishedBuildingCount: 14, progress: 65, cities:[{id:"b-city",center:{x:500,y:200},districts:[{id:"b-d1",center:{x:500,y:200}}],airports:[{taskId:"b-airport",center:{x:520,y:240}}]}], worldBounds: { minX: 300, minY: 100, maxX: 700, maxY: 460 } },
    { id: "country-c", name: "Острова", seed: 33, worldVersion: 2, cityCount: 2, districtCount: 6, buildingCount: 25, unfinishedBuildingCount: 2, progress: 90, cities:[{id:"c-city",center:{x:-400,y:400},districts:[{id:"c-d1",center:{x:-400,y:400}}],airports:[]}], worldBounds: { minX: -700, minY: 260, maxX: -320, maxY: 620 } },
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
        ]) if (countryCells.has(cellKey(neighbor))) queue.push(neighbor);
      }
      expect(visited.size).toBe(country.cells.length);
    }
  });

  it("uses disjoint ocean and four-connected continent components shared by neighboring countries", () => {
    for (const planetSeed of [782_441, 73, 424_242]) {
      const atlas = projectPlanetAtlas({ ...fixture, planetSeed, countries: Array.from({ length: 16 }, (_, index) => ({
        ...fixture.countries[index % 3]!, id: `land-${index}`, cities: [],
      })) });
      const land = new Map([...atlas.countries.flatMap(country => country.cells), ...atlas.coastCells].map(cell => [cellKey(cell), cell]));
      for (const cell of atlas.oceanCells) expect(land.has(cellKey(cell))).toBe(false);
      const components = new Map<string, number>();
      let count = 0;
      for (const first of land.values()) {
        if (components.has(cellKey(first))) continue;
        const queue = [first];
        components.set(cellKey(first), count);
        for (let i = 0; i < queue.length; i++) {
          const cell = queue[i]!;
          for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${cell.q + dq!}:${cell.r + dr!}`;
            if (!land.has(key) || components.has(key)) continue;
            components.set(key, count); queue.push(land.get(key)!);
          }
        }
        count++;
      }
      for (const a of atlas.countries) for (const b of atlas.countries) {
        expect(a.continent === b.continent).toBe(components.get(cellKey(a.cells[0]!)) === components.get(cellKey(b.cells[0]!)));
      }
      expect(count).toBeGreaterThan(1);
      expect(count).toBeLessThan(atlas.countries.length);
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
    expect(projected.countries.flatMap(country=>country.districtIcons)).toHaveLength(5);
    expect(projected.countries.flatMap(country=>country.districtIcons).map(icon=>icon.id)).toContain("a-d2");
    expect(projected.clouds.length).toBeGreaterThanOrEqual(12);
    expect(projected.stars.length).toBeGreaterThanOrEqual(40);
    expect(projected.edgeFog.length).toBeGreaterThanOrEqual(40);
    expect(projected.countries.flatMap((country) => country.airports)).toHaveLength(
      fixture.countries.reduce((total, country) => total + country.cities.reduce((sum,city)=>sum+city.airports.length,0), 0),
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
    const withoutAirports = projectPlanetAtlas({ ...fixture, countries: fixture.countries.map((country) => ({ ...country, cities:country.cities.map(city=>({...city,airports:[]})) })) });
    const oneAirport = projectPlanetAtlas({ ...fixture, countries: [{ ...fixture.countries[0]!, cityCount: 1 }] });
    expect(withoutAirports.routes).toEqual([]);
    expect(oneAirport.routes).toEqual([]);
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
    // Raster corners and point anchors each round to an integer pixel.
    expect(Math.abs((firstAirport.center.x-firstCell.center.x)*1.2-(secondAirport.center.x-secondCell.center.x))).toBeLessThanOrEqual(1.5);
    expect(Math.abs((firstAirport.center.y-firstCell.center.y)*1.2-(secondAirport.center.y-secondCell.center.y))).toBeLessThanOrEqual(1.5);
    expect(second.routes.find(route=>route.fromAirportId===secondAirport.id)?.from).toEqual(secondAirport.center);
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

  it("grows the planet aperture with zoom while keeping drag independent", () => {
    const projected = projectPlanetAtlas(fixture);
    const still = projectProjectedPlanetMap(projected, { panX: 0, panY: 0, zoom: 1 });
    const zoomed = projectProjectedPlanetMap(projected, { panX: 0, panY: 0, zoom: 4 });
    const draggedAtZoom = projectProjectedPlanetMap(projected, { panX: .6, panY: -.4, zoom: 4 });
    const width = (map: typeof still) => map.surface.maxX - map.surface.minX;

    expect(width(zoomed)).toBeGreaterThan(width(still));
    expect(draggedAtZoom.surface).toEqual(zoomed.surface);
    expect(draggedAtZoom.countries.map((country) => country.center)).not.toEqual(zoomed.countries.map((country) => country.center));
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
