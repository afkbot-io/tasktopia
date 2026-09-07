import { describe, expect, it } from "vitest";
import type { CountryOverviewCityDto } from "../src/shared/country-overview-contract";
import type { PlanetTerrainCell, ProjectedPlanetCountry } from "../src/shared/planet-atlas";
import type { GridPoint } from "../src/shared/semantic-road";
import type { IntercityRoadRoute } from "../src/server/world/intercity-road-planner";
import { buildCountryGeography, createCountryWorldProjection } from "../src/server/world/country-geography";
import { projectCountryRoads } from "../src/server/world/country-road-projection";

function mapFixture(cells: PlanetTerrainCell[] = [{ id: "macro:0:0", q: 0, r: 0, terrain: "grass" }]) {
  const country: ProjectedPlanetCountry = { id: "country", name: "Country", seed: 424242, worldVersion: 1,
    cityCount: 2, districtCount: 2, buildingCount: 20, unfinishedBuildingCount: 0, progress: 100,
    worldBounds: { minX: 0, minY: 0, maxX: 320, maxY: 160 }, cities: [],
    continent: 0, cells, airports: [], districtIcons: [], center: { x: 0, y: 0 }, color: "green", accent: "green",
  };
  const geography = buildCountryGeography({ countryId: country.id, seed: country.seed,
    macroCells: cells.map(cell => ({ ...cell, ownerCountryId: country.id })) });
  return { geography, projectWorldPoint: createCountryWorldProjection(geography, country) };
}

function city(id: string, sourceBounds: CountryOverviewCityDto["sourceBounds"], atlasCenter: GridPoint) {
  return { id, sourceBounds, atlasCenter, miniature: {
    cellSize: 8, columns: (sourceBounds.maxX - sourceBounds.minX + 1) / 8,
    rows: (sourceBounds.maxY - sourceBounds.minY + 1) / 8, blocks: [], airports: [],
  } };
}
function road(id: string, start: GridPoint, end: GridPoint): IntercityRoadRoute {
  return { id, fromCityId: "a", toCityId: "b", fromNodeId: "a:exit", toNodeId: "b:exit", widthCells: 3,
    geometry: { start, runs: [{ direction: "E", length: end.x - start.x }] } };
}
function riverFixture(detour: boolean) {
  const cells: PlanetTerrainCell[] = [
    { id: "macro:0:0", q: 0, r: 0, terrain: "grass" },
    { id: "macro:1:0", q: 1, r: 0, terrain: "river" },
    { id: "macro:2:0", q: 2, r: 0, terrain: "grass" },
  ];
  if (detour) for (let q = 0; q < 3; q++) cells.push({ id: `macro:${q}:1`, q, r: 1, terrain: "grass" });
  const fixture = mapFixture(cells), start = { x: 8, y: 0 }, end = { x: 312, y: 0 };
  const cities = [city("a", { minX: -8, minY: -16, maxX: 23, maxY: 15 }, fixture.projectWorldPoint(start)!.point),
    city("b", { minX: 296, minY: -16, maxX: 327, maxY: 15 }, fixture.projectWorldPoint(end)!.point)];
  return { ...fixture, cities, routes: [road("accepted-detour", start, end)] };
}

function expectDrySegments(input: ReturnType<typeof mapFixture>, points: GridPoint[]) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    expect(a.x === b.x || a.y === b.y).toBe(true);
    const steps = Math.max(1, Math.ceil((Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * 8));
    for (let step = 0; step <= steps; step++) {
      const x = a.x + (b.x - a.x) * step / steps, y = a.y + (b.y - a.y) * step / steps;
      const column = Math.floor(x / 4), row = Math.floor(y / 4);
      const cell = input.geography.cells.find(candidate => candidate.column === column && candidate.row === row);
      expect(cell?.land).toBe(true);
      expect(["river", "unknown", "deep_water", "shallow_water"]).not.toContain(cell?.terrain);
    }
  }
}

describe("canonical country road cartographic projection", () => {
  it("preserves road identity and exact miniature endpoint coordinates on a short same-macro road", () => {
    const fixture = mapFixture();
    const cities = [city("a", { minX: -24, minY: -16, maxX: 23, maxY: 31 }, { x: 72, y: 44 }),
      city("b", { minX: 80, minY: -16, maxX: 111, maxY: 15 }, { x: 73.2, y: 44.4 })];
    const routes = [road("accepted-world-road", { x: -8, y: 0 }, { x: 96, y: 0 })];
    const original = JSON.stringify({ cities, routes, geography: fixture.geography });
    const result = projectCountryRoads({ ...fixture, cities, routes });
    expect(result.failures).toEqual([]);
    expect(result.routes).toHaveLength(1);
    const projected = result.routes[0]!;
    expect(projected).toMatchObject({ routeId: "accepted-world-road", fromCityId: "a", toCityId: "b", fromNodeId: "a:exit", toNodeId: "b:exit" });
    expect(projected.points[0]!.x).toBeCloseTo(71.28);
    expect(projected.points[0]!.y).toBeCloseTo(43.28);
    expect(projected.points.at(-1)!.x).toBeCloseTo(73.2);
    expect(projected.points.at(-1)!.y).toBeCloseTo(44.4);
    for (let i = 1; i < projected.points.length; i++) {
      const previous = projected.points[i - 1]!, next = projected.points[i]!;
      expect(previous.x === next.x || previous.y === next.y).toBe(true);
    }
    expect(new Set(projected.cellIds).size).toBe(projected.cellIds.length);
    expectDrySegments(fixture, projected.points);
    expect(JSON.stringify({ cities, routes, geography: fixture.geography })).toBe(original);
  });

  it("keeps a same-country-cell connection inside that cell without an artificial centre excursion", () => {
    const fixture = mapFixture();
    const cities = [city("a", { minX: -16, minY: -16, maxX: 15, maxY: 15 }, { x: 72.5, y: 44.5 }),
      city("b", { minX: 64, minY: -16, maxX: 95, maxY: 15 }, { x: 73.5, y: 45.5 })];
    const result = projectCountryRoads({ ...fixture, cities, routes: [road("same-cell", { x: 0, y: 0 }, { x: 80, y: 0 })] });
    expect(result.failures).toEqual([]);
    expect(result.routes[0]!.cellIds).toHaveLength(1);
    expect(result.routes[0]!.points).toEqual([{ x: 72.5, y: 44.5 }, { x: 73.5, y: 44.5 }, { x: 73.5, y: 45.5 }]);
    expectDrySegments(fixture, result.routes[0]!.points);
  });

  it("routes around inherited macro water rather than drawing a chord between discontinuous projections", () => {
    const input = riverFixture(true);
    const result = projectCountryRoads(input);
    expect(result.failures).toEqual([]);
    expect(result.routes).toHaveLength(1);
    const route = result.routes[0]!;
    expect(route.cellIds.some(id => input.geography.cells.find(cell => cell.id === id)!.row >= 11)).toBe(true);
    expectDrySegments(input, route.points);
    const anchorPositions = route.anchorCellIds.map(id => route.cellIds.indexOf(id));
    expect(anchorPositions.every((value, i) => value >= 0 && (i === 0 || value > anchorPositions[i - 1]!))).toBe(true);
    expect(new Set(route.cellIds).size).toBe(route.cellIds.length);
  });

  it("reports separate islands without a road and does not trust a water cell's incorrect land flag", () => {
    const input = riverFixture(false);
    const result = projectCountryRoads(input);
    expect(result.routes).toEqual([]);
    expect(result.failures).toEqual([{ routeId: "accepted-detour", fromCityId: "a", toCityId: "b", reason: "DISCONNECTED_LAND" }]);
    const unknown = { ...input, geography: { ...input.geography, cells: input.geography.cells.map(cell => cell.terrain === "river"
      ? { ...cell, terrain: "unknown" as const, land: true } : cell) } };
    expect(projectCountryRoads(unknown).failures[0]?.reason).toBe("DISCONNECTED_LAND");
  });

  it("does not clamp an exact miniature endpoint into geography or conceal an unavailable projector", () => {
    const input = riverFixture(true);
    const outside = { ...input, cities: input.cities.map(city => city.id === "a" ? { ...city, atlasCenter: { x: -1, y: -1 } } : city) };
    expect(projectCountryRoads(outside).failures[0]?.reason).toBe("ENDPOINT_OFF_LAND");
    expect(projectCountryRoads({ ...input, projectWorldPoint: () => null }).failures[0]?.reason).toBe("UNPROJECTABLE_ANCHOR");
  });

  it("bounds samples, source geometry, search work and output without partial roads", () => {
    const input = riverFixture(true);
    const sampled = projectCountryRoads({ ...input, limits: { maxProjectSamples: 1 } });
    expect(sampled.metrics.projectSamples).toBe(1);
    expect(sampled.routes).toEqual([]);
    expect(sampled.failures[0]?.reason).toBe("TOTAL_BUDGET");
    expect(projectCountryRoads({ ...input, limits: { maxWorldSteps: 10 } }).failures[0]?.reason).toBe("TOTAL_BUDGET");
    const searched = projectCountryRoads({ ...input, limits: { maxTotalVisited: 1 } });
    expect(searched.metrics.visited).toBe(1);
    expect(searched.routes).toEqual([]);
    expect(searched.failures[0]?.reason).toBe("TOTAL_BUDGET");
    expect(projectCountryRoads({ ...input, limits: { maxOutputPoints: 1 } }).failures[0]?.reason).toBe("TOTAL_BUDGET");
  });

  it("is deterministic under permuted city, cell and accepted-route input order", () => {
    const fixture = mapFixture([0, 1, 2].map(q => ({ id: `macro:${q}:0`, q, r: 0, terrain: "grass" })));
    const cities = [8, 160, 312].map((x, i) => city(["a", "b", "c"][i]!,
      { minX: x - 16, minY: -16, maxX: x + 15, maxY: 15 }, fixture.projectWorldPoint({ x, y: 0 })!.point));
    const routes = [road("road-a", { x: 8, y: 0 }, { x: 160, y: 0 }),
      { ...road("road-b", { x: 160, y: 0 }, { x: 312, y: 0 }), fromCityId: "b", toCityId: "c", fromNodeId: "b:exit", toNodeId: "c:exit" }];
    const first = projectCountryRoads({ ...fixture, cities, routes });
    expect(first.routes).toHaveLength(2);
    expect(projectCountryRoads({ ...fixture, geography: { ...fixture.geography, cells: [...fixture.geography.cells].reverse() },
      cities: [...cities].reverse(), routes: [...routes].reverse() })).toEqual(first);
  });

  it("simplifies a projected return to earlier cells without loops or reversing the displayed road", () => {
    const fixture = mapFixture([0, 1, 2].map(q => ({ id: `macro:${q}:0`, q, r: 0, terrain: "grass" })));
    const cities = [0, 80].map((x, i) => city(["a", "b"][i]!,
      { minX: x - 16, minY: -16, maxX: x + 15, maxY: 15 }, fixture.projectWorldPoint({ x, y: 0 })!.point));
    const route = road("winding-world-route", { x: 0, y: 0 }, { x: 80, y: 0 });
    route.geometry.runs = [{ direction: "E", length: 32 }, { direction: "S", length: 32 },
      { direction: "W", length: 16 }, { direction: "S", length: 32 }, { direction: "E", length: 64 }, { direction: "N", length: 64 }];
    const result = projectCountryRoads({ ...fixture, cities, routes: [route] });
    expect(result.failures).toEqual([]);
    const projected = result.routes[0]!;
    expect(new Set(projected.cellIds).size).toBe(projected.cellIds.length);
    expect(projected.points.every((point, index) => !index || point.x >= projected.points[index - 1]!.x)).toBe(true);
    expectDrySegments(fixture, projected.points);
  });

  it("bounds aggregate source-run inspection even when earlier routes cannot be displayed", () => {
    const input = riverFixture(true);
    const routes = Array.from({ length: 100 }, (_, index) => ({ ...input.routes[0]!, id: `source-${String(index).padStart(3, "0")}`,
      geometry: { start: { x: 8, y: 0 }, runs: Array.from({ length: 100 }, () => ({ direction: "E" as const, length: 1 })) } }));
    const result = projectCountryRoads({ ...input, routes, limits: { maxWorldSteps: 100 } });
    expect(result.routes).toEqual([]);
    expect(result.metrics.inputRuns).toBeLessThanOrEqual(100);
    expect(result.metrics.projectSamples).toBe(0);
  });

  it("rejects malformed finite bounds and non-finite miniatures without moving geometry", () => {
    const input = riverFixture(true);
    expect(() => projectCountryRoads({ ...input, geography: { ...input.geography,
      cells: input.geography.cells.map((cell, i) => i === 0 ? { ...cell, x: Infinity } : cell) } })).toThrow(/geography cell/);
    expect(projectCountryRoads({ ...input, cities: input.cities.map((city, i) => i === 0
      ? { ...city, atlasCenter: { x: Infinity, y: 0 } } : city) }).failures[0]?.reason).toBe("INVALID_CITY");
    expect(projectCountryRoads({ ...input, routes: [{ ...input.routes[0]!, geometry: {
      start: { x: 8, y: 0 }, runs: [{ direction: "E", length: 0 }],
    } }] }).failures[0]?.reason).toBe("INVALID_GEOMETRY");
  });
});
