import { describe, expect, it } from "vitest";
import { PROP_CATALOG } from "../src/shared/catalog";
import type { Cell, CityDto, DistrictDto, SurfaceCellDto, TaskDto, TerrainCellDto } from "../src/shared/contracts";
import { generateWorldDecorations } from "../src/shared/world-decorations";
import { cellKey, rectangleFootprint } from "../src/server/world/grid";

describe("procedural decoration footprints", () => {
  it("reserves every footprint cell and keeps fences inside their district", () => {
    const terrain: TerrainCellDto[] = [];
    const cells: Cell[] = [];
    for (let y = 0; y < 96; y += 1) for (let x = 0; x < 96; x += 1) {
      terrain.push({ x, y, terrain: "GRASS", variant: 0 });
      cells.push({ x, y });
    }
    const district = {
      id: "district", cityId: "city", name: "Planned", goal: "", description: "", deadline: null, status: "PLANNED", capacitySp: 20,
      cells, lots: [], growthDirection: "E", archetype: "MIXED_URBAN", color: "#fff", createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies DistrictDto;
    const decorations = generateWorldDecorations(84721, terrain, new Set(), [], [district], [], []);
    const fences = decorations.filter((item) => item.kind.startsWith("fence-"));
    expect(fences.length).toBeGreaterThan(0);
    const occupied = new Set<string>();
    for (const decoration of decorations) {
      const prop = PROP_CATALOG[decoration.kind]!;
      const footprint = rectangleFootprint(decoration.origin, prop.footprint.width, prop.footprint.height);
      expect(footprint.every((cell) => cells.some((candidate) => cellKey(candidate) === cellKey(cell)))).toBe(true);
      expect(footprint.every((cell) => !occupied.has(cellKey(cell)))).toBe(true);
      for (const cell of footprint) occupied.add(cellKey(cell));
    }
  });

  it("keeps boats and stationary people sparse around a representative shoreline", () => {
    const terrain: TerrainCellDto[] = [];
    for (let y = 0; y < 96; y += 1) for (let x = 0; x < 96; x += 1) {
      terrain.push({ x, y, terrain: y < 40 ? "DEEP_WATER" : y < 44 ? "SAND" : "GRASS", variant: 0 });
    }
    const surfaces: SurfaceCellDto[] = Array.from({ length: 76 }, (_, index) => ({ x: index + 10, y: 50, kind: "PATH" }));
    const city: CityDto = {
      id: "city", name: "Harbour", description: "", goal: "", acceptanceCriteria: "", deadline: null, status: "ACTIVE",
      center: { x: 48, y: 68 },
      bounds: { minX: 24, minY: 48, maxX: 72, maxY: 88 }, styleId: "pixel-v4", morphology: "BALANCED", createdAt: "2026-01-01T00:00:00.000Z",
    };
    const decorations = generateWorldDecorations(424242, terrain, new Set(), surfaces, [], [city.bounds], []);
    const boats = decorations.filter((item) => item.kind.startsWith("boat-"));
    const fishers = decorations.filter((item) => item.kind.startsWith("fisher-"));
    const residents = decorations.filter((item) => item.kind.startsWith("resident-"));
    expect(boats.length).toBeLessThanOrEqual(3);
    expect(fishers.length).toBeLessThanOrEqual(2);
    expect(residents.length).toBeLessThanOrEqual(4);
    expect(boats.length + fishers.length + residents.length).toBeLessThanOrEqual(9);
  });

  it("never places fishers next to a road even when the road follows the shore", () => {
    const terrain: TerrainCellDto[] = [];
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 256; x += 1) {
      terrain.push({ x, y, terrain: y < 28 ? "DEEP_WATER" : y < 32 ? "SAND" : "GRASS", variant: 0 });
    }
    const road = Array.from({ length: 256 }, (_, x) => ({ x, y: 31 }));
    const blocked = new Set(road.map(cellKey));
    const city: CityDto = {
      id: "city", name: "Shore road", description: "", goal: "", acceptanceCriteria: "", deadline: null, status: "ACTIVE",
      center: { x: 128, y: 38 },
      bounds: { minX: 0, minY: 24, maxX: 255, maxY: 63 }, styleId: "pixel-v4", morphology: "BALANCED", createdAt: "2026-01-01T00:00:00.000Z",
    };
    const fishers = Array.from({ length: 24 }, (_, seed) => generateWorldDecorations(seed + 1, terrain, blocked, [], [], [city.bounds], []))
      .flat()
      .filter((item) => item.kind.startsWith("fisher-"));
    expect(fishers.length).toBeGreaterThan(0);
    expect(fishers.every((fisher) => Math.abs(fisher.origin.y - 31) > 1)).toBe(true);
  });

  it("places deterministic centred trees and furniture on a large paved frontage", () => {
    const footprint = rectangleFootprint({ x: 20, y: 20 }, 10, 8);
    const surfaces: SurfaceCellDto[] = [
      ...Array.from({ length: 10 }, (_, index) => ({ x: 20 + index, y: 19, kind: "PATH" as const, finish: "PAVERS" as const })),
      ...Array.from({ length: 10 }, (_, index) => ({ x: 20 + index, y: 28, kind: "PATH" as const, finish: "PAVERS" as const })),
    ];
    const terrain: TerrainCellDto[] = rectangleFootprint({ x: 16, y: 16 }, 18, 16)
      .map((cell) => ({ ...cell, terrain: "GRASS" as const, variant: 0 }));
    const task: TaskDto = {
      id: "tower", taskNumber: 81, cityId: "city", districtId: "district", title: "Башня", description: "", workItemType: "TASK",
      acceptanceCriteria: "", systemAnalysis: "", architecture: "", designSystem: "", implementationPlan: "",
      estimate: 3, priority: "NORMAL", status: "IN_PROGRESS", progress: 50, dueAt: null,
      buildingType: "highrise-luxury-tower", visualKind: "BUILDING", visualAssetKey: "highrise-luxury-tower", platformType: "STONE",
      origin: { x: 20, y: 20 }, footprint, entrance: { x: 24, y: 28 }, accessPath: [{ x: 24, y: 19 }], accessKind: "PATH", stage: 3,
      createdAt: "now", updatedAt: "now", mergeRequests: [],
    };
    const blocked = new Set([...footprint, ...surfaces].map(cellKey));
    const first = generateWorldDecorations(77331, terrain, blocked, surfaces, [], [], [task]).filter((item) => item.id.startsWith("frontage:"));
    const second = generateWorldDecorations(77331, terrain, blocked, surfaces, [], [], [task]).filter((item) => item.id.startsWith("frontage:"));
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(first.map((item) => item.kind)).toEqual(expect.arrayContaining(["bench-horizontal", "trash-bin"]));
    expect(first.some((item) => item.kind.startsWith("tree-"))).toBe(true);
    expect(first.every((item) => surfaces.some((surface) => cellKey(surface) === cellKey(item.origin)))).toBe(true);
    expect(first.every((item) => cellKey(item.origin) !== cellKey(task.accessPath[0]!))).toBe(true);
  });

  it("decorates a low-rise apartment frontage without overlapping furniture footprints", () => {
    const footprint = rectangleFootprint({ x: 20, y: 20 }, 12, 9);
    const surfaces: SurfaceCellDto[] = Array.from({ length: 14 }, (_, index) => ({
      x: 19 + index, y: 29, kind: "PATH" as const, finish: "PAVERS" as const,
    }));
    const terrain: TerrainCellDto[] = rectangleFootprint({ x: 16, y: 16 }, 16, 16)
      .map((cell) => ({ ...cell, terrain: "GRASS" as const, variant: 0 }));
    const task: TaskDto = {
      id: "house", taskNumber: 38, cityId: "city", districtId: "district", title: "Дом", description: "", workItemType: "TASK",
      acceptanceCriteria: "", systemAnalysis: "", architecture: "", designSystem: "", implementationPlan: "",
      estimate: 2, priority: "NORMAL", status: "COMPLETED", progress: 100, dueAt: null,
      buildingType: "house-lowrise-gallery", visualKind: "BUILDING", visualAssetKey: "house-lowrise-gallery", platformType: "STONE",
      origin: { x: 20, y: 20 }, footprint, entrance: { x: 26, y: 29 }, accessPath: [{ x: 26, y: 29 }], accessKind: "PATH", stage: 5,
      createdAt: "now", updatedAt: "now", mergeRequests: [],
    };
    const decorations = generateWorldDecorations(88113, terrain, new Set(footprint.map(cellKey)), surfaces, [], [], [task])
      .filter((item) => item.id.startsWith("frontage:"));
    expect(decorations).toHaveLength(3);
    const occupied = new Set<string>();
    for (const decoration of decorations) {
      const prop = PROP_CATALOG[decoration.kind]!;
      for (const cell of rectangleFootprint(decoration.origin, prop.footprint.width, prop.footprint.height)) {
        expect(surfaces.some((surface) => cellKey(surface) === cellKey(cell))).toBe(true);
        expect(occupied.has(cellKey(cell))).toBe(false);
        occupied.add(cellKey(cell));
      }
    }
  });
});
