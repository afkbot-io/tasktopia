import { describe, expect, it } from "vitest";
import { getBuilding } from "../src/shared/catalog";
import type { CityDto, DistrictDto, RoadCellDto } from "../src/shared/contracts";
import {
  archetypeAffinity,
  buildingCompatibleWithArchetype,
  buildingZoningRole,
  buildSurfaceMap,
  chooseDistrictArchetype,
  findAccessPlan,
} from "../src/server/world/city-generation";
import { cellKey, rectangleFootprint } from "../src/server/world/grid";

function city(): CityDto {
  return {
    id: "city", name: "City", description: "", goal: "", acceptanceCriteria: "", deadline: null, status: "ACTIVE",
 kind: "WORK", center: { x: 0, y: 0 },
    bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 }, styleId: "style", morphology: "BALANCED", createdAt: "now",
  };
}

function district(id: string, archetype: DistrictDto["archetype"], status: DistrictDto["status"] = "ACTIVE"): DistrictDto {
  return {
    id, cityId: "city", name: id, goal: "", description: "", deadline: null, status, capacitySp: 26,
    cells: rectangleFootprint({ x: -10, y: -10 }, 20, 20), lots: [], growthDirection: "E", archetype, color: "#fff", createdAt: "now",
  };
}

describe("V6 city morphology and access planning", () => {
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
    const privateHome = getBuilding("house-brick-duplex");
    const gas = getBuilding("commercial-gas-station-compact");
    expect(archetypeAffinity(mixed, "NEW_BUILD")).toBeGreaterThan(archetypeAffinity(privateHome, "NEW_BUILD"));
    expect(archetypeAffinity(privateHome, "PRIVATE")).toBeGreaterThan(archetypeAffinity(mixed, "PRIVATE"));
    expect(archetypeAffinity(gas, "PRIVATE")).toBeGreaterThan(0);
  });

  it("uses hard residential massing boundaries between district archetypes", () => {
    const highrise = getBuilding("highrise-glass");
    const privateHome = getBuilding("house-brick-duplex");
    const longShop = getBuilding("shop-bakery-long");
    expect(buildingZoningRole(highrise)).toBe("DENSE_RESIDENTIAL");
    expect(buildingZoningRole(privateHome)).toBe("PRIVATE_RESIDENTIAL");
    expect(buildingCompatibleWithArchetype(highrise, "PRIVATE")).toBe(false);
    expect(buildingCompatibleWithArchetype(privateHome, "NEW_BUILD")).toBe(false);
    expect(buildingCompatibleWithArchetype(privateHome, "COMMERCIAL")).toBe(false);
    expect(buildingCompatibleWithArchetype(longShop, "NEW_BUILD")).toBe(true);
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
    expect(crossings.length).toBeGreaterThanOrEqual(3);
    expect(crossings.every((surface) => surface.orientation === "V")).toBe(true);
    const crossingX = crossings[0]!.x;
    expect(surfaces.get(`${crossingX},-2`)?.kind).toBe("SIDEWALK");
    expect(surfaces.get(`${crossingX},2`)?.kind).toBe("SIDEWALK");
  });

  it("finds a short entrance-to-sidewalk path inside the lot", () => {
    const entry = getBuilding("house-brick-duplex");
    const origin = { x: 1, y: 1 };
    const footprint = rectangleFootprint(origin, entry.footprint.width, entry.footprint.height);
    const surfaces = new Map([["2,6", { x: 2, y: 6, kind: "SIDEWALK" as const }]]);
    const plan = findAccessPlan({
      entry,
      origin,
      lotCells: new Set(rectangleFootprint({ x: 0, y: 0 }, 6, 7).map(cellKey)),
      buildingFootprint: new Set(footprint.map(cellKey)),
      occupied: new Set(),
      roads: new Map(),
      surfaces,
      isWalkableTerrain: () => true,
    });
    expect(plan).not.toBeNull();
    expect(plan!.path.length).toBeLessThanOrEqual(6);
    expect(cellKey(plan!.entrance)).toBe("2,4");
  });
});
