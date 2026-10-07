import { describe, expect, it } from "vitest";
import { createCityEntityCollector } from "../src/client/city-entity-collector";
import type { ChunkDto, ChunkTaskDto } from "../src/shared/contracts";

function chunk(): ChunkDto {
  return { chunkX: 0, chunkY: 0, size: 32, worldVersion: 1, terrain: [], roads: [], surfaces: [],
    tasks: [{ id: "task", stage: 3 } as ChunkTaskDto], decorations: [], districts: [], worldFeatures: [] };
}
describe("immutable city entity collection", () => {
  it("reuses unchanged geometry but reflects patches, completed snapshots and evictions", () => {
    const collect = createCityEntityCollector(), first = chunk();
    const initial = collect([first], [], true);
    expect(initial.tasks.get("task")!.stage).toBe(3);
    expect(collect([first], [], true)).toBe(initial);
    const patched = { ...first, tasks: [{ ...first.tasks[0]!, stage: 4 as const }] };
    const next = collect([patched], [], true);
    expect(next).not.toBe(initial);
    expect(next.tasks.get("task")!.stage).toBe(4);
    expect(initial.tasks.get("task")!.stage).toBe(3);
    const completed = { ...patched.tasks[0]!, stage: 5 as const };
    expect(collect([patched], [completed], true).tasks.get("task")).toBe(completed);
    expect(collect([], [], true).tasks.size).toBe(0);
    expect(collect([first], [], true)).not.toBe(initial);
  });
  it("merges district cell fragments once and retains DETAIL-only sites and plaques", () => {
    const a = chunk(), b = { ...chunk(), chunkX: 1 };
    a.districts = [{ id: "district", name: "first", cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }] } as ChunkDto["districts"][number]];
    b.districts = [{ ...a.districts[0]!, name: "latest", cells: [{ x: 2, y: 1 }, { x: 3, y: 1 }] }];
    a.plannedSites = [{ id: "site" } as NonNullable<ChunkDto["plannedSites"]>[number]];
    a.blockPlaques = [{ id: "plaque" } as NonNullable<ChunkDto["blockPlaques"]>[number]];
    const collect = createCityEntityCollector();
    const detail = collect([a,b], [], true);
    expect(detail.districts.get("district")!.cells).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }]);
    expect(detail.districts.get("district")!.name).toBe("latest");
    expect(detail.plannedSites.size).toBe(1); expect(detail.blockPlaques.size).toBe(1);
    const overview = collect([a,b], [], false);
    expect(overview.plannedSites.size).toBe(0); expect(overview.blockPlaques.size).toBe(0);
    expect(a.districts[0]!.cells).toHaveLength(2);
  });
});
