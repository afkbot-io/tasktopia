import { describe, expect, it } from "vitest";
import {
  ATLAS_AIRCRAFT_ENDPOINT_KEYFRAMES,
  atlasAircraftEndpointScale,
  atlasTerrainAsset,
  buildAtlasFlightGeometry,
  sampleAtlasFlight,
} from "../src/shared/atlas-scene";

describe("shared atlas scene primitives", () => {
  it("selects the same existing pixel terrain family for PLANET and COUNTRY", () => {
    expect(atlasTerrainAsset("forest", 4, 7)).toMatch(/^terrain\/forest-[0-9]+\.png$/);
    expect(atlasTerrainAsset("deep_water", 4, 7)).toMatch(/^terrain\/deep_water-[0-9]+\.png$/);
    expect(atlasTerrainAsset("unknown", 4, 7)).toMatch(/^terrain\/deep_water-[0-9]+\.png$/);
    expect(atlasTerrainAsset("forest", 4, 7)).toBe(atlasTerrainAsset("forest", 4, 7));
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
