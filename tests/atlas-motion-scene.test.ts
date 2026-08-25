import { describe, expect, it } from "vitest";
import { buildAtlasFlightLane, countryAirportAnchor } from "../src/shared/atlas-motion-scene";

describe("shared atlas motion scene", () => {
  it("clamps a projected airport into the city cutout", () => {
    const city = {
      atlasCenter: { x: 11, y: 11 },
      cutoutMask: [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }],
      features: [{ kind: "AIRPORT" as const, atlasOrigin: { x: 60, y: 70 }, atlasFootprint: [{ x: 60, y: 70 }] }],
    };
    expect(countryAirportAnchor(city)).toEqual({ x: 11, y: 11 });
    expect(city.cutoutMask).toContainEqual(countryAirportAnchor(city));
  });

  it("builds deterministic non-overlapping lanes with altitude classes", () => {
    const from = { x: 20, y: 40 };
    const to = { x: 240, y: 160 };
    const first = buildAtlasFlightLane("route-a", from, to, 44, 0);
    expect(buildAtlasFlightLane("route-a", from, to, 44, 0)).toEqual(first);
    expect(buildAtlasFlightLane("route-a", from, to, 44, 1).path).not.toBe(first.path);
    expect([.82, 1, 1.18]).toContain(first.altitudeScale);
    expect(first.path).toMatch(/^M20\.0 40\.0 Q/);
  });
});
