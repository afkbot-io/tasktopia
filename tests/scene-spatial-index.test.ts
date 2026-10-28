import { describe, expect, it } from "vitest";
import type { DistrictDto, TaskDto, WorldFeatureDto } from "../src/shared/contracts";
import { createSceneSpatialIndex, type ViewportSpatialSnapshot } from "../src/server/world/scene-spatial-index";
import { buildSurfaceMap } from "../src/server/world/city-generation";
import { buildDecorationHardHalo } from "../src/server/world/decoration-halo";
import { contains } from "../src/server/world/grid";

const task = (id: string, x: number, y: number, access = [{ x, y: y + 1 }]) => ({
  id, taskNumber: Number(id) || 1, districtId: "district", visualKind: "BUILDING", stage: 5,
  footprint: [{ x, y }, { x: x + 1, y }], accessPath: access, accessKind: "PATH",
} as TaskDto);
const district = (tasks: TaskDto[]): DistrictDto => ({
  id: "district", cityId: "city", status: "ACTIVE", archetype: "NEW_BUILD",
  cells: tasks.flatMap(task => [...task.footprint, ...task.accessPath]),
  lots: tasks.map(task => ({ id: task.id, origin: task.footprint[0]!, width: 2, height: 1,
    taskId: task.id, groupId: "block", vacant: false, sharedAccess: task.accessPath })),
  blockPlaques: [{ id: "near", origin: { x: 63, y: -1 }, label: "1–2", taskCount: 2 }],
} as DistrictDto);
const snapshot = (tasks: TaskDto[]): ViewportSpatialSnapshot => ({
  roads: [{ x: -4, y: 0, mask: 5, structure: "ROAD", roadClass: "LOCAL" },
    { x: 63, y: -1, mask: 10, structure: "ROAD", roadClass: "LOCAL" },
    { x: 68, y: 0, mask: 5, structure: "ROAD", roadClass: "LOCAL" }],
  districts: [district(tasks)], cities: [], tasks, features: [], defectSummaryByTask: new Map(),
});

describe("whole-city spatial projection", () => {
  it("keeps crossing paths and negative chunk halos, with stable entity order", () => {
    const source = snapshot([task("1", -5, 2, [{ x: -4, y: 2 }]), task("2", 63, 0), task("3", 68, 0)]);
    const before = JSON.stringify(source);
    const index = createSceneSpatialIndex(source, { minChunkX: -1, minChunkY: -1, maxChunkX: 1, maxChunkY: 0 }, 64);
    const center = index.forChunk(0, 0);
    expect(center.tasks.map(task => task.id)).toEqual(["1", "2"]);
    expect(center.roads.map(cell => cell.x)).toEqual([-4, 63]);
    expect(center.districts[0]!.cells).toEqual(source.districts[0]!.cells.filter(cell => contains({ minX: -4, minY: -4, maxX: 67, maxY: 67 }, cell)));
    expect(center.districts[0]!.lots.map(lot => lot.id)).toEqual(["1", "2"]);
    expect(index.forChunk(-1, -1).tasks.map(task => task.id)).toEqual(["1"]);
    expect(index.forChunk(1, 0).tasks.map(task => task.id)).toEqual(["2", "3"]);
    expect(index.forChunk(4, 4).tasks).toEqual([]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("preserves road surfaces, shared access, reserved occupancy and seams against a full snapshot", () => {
    const source = snapshot([task("1", 62, -1), task("2", 65, -1), task("3", -2, 63), task("4", -1000, -1000)]);
    source.features = [{ id: "ruin", kind: "RUIN", footprint: [{ x: 63, y: 1 }], accessPath: [{ x: 63, y: 2 }] } as WorldFeatureDto];
    source.districts[0]!.lots.push({ id: "reserved", origin: { x: 62, y: 62 }, width: 8, height: 8,
      taskId: null, vacant: true, sharedAccess: [] } as DistrictDto["lots"][number]);
    const index = createSceneSpatialIndex(source, { minChunkX: -1, minChunkY: -1, maxChunkX: 1, maxChunkY: 1 }, 64);
    for (const [x, y] of [[-1, -1], [0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]] as const) {
      const chunkBounds = { minX: x * 64, minY: y * 64, maxX: x * 64 + 63, maxY: y * 64 + 63 };
      const scope = { minX: chunkBounds.minX - 4, minY: chunkBounds.minY - 4, maxX: chunkBounds.maxX + 4, maxY: chunkBounds.maxY + 4 };
      const reference = { ...source, roads: source.roads.filter(cell => contains(scope, cell)),
        districts: source.districts.flatMap(district => { const cells = district.cells.filter(cell => contains(scope, cell)); return cells.length ? [{ ...district, cells }] : []; }),
        tasks: source.tasks.filter(task => [...task.footprint, ...task.accessPath].some(cell => contains(scope, cell))),
        features: source.features.filter(feature => [...feature.footprint, ...feature.accessPath].some(cell => contains(scope, cell))),
      };
      const indexed = index.forChunk(x, y);
      const surfaces = (data: ViewportSpatialSnapshot) => [...buildSurfaceMap({ ...data,
        roads: new Map(data.roads.map(cell => [`${cell.x},${cell.y}`, cell])), isSurfaceTerrain: () => true,
      }).values()].filter(cell => contains(scope, cell)).sort((a, b) => a.y - b.y || a.x - b.x);
      const halo = (data: ViewportSpatialSnapshot) => buildDecorationHardHalo({ chunkBounds, surfaceScope: scope,
        ...data, reservedSites: data.districts.flatMap(district => district.lots) });
      expect(surfaces(indexed)).toEqual(surfaces(reference));
      expect(halo(indexed)).toEqual(halo(reference));
    }
  });

  it("bounds each page's district lots and entity candidates for a ten-thousand-task city", () => {
    const source = snapshot(Array.from({ length: 10_000 }, (_, i) => task(String(i + 1), i % 100 * 12, Math.floor(i / 100) * 12)));
    const index = createSceneSpatialIndex(source, { minChunkX: 0, minChunkY: 0, maxChunkX: 18, maxChunkY: 18 }, 64);
    const page = index.forChunk(8, 8);
    expect(page.tasks.length).toBeGreaterThan(0);
    expect(page.tasks.length).toBeLessThan(64);
    expect(page.districts[0]!.lots.length).toBeLessThan(64);
    expect(page.districts[0]!.cells.length).toBeLessThan(192);
    expect(source.tasks).toHaveLength(10_000);
  });
});
