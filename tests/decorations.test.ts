import { describe, expect, it } from "vitest";
import { PROP_CATALOG } from "../src/shared/catalog";
import type { Cell, CityDto, DistrictDto, SurfaceCellDto, TaskDto, TerrainCellDto } from "../src/shared/contracts";
import { generateWorldDecorations } from "../src/shared/world-decorations";
import { courtyardFurnitureFootprint } from "../src/shared/courtyard-furniture";
import { cellKey, rectangleFootprint } from "../src/server/world/grid";
import { compactTreeCover } from "../src/shared/compact-tree-placement";

describe("procedural decoration footprints", () => {
  it("forms dense mostly single-species forest clusters and keeps plain grass trees rare", () => {
    const forest: TerrainCellDto[] = rectangleFootprint({ x: 0, y: 0 }, 64, 64)
      .map((cell) => ({ ...cell, terrain: "FOREST" as const, variant: 0 }));
    const grass: TerrainCellDto[] = rectangleFootprint({ x: 0, y: 0 }, 64, 64)
      .map((cell) => ({ ...cell, terrain: "GRASS" as const, variant: 0 }));
    const forestTrees = generateWorldDecorations(91357, forest, new Set(), [], [], [], [])
      .filter((item) => item.kind.startsWith("tree-"));
    const grassTrees = generateWorldDecorations(91357, grass, new Set(), [], [], [], [])
      .filter((item) => item.kind.startsWith("tree-"));

    // Dense cores use the global two-cell grid (at most 1024 candidates).
    // Crowns overlap again; seeded clearings still prevent full saturation.
    expect(forestTrees.length).toBeGreaterThan(600);
    expect(forestTrees.length).toBeLessThan(2600);
    expect(grassTrees.length).toBeGreaterThan(0);
    expect(grassTrees.length).toBeLessThan(32);

    const clustered = forestTrees.filter((tree) => forestTrees.some((other) => other.id !== tree.id
      && other.kind === tree.kind
      && Math.abs(other.origin.x - tree.origin.x) <= 3
      && Math.abs(other.origin.y - tree.origin.y) <= 3));
    expect(clustered.length / forestTrees.length).toBeGreaterThan(0.82);
  });

  it("places palms only on dry coastal sand and willows only on green shoreline", () => {
    const terrain: TerrainCellDto[] = rectangleFootprint({ x: 0, y: 0 }, 96, 96).map((cell) => ({
      ...cell,
      terrain: cell.x < 8 ? "SHALLOW_WATER" as const
        : cell.x < 10 ? "WET_SAND" as const
          : cell.x < 14 ? "SAND" as const
            : cell.x < 18 ? "GRASS" as const
              : cell.x < 40 ? "MEADOW" as const
                : cell.x < 56 ? "SAND" as const
                : "MEADOW" as const,
      variant: 0,
    }));
    const generated = Array.from({ length: 8 }, (_, index) => generateWorldDecorations(
      73100 + index,
      terrain,
      new Set(),
      [],
      [],
      [],
      [],
    )).flat();
    const palms = generated.filter((item) => item.kind === "tree-palm");
    const willows = generated.filter((item) => item.kind === "tree-willow");

    expect(palms.length).toBeGreaterThan(0);
    expect(palms.every((item) => item.origin.x >= 10 && item.origin.x < 14)).toBe(true);
    expect(willows.length).toBeGreaterThan(0);
    expect(willows.every((item) => item.origin.x >= 14 && item.origin.x < 18)).toBe(true);
  });

  it("keeps cypress in forest groves and deadwood on hills", () => {
    const forest: TerrainCellDto[] = rectangleFootprint({ x: 0, y: 0 }, 96, 96)
      .map((cell) => ({ ...cell, terrain: "FOREST" as const, variant: 0 }));
    const hills: TerrainCellDto[] = rectangleFootprint({ x: 0, y: 0 }, 160, 96)
      .map((cell) => ({ ...cell, terrain: "HILL" as const, variant: 0 }));
    const forestKinds = new Set(Array.from({ length: 12 }, (_, index) => generateWorldDecorations(
      81000 + index, forest, new Set(), [], [], [], [],
    )).flat().map((item) => item.kind));
    const hillKinds = new Set(Array.from({ length: 12 }, (_, index) => generateWorldDecorations(
      91000 + index, hills, new Set(), [], [], [], [],
    )).flat().map((item) => item.kind));

    expect(forestKinds.has("tree-cypress")).toBe(true);
    expect(hillKinds.has("tree-deadwood")).toBe(true);
  });

  it("keeps ground variety procedural without tiny grass, flower, reed or rock sprites", () => {
    const terrain: TerrainCellDto[] = rectangleFootprint({ x: 0, y: 0 }, 160, 128)
      .map((cell) => ({ ...cell, terrain: "MEADOW" as const, variant: 0 }));
    const first = generateWorldDecorations(20260821, terrain, new Set(), [], [], [], []);
    const second = generateWorldDecorations(20260821, terrain, new Set(), [], [], [], []);
    expect(first).toEqual(second);
    expect(first.filter((item) => item.kind.startsWith("crop-"))).toHaveLength(0);
    expect(first.length).toBeLessThan(900);
    expect(first.filter((item) => /^(bush|shrub|rock|flower|reed|grass)-/.test(item.kind))).toHaveLength(0);
    for (const material of ["STONE", "MOUNTAIN", "SHALLOW_WATER", "GRASS"] as const) {
      const generated = generateWorldDecorations(20260821, terrain.map((cell) => ({ ...cell, terrain: material })), new Set(), [], [], [], []);
      expect(generated.filter((item) => /^(bush|shrub|rock|flower|reed|grass)-/.test(item.kind))).toHaveLength(0);
    }
  });
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

  it("keeps boats sparse and never seeds retired static resident or fisher figures", () => {
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
    expect(fishers).toHaveLength(0);
    expect(residents).toHaveLength(0);
    expect(boats.length + fishers.length).toBeLessThanOrEqual(3);
  });

  it("never emits retired fisher assets over many shoreline seeds", () => {
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
    expect(fishers).toHaveLength(0);
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
    expect(first).toHaveLength(2);
    expect(first.map((item) => item.kind)).toContain("bench-horizontal");
    const finished = generateWorldDecorations(77331, terrain, blocked, surfaces, [], [], [{ ...task, stage: 5 }])
      .filter((item) => item.id.startsWith("frontage:"));
    expect(finished).toHaveLength(3);
    expect(finished.some(item => item.kind === "courtyard-cycle-rack")).toBe(true);
    for (const item of first) expect(finished).toContainEqual(item);
    expect(first.some((item) => item.kind.startsWith("tree-"))).toBe(true);
    expect(first.every((item) => surfaces.some((surface) => cellKey(surface) === cellKey(item.origin)))).toBe(true);
    expect(first.every((item) => cellKey(item.origin) !== cellKey(task.accessPath[0]!))).toBe(true);
    const structures = new Set([...footprint, ...task.accessPath].map(cellKey));
    for (const tree of first.filter(item => item.kind.startsWith("tree-"))) {
      expect(compactTreeCover(tree.origin).some(cell => structures.has(cellKey(cell)))).toBe(false);
    }
  });

  it("decorates a low-rise apartment frontage without overlapping furniture footprints", () => {
    const footprint = rectangleFootprint({ x: 20, y: 20 }, 6, 3);
    const surfaces: SurfaceCellDto[] = Array.from({ length: 8 }, (_, index) => ({
      x: 19 + index, y: 23, kind: "PATH" as const, finish: "PAVERS" as const,
    }));
    const terrain: TerrainCellDto[] = rectangleFootprint({ x: 16, y: 16 }, 16, 16)
      .map((cell) => ({ ...cell, terrain: "GRASS" as const, variant: 0 }));
    const task: TaskDto = {
      id: "house", taskNumber: 38, cityId: "city", districtId: "district", title: "Дом", description: "", workItemType: "TASK",
      acceptanceCriteria: "", systemAnalysis: "", architecture: "", designSystem: "", implementationPlan: "",
      estimate: 2, priority: "NORMAL", status: "COMPLETED", progress: 100, dueAt: null,
      buildingType: "compact-row-v1", visualKind: "BUILDING", visualAssetKey: "compact-row-v1", platformType: "STONE",
      origin: { x: 20, y: 20 }, footprint, entrance: { x: 23, y: 23 }, accessPath: [{ x: 23, y: 23 }], accessKind: "PATH", stage: 5,
      createdAt: "now", updatedAt: "now", mergeRequests: [],
    };
    const decorations = generateWorldDecorations(88113, terrain, new Set(footprint.map(cellKey)), surfaces, [], [], [task])
      .filter((item) => item.id.startsWith("frontage:"));
    // A one-cell south frontage cannot fit a crown without hiding the facade.
    expect(decorations).toHaveLength(2);
    expect(decorations.some(item => item.kind === "courtyard-square-planter")).toBe(true);
    const structures = new Set([...footprint, ...task.accessPath].map(cellKey));
    for (const tree of decorations.filter(item => item.kind.startsWith("tree-"))) {
      expect(compactTreeCover(tree.origin).some(cell => structures.has(cellKey(cell)))).toBe(false);
    }
    const occupied = new Set<string>();
    for (const decoration of decorations) {
      const size = courtyardFurnitureFootprint(decoration.kind) ?? PROP_CATALOG[decoration.kind]!.footprint;
      for (const cell of rectangleFootprint(decoration.origin, size.width, size.height)) {
        expect(surfaces.some((surface) => cellKey(surface) === cellKey(cell))).toBe(true);
        expect(occupied.has(cellKey(cell))).toBe(false);
        occupied.add(cellKey(cell));
      }
    }
  });
});
