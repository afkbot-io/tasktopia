import { describe, expect, it } from "vitest";
import { buildCountryGeography, countryMacroContext, createCountryWorldProjection } from "../src/server/world/country-geography";
import { projectPlanetAtlas, projectPlanetWorldPoint } from "../src/shared/planet-atlas";
import { PLANET_ATLAS_SCHEMA_VERSION } from "../src/shared/planet-atlas-contract";

describe("canonical country settlement projection", () => {
  const country = { id: "country", name: "Country", seed: 42, worldVersion: 1,
    cityCount: 3, districtCount: 3, buildingCount: 30, unfinishedBuildingCount: 0, progress: 100,
    worldBounds: { minX: -100, minY: -100, maxX: 200, maxY: 200 }, cities: [],
  };
  it("maps the same world point to the same owned macrocell and subcell position on both levels", () => {
    const atlas = projectPlanetAtlas({ schemaVersion: PLANET_ATLAS_SCHEMA_VERSION, planetSeed: 73, revision: "canonical", countries: [country] });
    const projected = atlas.countries[0]!;
    const geography = buildCountryGeography({ countryId: country.id, seed: country.seed, macroCells: countryMacroContext(atlas, country.id) });
    const project = createCountryWorldProjection(geography, projected);
    for (const source of [{ x: 0, y: 0 }, { x: -100, y: 150 }, { x: 175, y: 15 }]) {
      const planet = projectPlanetWorldPoint(projected, source, projected.cells, .5);
      const local = project(source)!;
      expect(local.macroCellId).toBe(planet.cell.id);
      expect(local.macro).toEqual({ q: planet.cell.q, r: planet.cell.r });
      const macroCells = geography.cells.filter(cell => cell.macroCellId === local.macroCellId);
      const left = Math.min(...macroCells.map(cell => cell.x));
      const right = Math.max(...macroCells.map(cell => cell.x)) + 4;
      const top = Math.min(...macroCells.map(cell => cell.y));
      const bottom = Math.max(...macroCells.map(cell => cell.y)) + 4;
      expect((local.point.x - left) / (right - left)).toBeCloseTo(planet.point.x - planet.cell.q);
      expect((local.point.y - top) / (bottom - top)).toBeCloseTo(planet.point.y - planet.cell.r);
      expect(macroCells.every(cell => cell.selected && cell.land)).toBe(true);
    }
  });

  it("has no arbitrary city-bbox or other-city ordering dependency", () => {
    const atlas = projectPlanetAtlas({ schemaVersion: PLANET_ATLAS_SCHEMA_VERSION, planetSeed: 73, revision: "canonical", countries: [country] });
    const projected = atlas.countries[0]!;
    const geography = buildCountryGeography({ countryId: country.id, seed: country.seed, macroCells: countryMacroContext(atlas, country.id) });
    const project = createCountryWorldProjection(geography, projected);
    const first = project({ x: 10, y: 20 });
    project({ x: 190, y: 190 }); project({ x: -90, y: -90 });
    expect(project({ x: 10, y: 20 })).toEqual(first);
    expect(createCountryWorldProjection({ ...geography, cells: [] }, projected)({ x: 0, y: 0 })).toBeNull();
  });

  it("does not collapse distinct city anchors at a coarse territory edge", () => {
    const atlas = projectPlanetAtlas({ schemaVersion: PLANET_ATLAS_SCHEMA_VERSION, planetSeed: 73, revision: "large",
      countries: [{ ...country, cityCount: 100, worldBounds: { minX: -600, minY: -600, maxX: 600, maxY: 600 } }],
    });
    const projected = atlas.countries[0]!;
    const geography = buildCountryGeography({ countryId: country.id, seed: country.seed, macroCells: countryMacroContext(atlas, country.id) });
    const project = createCountryWorldProjection(geography, projected);
    const points = Array.from({ length: 100 }, (_, index) => project({ x: -450 + index % 10 * 100, y: -450 + Math.floor(index / 10) * 100 })!.point);
    expect(new Set(points.map(point => `${point.x}:${point.y}`)).size).toBe(100);
  });
});
