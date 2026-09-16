import { expect, it } from "vitest";
import { projectForeignSea } from "../src/server/world/country-foreign-rail";
import type { CountryGeography } from "../src/server/world/country-geography";

it("clips a voyage to known water, retains its full-trip phase and protects the hull", () => {
  const geography = { grid: { columns: 12, rows: 5, cellSize: 4, topology: "SQUARE_4" },
    cells: Array.from({ length: 60 }, (_, i) => ({ column: i % 12, row: Math.floor(i / 12), x: i % 12 * 4, y: Math.floor(i / 12) * 4,
      terrain: "deep_water", land: false, macroCellId: `m${Math.floor(i % 12 / 3)}` })) } as unknown as CountryGeography;
  const macro = Array.from({ length: 8 }, (_, q) => ({ id: `m${q}`, q, r: 0 }));
  const points = macro.map(c => ({ x: (c.q + .5) * 8, y: 4 }));
  const route = projectForeignSea(points, macro, geography, 4, true)!;
  expect(route.progressRange).toEqual([0, 3 / 7]);
  for (const p of route.points) {
    expect(p.x).toBeGreaterThanOrEqual(6); expect(p.x).toBeLessThanOrEqual(42);
    expect(p.y).toBeGreaterThanOrEqual(6); expect(p.y).toBeLessThanOrEqual(14);
  }
  const blocked = structuredClone(geography);
  for (const cell of blocked.cells) if (cell.column === 5) cell.terrain = "unknown";
  expect(projectForeignSea(points, macro, blocked, 4, true)?.points.every(p => p.x < 20)).toBe(true);
  expect(projectForeignSea(points, macro, geography, 4, false)).toBeNull();
  expect(projectForeignSea([...points].reverse(), macro, geography, 4, false)?.progressRange).toEqual([4 / 7, 1]);
});

it("projects task-backed planet voyages into the inherited country ocean", async () => {
  const { transportAtlasFixture } = await import("./fixtures/atlas-transport");
  const { projectPlanetAtlas } = await import("../src/shared/planet-atlas");
  const { buildPlanetSeaRoutes } = await import("../src/shared/planet-port-transport");
  const { buildCountryGeography, countryMacroContext } = await import("../src/server/world/country-geography");
  const atlas = projectPlanetAtlas(transportAtlasFixture());
  const routes = buildPlanetSeaRoutes(atlas);
  expect(routes).toHaveLength(1);
  for (const route of routes) for (const countryId of [route.fromCountryId, route.toCountryId]) {
    const geography = buildCountryGeography({ countryId, seed: 1, macroCells: countryMacroContext(atlas, countryId) });
    const segment = projectForeignSea(route.points, atlas.oceanCells.map(c => ({...c,id:`ocean:${c.q}:${c.r}`})), geography, atlas.hexRadius, countryId === route.fromCountryId);
    expect(segment).not.toBeNull();
    for (const point of segment!.points) {
      const column = Math.floor(point.x / 4), row = Math.floor(point.y / 4);
      for (const dx of [-1,0,1]) for (const dy of [-1,0,1]) {
        expect(["deep_water","shallow_water"]).toContain(geography.cells.find(c => c.column === column + dx && c.row === row + dy)?.terrain);
      }
    }
  }
});
