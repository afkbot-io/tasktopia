import { describe, expect, it } from "vitest";
import type { CityDto, DistrictDto, RoadCellDto, TaskDto } from "../src/shared/contracts";
import { greenAreaDevelopmentStage } from "../src/shared/green-area";
import { buildSurfaceMap, buildingApronCells, buildingGapPaths, chooseDistrictArchetype } from "../src/server/world/city-generation";
import { cellKey, rectangleFootprint } from "../src/server/world/grid";

function city(): CityDto {
  return {
    id: "city", name: "City", description: "", goal: "", acceptanceCriteria: "", deadline: null, status: "ACTIVE",
    center: { x: 0, y: 0 },
    bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 }, styleId: "style", morphology: "BALANCED", createdAt: "now",
  };
}

function district(id: string, archetype: DistrictDto["archetype"], status: DistrictDto["status"] = "ACTIVE"): DistrictDto {
  return {
    id, cityId: "city", name: id, goal: "", description: "", deadline: null, status, capacitySp: 26,
    cells: rectangleFootprint({ x: -10, y: -10 }, 20, 20), lots: [], growthDirection: "E", archetype, color: "#fff", createdAt: "now",
  };
}

function placedTask(id: string, origin: { x: number; y: number }, width: number, height: number): TaskDto {
  const footprint = rectangleFootprint(origin, width, height);
  return {
    id, taskNumber: 1, cityId: "city", districtId: "dense", title: id, description: "", workItemType: "TASK",
    acceptanceCriteria: "", systemAnalysis: "", architecture: "", designSystem: "", implementationPlan: "",
    estimate: 1, priority: "NORMAL", status: "PLANNING", progress: 0, dueAt: null,
    buildingType: "compact-apartment-v1", visualKind: "BUILDING", visualAssetKey: "compact-apartment-v1", platformType: "STONE", origin, footprint,
    entrance: { x: origin.x, y: origin.y + height }, accessPath: [], accessKind: "PATH", stage: 1,
    createdAt: "now", updatedAt: "now", mergeRequests: [],
  };
}

describe("compact city morphology and pedestrian surfaces", () => {
  it("paves only free orthogonal apron cells around task buildings", () => {
    const task = placedTask("building", { x: 2, y: 2 }, 3, 2);
    const blocked = new Set(task.footprint.map((cell) => `${cell.x},${cell.y}`));
    blocked.add("1,2");
    const roads = new Map([["5,2", { x: 5, y: 2, mask: 0, structure: "ROAD", roadClass: "LOCAL" } satisfies RoadCellDto]]);
    const apron = buildingApronCells({ tasks: [task], roads, blocked, isSurfaceTerrain: () => true });
    expect(apron).not.toContainEqual({ x: 1, y: 2 });
    expect(apron).not.toContainEqual({ x: 5, y: 2 });
    expect(apron).toContainEqual({ x: 2, y: 1 });
    expect(apron).toContainEqual({ x: 4, y: 4 });
  });
  it("maps the district lifecycle onto all five park stages", () => {
    expect(greenAreaDevelopmentStage([])).toBe(1);
    expect(greenAreaDevelopmentStage(["PLANNING"])).toBe(1);
    expect(greenAreaDevelopmentStage(["STARTED"])).toBe(2);
    expect(greenAreaDevelopmentStage(["IN_PROGRESS"])).toBe(3);
    expect(greenAreaDevelopmentStage(["TESTING"])).toBe(4);
    expect(greenAreaDevelopmentStage(["COMPLETED"])).toBe(5);
    expect(greenAreaDevelopmentStage(["COMPLETED", "PLANNING"])).toBe(5);
  });

  it("selects explicit semantics and follows the stable balanced city profile", () => {
    expect(chooseDistrictArchetype({ name: "Новые высотки", goal: "Новостройки", morphology: "BALANCED", existing: [], variation: 0 })).toBe("NEW_BUILD");
    expect(chooseDistrictArchetype({ name: "Сосновые дома", goal: "Жильё", morphology: "DENSE_CORE", existing: [], variation: 0 })).toBe("PRIVATE");
    expect(chooseDistrictArchetype({
      name: "Третий квартал", goal: "", morphology: "BALANCED",
      existing: [district("one", "PRIVATE"), district("two", "COMMERCIAL")], variation: 0,
    })).toBe("COMMERCIAL");
    expect(chooseDistrictArchetype({
      name: "Четвёртый квартал", goal: "", morphology: "BALANCED",
      existing: [district("one", "PRIVATE"), district("two", "NEW_BUILD"), district("three", "COMMERCIAL")], variation: 0,
    })).toBe("CIVIC");
  });

  it("publishes an unbroken eight-neighbour pavement envelope around city streets", () => {
    const roads = new Map<string, RoadCellDto>();
    for (let x = -3; x <= 3; x += 1) roads.set(`${x},0`, { x, y: 0, mask: 0, structure: "ROAD", roadClass: "LOCAL" });
    const sealed = district("sealed", "PRIVATE", "COMPLETED");
    const surfaces = buildSurfaceMap({ roads, cities: [city()], districts: [sealed], tasks: [], features: [], isSurfaceTerrain: () => true });
    expect(surfaces.get("0,-1")?.kind).toBe("SIDEWALK");
    expect(surfaces.get("-4,-1")?.kind).toBe("SIDEWALK");
    expect(surfaces.get("-4,1")?.kind).toBe("SIDEWALK");
    expect(surfaces.get("4,-1")?.kind).toBe("SIDEWALK");
    expect(surfaces.get("4,1")?.kind).toBe("SIDEWALK");
    const externalRoads = new Map(roads);
    externalRoads.set("10,0", { x: 10, y: 0, mask: 0, structure: "ROAD", roadClass: "LOCAL" });
    const guarded = buildSurfaceMap({ roads: externalRoads, cities: [city()], districts: [sealed], tasks: [], features: [], isSurfaceTerrain: () => true });
    expect(guarded.get("9,0")?.kind).toBe("SIDEWALK");
    expect(guarded.get("9,-1")?.kind).toBe("SIDEWALK");
  });

  it("connects opposite sidewalks with sparse oriented crosswalk cells", () => {
    const roads = new Map<string, RoadCellDto>();
    for (let x = -8; x <= 8; x += 1) for (let y = -1; y <= 1; y += 1) {
      roads.set(`${x},${y}`, { x, y, mask: 0, structure: "ROAD", roadClass: "LOCAL" });
    }
    const surfaces = buildSurfaceMap({ roads, cities: [city()], districts: [], tasks: [], features: [], isSurfaceTerrain: () => true });
    const crossings = [...surfaces.values()].filter((surface) => surface.kind === "CROSSWALK");
    expect(crossings.length).toBeGreaterThanOrEqual(2);
    expect(crossings.every((surface) => surface.orientation === "V")).toBe(true);
    const crossingX = crossings[0]!.x;
    expect(surfaces.get(`${crossingX},-2`)?.kind).toBe("SIDEWALK");
    expect(surfaces.get(`${crossingX},2`)?.kind).toBe("SIDEWALK");
  });

  it("turns a one-cell seam between occupied facades into a paved alley", () => {
    const dense = district("dense", "NEW_BUILD");
    dense.lots = [
      { id: "a", origin: { x: 0, y: 0 }, width: 3, height: 4, taskId: "task-a", groupId: "block" },
      { id: "b", origin: { x: 4, y: 0 }, width: 3, height: 4, taskId: "task-b", groupId: "block" },
    ];
    const tasks = [placedTask("task-a", { x: 0, y: 0 }, 3, 4), placedTask("task-b", { x: 4, y: 0 }, 3, 4)];
    expect(buildingGapPaths([dense], tasks)).toEqual(rectangleFootprint({ x: 3, y: 0 }, 1, 4));
    const surfaces = buildSurfaceMap({
      roads: new Map(), cities: [city()], districts: [dense], tasks,
      features: [], isSurfaceTerrain: () => true,
    });
    expect(rectangleFootprint({ x: 3, y: 0 }, 1, 4).every((cell) =>
      surfaces.get(cellKey(cell))?.kind === "PATH" && surfaces.get(cellKey(cell))?.finish === "PAVERS"),
    ).toBe(true);
  });


});
