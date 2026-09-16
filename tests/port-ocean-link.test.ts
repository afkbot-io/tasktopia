import { expect, it } from "vitest";
import { resolvePortOceanLink } from "../src/shared/port-ocean-link";
import type { PlanetCountryDto } from "../src/shared/planet-atlas-contract";
import type { PlanetTerrainCell } from "../src/shared/planet-atlas";
const country: PlanetCountryDto = {
  id: "country", name: "Берег", seed: 42, terrainProfile: { version: 1, kind: "EAST_COAST", coastX: 100 },
  worldVersion: 1, cityCount: 1, districtCount: 0, buildingCount: 0, unfinishedBuildingCount: 0, progress: 0,
  worldBounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 },
  cities: [{ id: "city", center: { x: 40, y: 50 }, districts: [], airports: [] }],
};
const cells: PlanetTerrainCell[] = Array.from({ length: 9 }, (_, i) => ({ q: i % 3, r: Math.floor(i / 3), id: `land-${i}`, terrain: "grass" }));
const fixture = {
  country, cityId: "city", localBerth: { x: 120, y: 50 },
  projected: { id: country.id, cells, worldBounds: country.worldBounds },
  ownedCoast: [0, 1, 2].map(r => ({ q: 3, r, id: `coast-${r}`, terrain: "coast" as const })),
  openOcean: Array.from({ length: 18 }, (_, i) => ({ x: 4 + i % 6, y: Math.floor(i / 6) })),
};
it("maps a proven local marine berth to a clear ocean outlet through the recorded own coast", () => {
  const before = structuredClone(fixture), link = resolvePortOceanLink(fixture);
  expect(link).toEqual({ countryId: "country", cityId: "city", worldSeed: 42, localOutlet: { x: 120, y: 50 }, oceanOutlet: { x: 5, y: 1 } });
  expect(fixture).toEqual(before);
});
it("rejects classic lakes, inland berths, foreign countries, absent cities and invalid coordinates", () => {
  expect(resolvePortOceanLink({ ...fixture, country: { ...country, terrainProfile: undefined } })).toBeNull();
  expect(resolvePortOceanLink({ ...fixture, localBerth: { x: 20, y: 50 } })).toBeNull();
  expect(resolvePortOceanLink({ ...fixture, projected: { ...fixture.projected, id: "other" } })).toBeNull();
  expect(resolvePortOceanLink({ ...fixture, cityId: "other" })).toBeNull();
  expect(resolvePortOceanLink({ ...fixture, localBerth: { x: 120, y: Number.NaN } })).toBeNull();
});
it("does not cross missing or foreign coast, unknown terrain, or water narrower than the hull", () => {
  expect(resolvePortOceanLink({ ...fixture, ownedCoast: [] })).toBeNull();
  expect(resolvePortOceanLink({ ...fixture, openOcean: fixture.openOcean.filter(cell => cell.x !== 4) })).toBeNull();
  expect(resolvePortOceanLink({ ...fixture, openOcean: fixture.openOcean.filter(cell => cell.y === 1) })).toBeNull();
});
