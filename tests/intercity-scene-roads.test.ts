import { describe, expect, it } from "vitest";
import { citySceneIntercityRoads, type IntercityRoadRoute } from "../src/shared/intercity-roads";

const bounds = { minX: -64, minY: -64, maxX: -1, maxY: -1 };
const road = (id: string, x: number, y: number, direction: "E" | "W" | "S" | "N", length: number): IntercityRoadRoute => ({
  id, fromCityId: "b", toCityId: "c", fromNodeId: "b:node", toNodeId: "c:node", widthCells: 3,
  geometry: { start: { x, y }, runs: [{ direction, length }] },
});

describe("bounded CITY canonical road selection", () => {
  it("keeps a whole transit run on negative coordinates and all local endpoints, excluding distant routes", () => {
    const transit = road("transit", -1_000_000_000, -32, "E", 2_000_000_000);
    const incident = { ...road("incident", 10_000, 10_000, "S", 64), toCityId: "a" };
    const far = road("far", 10_000, 10_000, "N", 64);
    const result = citySceneIntercityRoads([transit, far, incident], "a", bounds);
    expect(result).toEqual([transit, incident]);
    expect(result[0]).toBe(transit); // No expansion, clipping or new route identity.
  });

  it.each([
    [-100, -65, "E", 200], [-100, 0, "E", 200],
    [-65, -100, "S", 200], [0, -100, "S", 200],
    [100, -65, "W", 200], [-65, 100, "N", 200],
  ] as const)("includes the three-cell road's edge even when its centerline is outside: %s,%s %s", (x, y, direction, length) => {
    const route = road("edge", x, y, direction, length);
    expect(citySceneIntercityRoads([route], "a", bounds)).toEqual([route]);
  });

  it("does not confuse a route's bounding box or pavement clearance with its actual road width", () => {
    const around = road("around", -100, -100, "E", 200);
    around.geometry.runs.push({ direction: "S", length: 200 });
    const justOutside = road("clearance-only", -100, -66, "E", 200);
    expect(citySceneIntercityRoads([around, justOutside], "a", bounds)).toEqual([]);
  });

  it("uses each ordered run's start and preserves snapshot order without mutating geometry", () => {
    const bent = road("bent", -100, -100, "E", 68);
    bent.geometry.runs.push({ direction: "S", length: 200 });
    const before = JSON.stringify(bent);
    expect(citySceneIntercityRoads([bent], "a", bounds)).toEqual([bent]);
    expect(JSON.stringify(bent)).toBe(before);
  });
});
