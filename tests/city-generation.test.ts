import { describe, expect, it } from "vitest";
import { getBuilding } from "../src/shared/catalog";
import type { CityDto, DistrictDto, RoadCellDto, TaskDto, WorldFeatureDto } from "../src/shared/contracts";
import { greenAreaDevelopmentStage } from "../src/shared/green-area";
import {
  archetypeAffinity,
  buildingVisualReservationCells,
  buildingVisualSetbackCells,
  buildingCompatibleWithArchetype,
  buildingZoningRole,
  buildingLotPlacementScore,
  buildSurfaceMap,
  buildingApronCells,
  buildingGapPaths,
  chooseDistrictArchetype,
  districtAnnexSearchBounds,
  entranceOutside,
  findAreaAccessPath,
  findAccessPlan,
  isCompactNewBuildBuilding,
} from "../src/server/world/city-generation";
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
    buildingType: "house-lowrise-gallery", visualKind: "BUILDING", visualAssetKey: "house-lowrise-gallery", platformType: "STONE", origin, footprint,
    entrance: { x: origin.x, y: origin.y + height }, accessPath: [], accessKind: "PATH", stage: 1,
    createdAt: "now", updatedAt: "now", mergeRequests: [],
  };
}

describe("V6 city morphology and access planning", () => {
  it("derives a north-side lot setback from the finished opaque facade", () => {
    expect(buildingVisualSetbackCells(getBuilding("highrise-glass"))).toBe(18);
    expect(buildingVisualSetbackCells(getBuilding("civic-library"))).toBe(6);
    expect(buildingVisualSetbackCells(getBuilding("house-lowrise-gallery"))).toBe(0);
  });

  it("does not classify a small-footprint tower as compact infill", () => {
    expect(getBuilding("highrise-glass").footprint).toEqual({ width: 12, height: 10 });
    expect(isCompactNewBuildBuilding(getBuilding("highrise-glass"))).toBe(false);
    expect(isCompactNewBuildBuilding(getBuilding("house-small-apartments"))).toBe(true);
  });

  it("bounds annex search around fresh land instead of the complete old district", () => {
    expect(districtAnnexSearchBounds({ minX: 360, minY: 10, maxX: 424, maxY: 80 }))
      .toEqual({ minX: 336, minY: -14, maxX: 448, maxY: 104 });
  });

  it("reserves the complete north-projecting facade above a building footprint", () => {
    const entry = getBuilding("civic-library");
    const reservation = buildingVisualReservationCells(entry, { x: 10, y: 20 });
    expect(reservation).toHaveLength(entry.footprint.width * (entry.footprint.height + 6));
    expect(reservation).toContainEqual({ x: 10, y: 14 });
    expect(reservation).toContainEqual({
      x: 10 + entry.footprint.width - 1,
      y: 20 + entry.footprint.height - 1,
    });
  });

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

  it("strongly prefers compatible residential families without banning local commerce", () => {
    const mixed = getBuilding("highrise-mixed-use-market");
    const privateHome = getBuilding("house-lowrise-gallery");
    const gas = getBuilding("commercial-gas-station-compact");
    expect(archetypeAffinity(mixed, "NEW_BUILD")).toBeGreaterThan(archetypeAffinity(privateHome, "NEW_BUILD"));
    expect(archetypeAffinity(privateHome, "PRIVATE")).toBeGreaterThan(archetypeAffinity(mixed, "PRIVATE"));
    expect(archetypeAffinity(gas, "PRIVATE")).toBeGreaterThan(0);
  });

  it("centers fuel stations inside a road-bounded service lot", () => {
    const gas = getBuilding("commercial-gas-station");
    const lot = { origin: { x: 10, y: 20 }, width: 20, height: 13 };
    const centered = { x: 13, y: 23 };
    const edge = { x: 10, y: 20 };
    expect(buildingLotPlacementScore({ entry: gas, lot, origin: centered, accessDistance: 3, bottomGap: 3, partyBonus: 0 }))
      .toBeLessThan(buildingLotPlacementScore({ entry: gas, lot, origin: edge, accessDistance: 3, bottomGap: 6, partyBonus: 0 }));
  });

  it("uses hard residential massing boundaries between district archetypes", () => {
    const highrise = getBuilding("highrise-glass");
    const brutalistBlock = getBuilding("house-brutalist-block");
    const cohousingCluster = getBuilding("house-cohousing-cluster");
    const privateHome = getBuilding("house-lowrise-gallery");
    const longShop = getBuilding("shop-bakery-long");
    expect(buildingZoningRole(highrise)).toBe("HIGH_RISE_RESIDENTIAL");
    expect(buildingZoningRole(brutalistBlock)).toBe("MID_RISE_RESIDENTIAL");
    expect(buildingZoningRole(cohousingCluster)).toBe("MID_RISE_RESIDENTIAL");
    expect(buildingCompatibleWithArchetype(brutalistBlock, "NEW_BUILD")).toBe(true);
    expect(buildingCompatibleWithArchetype(cohousingCluster, "NEW_BUILD")).toBe(true);
    expect(buildingZoningRole(privateHome)).toBe("LOW_RISE_RESIDENTIAL");
    expect(buildingCompatibleWithArchetype(highrise, "PRIVATE")).toBe(false);
    expect(buildingCompatibleWithArchetype(privateHome, "NEW_BUILD")).toBe(false);
    expect(buildingCompatibleWithArchetype(privateHome, "COMMERCIAL")).toBe(false);
    expect(buildingCompatibleWithArchetype(longShop, "NEW_BUILD")).toBe(true);
  });

  it("models residential districts as low+mid and mid+high without private houses", () => {
    const template = getBuilding("house-small-apartments");
    const low = { ...template, key: "low", tags: ["house", "residential", "low-rise-residential"] };
    const mid = { ...template, key: "mid", tags: ["house", "residential", "mid-rise-residential"] };
    const high = { ...template, key: "high", category: "HIGHRISE" as const, tags: ["highrise", "residential", "high-rise-residential"] };

    expect(buildingZoningRole(low)).toBe("LOW_RISE_RESIDENTIAL");
    expect(buildingZoningRole(mid)).toBe("MID_RISE_RESIDENTIAL");
    expect(buildingZoningRole(high)).toBe("HIGH_RISE_RESIDENTIAL");
    expect(buildingCompatibleWithArchetype(low, "PRIVATE")).toBe(true);
    expect(buildingCompatibleWithArchetype(mid, "PRIVATE")).toBe(true);
    expect(buildingCompatibleWithArchetype(high, "PRIVATE")).toBe(false);
    expect(buildingCompatibleWithArchetype(low, "NEW_BUILD")).toBe(false);
    expect(buildingCompatibleWithArchetype(mid, "NEW_BUILD")).toBe(true);
    expect(buildingCompatibleWithArchetype(high, "NEW_BUILD")).toBe(true);
  });

  it("publishes sidewalks around city streets but does not leak new sidewalk into a completed district", () => {
    const roads = new Map<string, RoadCellDto>();
    for (let x = -3; x <= 3; x += 1) roads.set(`${x},0`, { x, y: 0, mask: 0, structure: "ROAD", roadClass: "LOCAL" });
    const sealed = district("sealed", "PRIVATE", "COMPLETED");
    const surfaces = buildSurfaceMap({ roads, cities: [city()], districts: [sealed], tasks: [], features: [], isSurfaceTerrain: () => true });
    expect(surfaces.get("0,-1")?.kind).toBe("SIDEWALK");
    const externalRoads = new Map(roads);
    externalRoads.set("10,0", { x: 10, y: 0, mask: 0, structure: "ROAD", roadClass: "LOCAL" });
    const guarded = buildSurfaceMap({ roads: externalRoads, cities: [city()], districts: [sealed], tasks: [], features: [], isSurfaceTerrain: () => true });
    expect(guarded.has("9,0")).toBe(false);
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

  it("publishes park navigation only after its path-construction stage", () => {
    const footprint = rectangleFootprint({ x: 0, y: 0 }, 8, 7);
    const feature = (developmentStage: WorldFeatureDto["developmentStage"]): WorldFeatureDto => ({
      id: "park", cityId: "city", districtId: "dense", parentFeatureId: null,
      kind: "PARK", assetKind: "AREA", assetKey: "urban-formal", origin: { x: 0, y: 0 },
      footprint, orientation: "S", accessPath: [], developmentStage,
    });
    const build = (developmentStage: WorldFeatureDto["developmentStage"]) => buildSurfaceMap({
      roads: new Map(), cities: [city()], districts: [district("dense", "NEW_BUILD")], tasks: [],
      features: [feature(developmentStage)], isSurfaceTerrain: () => true,
    });
    expect(build(1).has("3,3")).toBe(false);
    expect(build(2).get("3,3")?.kind).toBe("PATH");
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

  it("finds a short entrance-to-sidewalk path inside the lot", () => {
    const entry = getBuilding("house-lowrise-gallery");
    const origin = { x: 1, y: 1 };
    const footprint = rectangleFootprint(origin, entry.footprint.width, entry.footprint.height);
    const entrance = entranceOutside(origin, entry, "S", entry.entrances[0]!.offset);
    const sidewalk = { x: entrance.x, y: entrance.y + 2 };
    const lotWidth = Math.max(8, entry.footprint.width + 2);
    const lotHeight = Math.max(8, entry.footprint.height + 3);
    const surfaces = new Map([[cellKey(sidewalk), { ...sidewalk, kind: "SIDEWALK" as const }]]);
    const plan = findAccessPlan({
      entry,
      origin,
      lotCells: new Set(rectangleFootprint({ x: 0, y: 0 }, lotWidth, lotHeight).map(cellKey)),
      buildingFootprint: new Set(footprint.map(cellKey)),
      occupied: new Set(),
      roads: new Map(),
      surfaces,
      isWalkableTerrain: () => true,
    });
    expect(plan).not.toBeNull();
    expect(plan!.path.length).toBeLessThanOrEqual(6);
    expect(cellKey(plan!.entrance)).toBe(cellKey(entrance));
  });

  it("persists the sidewalk endpoint of a green-area access path", () => {
    const sidewalk = { x: 2, y: 0, kind: "SIDEWALK" as const };
    const path = findAreaAccessPath({
      allowed: new Set(["1,0", "2,0"]),
      footprint: [{ x: 0, y: 0 }],
      roads: new Map(),
      surfaces: new Map([["2,0", sidewalk]]),
      occupied: new Set(),
      isWalkableTerrain: () => true,
    });
    expect(path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(path?.at(-1)).toEqual({ x: sidewalk.x, y: sidewalk.y });
  });
});
