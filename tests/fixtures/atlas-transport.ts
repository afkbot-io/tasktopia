import type { PlanetAtlasDto } from "../../src/shared/planet-atlas-contract";

// Country IDs affect continent topology. Keep the entire rendering fixture
// independent of the randomly generated country used to authenticate the test.
export function transportAtlasFixture(): PlanetAtlasDto {
  return {
    schemaVersion: 4, planetSeed: 782441, revision: "transport-fixture-v2",
    countries: Array.from({ length: 4 }, (_, i) => ({
      id: ["north", "south", "east", "west"][i]!, name: ["Дедлайново", "Северия", "Островная", "Приморье"][i]!,
      seed: 11 + i * 11, worldVersion: 4, cityCount: 2, districtCount: 2,
      buildingCount: 12, unfinishedBuildingCount: 4, progress: 67,
      worldBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      cities: [20, 80].map((x, j) => ({
        id: `city-${i}-${j}`, center: { x, y: 50 },
        districts: [{ id: `d-${i}-${j}`, center: { x, y: 50 } }],
        airports: [{ taskId: `airport-${i}-${j}`, center: { x, y: 50 } }],
        stations: [{ taskId: `station-${i}-${j}`, center: { x, y: 50 } }],
      })),
    })),
  };
}
