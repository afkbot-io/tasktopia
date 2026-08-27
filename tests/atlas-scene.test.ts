import { describe, expect, it } from "vitest";
import {
  ATLAS_AIRCRAFT_ENDPOINT_KEYFRAMES,
  atlasAircraftEndpointScale,
  atlasTerrainConnectionMask,
  atlasTerrainKindFromWorld,
  atlasTerrainTile,
  buildAtlasFlightGeometry,
  sampleAtlasFlight,
} from "../src/shared/atlas-scene";

describe("shared atlas scene primitives", () => {
  it("selects native atlas sheets and deterministic directional variants per level", () => {
    const country = atlasTerrainTile("mountain", "country", 4, 7, 0b1010);
    const planet = atlasTerrainTile("mountain", "planet", 4, 7, 0b1010);

    expect(country.url).toBe("atlas/terrain-v4/country/mountain.png");
    expect(country).toMatchObject({ tileSize: 16, sourceX: 160, mask: 0b1010 });
    expect(country.sourceY % 16).toBe(0);
    expect(planet.url).toBe("atlas/terrain-v4/planet/mountain.png");
    expect(planet).toMatchObject({ tileSize: 8, sourceX: 80, mask: 0b1010 });
    expect(planet.sourceY % 8).toBe(0);
    expect(atlasTerrainTile("unknown", "planet", 4, 7, 15).url).toContain("deep_water.png");
    expect(atlasTerrainTile("mountain", "planet", 4, 7, 0b1010)).toEqual(planet);
    expect(atlasTerrainTile("mountain", "city", 4, 7, 0b1010)).toMatchObject({
      url: "atlas/terrain-v4/city/mountain.png",
      tileSize: 8,
    });
    expect(atlasTerrainKindFromWorld("WET_SAND")).toBe("coast");
    expect(atlasTerrainKindFromWorld("CLAY")).toBe("stone");
  });

  it("builds N/E/S/W connection masks from matching terrain neighbours", () => {
    const terrain = new Map<string, "mountain" | "grass">([
      ["0:-1", "mountain"],
      ["1:0", "mountain"],
      ["0:1", "grass"],
      ["-1:0", "mountain"],
    ]);
    expect(atlasTerrainConnectionMask("mountain", 0, 0, (column, row) => terrain.get(`${column}:${row}`))).toBe(0b1011);
    expect(atlasTerrainConnectionMask("grass", 0, 0, (column, row) => terrain.get(`${column}:${row}`))).toBe(0b0100);
  });

  it("shares curved route geometry and airport endpoint lifecycle", () => {
    const route = buildAtlasFlightGeometry({ x: 10, y: 20 }, { x: 90, y: 60 }, "route-a", 18);
    expect(route.path).toMatch(/^M10\.0 20\.0 Q/);
    expect(route.path).toContain("90.0 60.0");
    expect(sampleAtlasFlight(route, 0)).toMatchObject({ x: 10, y: 20 });
    expect(sampleAtlasFlight(route, 1)).toMatchObject({ x: 90, y: 60 });
    expect(atlasAircraftEndpointScale(0)).toBeCloseTo(.05);
    expect(atlasAircraftEndpointScale(.5)).toBe(1);
    expect(atlasAircraftEndpointScale(1)).toBeCloseTo(.05);
    expect(ATLAS_AIRCRAFT_ENDPOINT_KEYFRAMES).toBe("0.05;1;1;0.05");
  });
});
