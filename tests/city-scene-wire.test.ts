import { describe, expect, it } from "vitest";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import type { ChunkTaskDto } from "../src/shared/contracts";
import { acceptsCompactCityScene, CITY_SCENE_COMPACT_ACCEPT, decodeCitySceneWire, encodeCitySceneWire } from "../src/shared/city-scene-wire";

function fixture(): CitySceneDto {
  const task = { id: "task", taskNumber: 1, cityId: "city", districtId: "district", title: "Дом", stage: 5,
    visualKind: "BUILDING", footprint: Array.from({ length: 36 }, (_, n) => ({ x: -2 + n % 6, y: -1 + Math.floor(n / 6) })),
    accessPath: [{ x: 1, y: 5 }, { x: 1, y: 6 }, { x: 2, y: 6 }], origin: { x: -2, y: -1 },
  } as ChunkTaskDto;
  const contextTask = { id: task.id, taskNumber: task.taskNumber, visualKind: task.visualKind, stage: task.stage,
    footprint: task.footprint, accessPath: task.accessPath };
  const chunk = { payloadVersion: 2, chunkX: -1, chunkY: -1, size: 64, tasks: [task],
    decorationContext: { tasks: [contextTask] } } as CitySceneDto["chunks"][number];
  return { schemaVersion: 5, sceneRevision: "scene", city: { id: "city" }, chunks: [chunk, { ...chunk, chunkX: 0 }],
    completedDistrictSnapshots: [{ districtId: "complete", revision: "v1", tasks: [task] }],
  } as CitySceneDto;
}

describe("negotiated compact city transport", () => {
  it("requires an explicit supported encoding and respects a zero or invalid quality", () => {
    expect(acceptsCompactCityScene(CITY_SCENE_COMPACT_ACCEPT)).toBe(true);
    expect(acceptsCompactCityScene(`application/json, ${CITY_SCENE_COMPACT_ACCEPT}; q=0.9`)).toBe(true);
    for (const header of [undefined, "*/*", "application/json", `${CITY_SCENE_COMPACT_ACCEPT};q=0`, `${CITY_SCENE_COMPACT_ACCEPT};q=2`]) {
      expect(acceptsCompactCityScene(header)).toBe(false);
    }
  });
  it("round-trips exact negative geometry and arbitrary path order, transmitting every task only once", () => {
    const scene = fixture(), wire = encodeCitySceneWire(scene);
    const decoded = decodeCitySceneWire(JSON.parse(JSON.stringify(wire)));
    expect(decoded).toEqual(scene);
    expect(wire.taskTable).toHaveLength(1);
    expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(scene).length / 2);
    const task = decoded.chunks[0]!.tasks[0]!;
    expect(decoded.chunks[1]!.tasks[0]).toBe(task);
    expect(decoded.completedDistrictSnapshots[0]!.tasks[0]).toBe(task);
    expect(decoded.chunks[1]!.decorationContext.tasks[0]).toBe(decoded.chunks[0]!.decorationContext.tasks[0]);
    expect(decoded.chunks[0]!.decorationContext.tasks[0]!.footprint).toBe(task.footprint);
  });
  it("preserves non-rectangular and non-row-major footprints without inventing cells", () => {
    const scene = fixture();
    scene.chunks[0]!.tasks[0]!.footprint = [{ x: -5, y: 8 }, { x: -4, y: 9 }, { x: -5, y: 9 }];
    for (const chunk of scene.chunks) chunk.decorationContext.tasks[0]!.footprint = scene.chunks[0]!.tasks[0]!.footprint;
    expect(decodeCitySceneWire(JSON.parse(JSON.stringify(encodeCitySceneWire(scene))))).toEqual(scene);
  });
  it("accepts the full existing server response for application rollback", () => {
    const scene = fixture();
    expect(decodeCitySceneWire(scene)).toBe(scene);
  });
  it("rejects missing or out-of-range references, duplicate IDs and oversized expansion", () => {
    const wire = () => JSON.parse(JSON.stringify(encodeCitySceneWire(fixture())));
    for (const index of [-1, 1, 0.5, null, "0"]) {
      const value = wire(); value.chunks[0].tasks = [index];
      expect(() => decodeCitySceneWire(value)).toThrow();
    }
    const duplicate = wire(); duplicate.taskTable.push(duplicate.taskTable[0]);
    expect(() => decodeCitySceneWire(duplicate)).toThrow();
    const oversized = wire(); oversized.taskTable[0].footprint = { r: [0, 0, 1_000_000, 1_000_000] };
    expect(() => decodeCitySceneWire(oversized)).toThrow();
    const invalid = wire(); invalid.taskTable[0].accessPath = { p: [1, 2, 3] };
    expect(() => decodeCitySceneWire(invalid)).toThrow();
    expect(() => decodeCitySceneWire({ kind: "city.scene.compact", version: 100 })).toThrow();
  });
});
