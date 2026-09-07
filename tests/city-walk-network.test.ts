import { describe, expect, it } from "vitest";
import { buildCityWalkNetwork, type CityWalkInput } from "../src/client/city-walk-network";
import { greenAreaSurfaceLayout } from "../src/shared/green-area";

function fixture(): CityWalkInput {
  return {
    terrain: Array.from({ length: 100 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10), terrain: "GRASS" })),
    roads: new Map(),
    surfaces: Array.from({ length: 100 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10), kind: "PATH" })),
    tasks: [], features: [], decorations: [],
  };
}

describe("city pedestrian ground contract", () => {
  it("keeps a neighbouring walkway open while a narrow infill park is under construction", () => {
    const input = fixture();
    input.tasks = [{ taskNumber: 3, visualKind: "PARK", stage: 3, visualAssetKey: "urban-park",
      footprint: [{ x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }], accessPath: [{ x: 3, y: 6 }] }];
    const result = buildCityWalkNetwork(input);
    expect(result.walkGraph.has("3,4")).toBe(false);
    expect(result.walkGraph.has("2,4")).toBe(true);
    expect(result.walkGraph.has("4,4")).toBe(true);
  });
  it("excludes a task lake's rendered water even when its underlying terrain is meadow", () => {
    const input = fixture();
    input.terrain = input.terrain.map(cell => ({ ...cell, terrain: "MEADOW" }));
    input.surfaces = [];
    const footprint = Array.from({ length: 81 }, (_, i) => ({ x: i % 9, y: Math.floor(i / 9) }));
    input.tasks = [{ taskNumber: 2, visualKind: "PARK", stage: 5, visualAssetKey: "urban-lake", footprint, accessPath: [] }];
    const water = greenAreaSurfaceLayout(footprint, 5, "urban-lake").filter(cell => cell.role === "WATER");
    expect(water.length).toBeGreaterThan(0);
    const result = buildCityWalkNetwork(input);
    for (const cell of water) {
      const key = `${cell.x},${cell.y}`;
      expect(result.animalGraph.has(key), `animal on task water ${key}`).toBe(false);
      expect(result.walkGraph.has(key), `person on task water ${key}`).toBe(false);
    }
    input.tasks = [];
    input.features = [{ assetKind: "AREA", assetKey: "urban-lake", kind: "PARK", developmentStage: 4, footprint, accessPath: [] }];
    const area = buildCityWalkNetwork(input);
    for (const cell of greenAreaSurfaceLayout(footprint, 4, "urban-lake")) {
      if (cell.role === "WATER" || cell.role === "BASIN") expect(area.animalGraph.has(`${cell.x},${cell.y}`)).toBe(false);
    }
  });

  it("excludes a building and its construction fence, then opens only the finished forecourt", () => {
    const input = fixture();
    input.tasks = [{ taskNumber: 1, visualKind: "BUILDING", stage: 3, visualAssetKey: "compact-row-v1",
      footprint: Array.from({ length: 18 }, (_, i) => ({ x: 2 + i % 6, y: 2 + Math.floor(i / 6) })),
      accessPath: [{ x: 5, y: 5 }, { x: 5, y: 6 }] }];
    const construction = buildCityWalkNetwork(input);
    expect(construction.walkGraph.has("2,2")).toBe(false);
    expect(construction.walkGraph.has("1,3")).toBe(false);
    expect(construction.activityCells.has("5,6")).toBe(false);
    input.tasks[0]!.stage = 5;
    const finished = buildCityWalkNetwork(input);
    expect(finished.walkGraph.has("2,2")).toBe(false);
    expect(finished.walkGraph.has("1,3")).toBe(true);
    expect(finished.activityCells.has("5,6")).toBe(true);
  });

  it("never bridges a water or unpainted road gap between two paths", () => {
    const input = fixture();
    input.terrain = [{ x: 1, y: 0, terrain: "DEEP_WATER" }];
    input.surfaces = [{ x: 0, y: 0, kind: "PATH" }, { x: 2, y: 0, kind: "PATH" }];
    expect(buildCityWalkNetwork(input).walkGraph.has("1,0")).toBe(false);
    input.terrain[0]!.terrain = "GRASS";
    input.roads = new Map([["1,0", { x: 1, y: 0 }]]);
    expect(buildCityWalkNetwork(input).walkGraph.has("1,0")).toBe(false);
  });
});
