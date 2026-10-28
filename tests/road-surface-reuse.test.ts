import { expect, it } from "vitest";
import type { Cell, CityDto, RoadCellDto, TaskDto } from "../src/shared/contracts";
import { buildRoadSurfaces } from "../src/shared/road-surfaces";
import { buildSurfaceMap } from "../src/server/world/city-generation";
import { buildRoadSurfaces as previousRoadSurfaces } from "./fixtures/road-surfaces-before-memo";

const key = (cell: Cell) => `${cell.x},${cell.y}`;
function crossRoads(mixed = false) {
  const roads = new Map<string, RoadCellDto>();
  for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) {
    if (Math.abs(x) > 1 && Math.abs(y) > 1) continue;
    roads.set(`${x},${y}`, { x, y, mask: 0, structure: "ROAD", roadClass: mixed && x > 0 ? "HIGHWAY" : "LOCAL" });
  }
  return roads;
}

it("evaluates repeated terrain coordinates only once while constructing one page's surfaces", () => {
  const calls = new Map<string, number>();
  const roads = crossRoads();
  const terrain = (cell: Cell) => {
    calls.set(key(cell), (calls.get(key(cell)) ?? 0) + 1);
    return cell.y > -5 && (cell.x + cell.y * 3) % 7 !== 0;
  };
  const task = { id: "task", districtId: "district", visualKind: "BUILDING", accessKind: "PATH",
    footprint: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }],
    accessPath: [{ x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }],
  } as TaskDto;
  const actual = buildSurfaceMap({ roads, tasks: [task], districts: [], features: [],
    cities: [{ bounds: { minX: -16, minY: -16, maxX: 16, maxY: 16 } } as CityDto], isSurfaceTerrain: terrain });
  expect(actual.size).toBeGreaterThan(0);
  expect(calls.size).toBeGreaterThan(20);
  expect(Math.max(...calls.values())).toBe(1);
});

it("does not recheck terrain for a sidewalk that already has its final priority", () => {
  const calls = new Map<string, number>();
  const actual = buildRoadSurfaces({ roads: crossRoads(), blocked: new Set(), isInsideCity: () => true,
    isSurfaceTerrain: cell => { calls.set(key(cell), (calls.get(key(cell)) ?? 0) + 1); return true; } });
  expect([...actual.values()].some(cell => cell.kind === "CROSSWALK")).toBe(true);
  expect(Math.max(...calls.values())).toBe(1);
});

it("keeps exact prior entry order, paving and local crosswalk phase across coast and class boundaries", () => {
  for (const mixed of [false, true]) for (const coast of [false, true]) for (const reverse of [false, true]) {
    const source = crossRoads(mixed);
    const roads = reverse ? new Map([...source].reverse()) : source;
    const input = { roads, blocked: new Set(["-2,-2", "2,2", "-7,-2"]),
      isInsideCity: (cell: Cell) => cell.x >= -4 && cell.x <= 4 && cell.y >= -4 && cell.y <= 4,
      isSurfaceTerrain: (cell: Cell) => !coast || cell.y > -5 && (cell.x + cell.y * 3) % 7 !== 0,
    };
    const previous = previousRoadSurfaces(input), actual = buildRoadSurfaces(input);
    expect([...actual]).toEqual([...previous]);
    expect([...actual.values()].some(cell => cell.kind === "SIDEWALK")).toBe(true);
    if (mixed) expect([...actual.values()].some(cell => cell.kind === "SHOULDER")).toBe(true);
  }
});

it("bounds its disposable memo and falls back without changing a larger input", () => {
  const roads = new Map<string, RoadCellDto>();
  for (let x = 0; x < 5000; x++) roads.set(`${x},0`, { x, y: 0, mask: 0, structure: "ROAD", roadClass: "LOCAL" });
  const calls = new Map<string, number>();
  const actual = buildSurfaceMap({ roads, tasks: [], districts: [], cities: [], features: [],
    isSurfaceTerrain: cell => { calls.set(key(cell), (calls.get(key(cell)) ?? 0) + 1); return false; } });
  expect(actual.size).toBe(0);
  expect(calls.size).toBeGreaterThan(8192);
  expect(calls.get("0,-1")).toBe(1);
  expect(calls.get("4500,-1")).toBeGreaterThan(1); // Queries after the finite cap remain uncached.
});
