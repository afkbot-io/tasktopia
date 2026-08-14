import { describe, expect, it } from "vitest";
import { patchChunkPayloadTaskStatuses, patchChunkTaskStatuses, type ChunkTaskStatusPatch } from "../src/client/chunk-task-patches";
import type { ChunkDto, ChunkPayloadDto, ChunkTaskDto } from "../src/shared/contracts";

function task(): ChunkTaskDto {
  return {
    id: "task-1", taskNumber: 1, cityId: "city-1", districtId: "district-1", title: "Task",
    workItemType: "TASK", status: "PLANNING", progress: 0, stage: 1,
    buildingType: "HOUSE", visualKind: "BUILDING", visualAssetKey: "house-bungalow",
    platformType: "YARD", origin: { x: 1, y: 1 }, footprint: [{ x: 1, y: 1 }], accessPath: [],
  };
}

function chunk(): ChunkDto {
  return {
    chunkX: 0, chunkY: 0, size: 64, terrain: [], roads: [], surfaces: [], districts: [],
    tasks: [task()], decorations: [], worldFeatures: [], worldVersion: 1,
  };
}

function payload(): ChunkPayloadDto {
  return {
    payloadVersion: 1, contentHash: "hash", generatorVersion: "square-v7", terrainSeed: 1,
    publishedVersion: 1, lod: "DETAIL", chunkX: 1, chunkY: 0, size: 64,
    roads: [], surfaces: [], districts: [], tasks: [], worldFeatures: [],
    decorationContext: {
      cityBounds: [], districts: [],
      tasks: [{
        id: "task-1", taskNumber: 1, visualKind: "BUILDING", stage: 2,
        footprint: [{ x: 63, y: 1 }], accessPath: [{ x: 64, y: 1 }],
      }],
    },
  };
}

describe("patchChunkTaskStatuses", () => {
  it("overlays a realtime status on a stale worker result", () => {
    const stale = chunk();
    const patched = patchChunkTaskStatuses(stale, new Map([[
      "task-1", { status: "IN_PROGRESS", progress: 55, stage: 3, worldVersion: 2 },
    ]]));

    expect(patched).toMatchObject({ worldVersion: 2 });
    expect(patched.tasks[0]).toMatchObject({ status: "IN_PROGRESS", progress: 55, stage: 3 });
    expect(stale.tasks[0]).toMatchObject({ status: "PLANNING", progress: 0, stage: 1 });
  });

  it("preserves identity when no task needs patching", () => {
    const current = chunk();
    expect(patchChunkTaskStatuses(current, new Map())).toBe(current);
  });

  it("reapplies newer events before commit and publish but ignores retained stale patches", () => {
    const patches = new Map<string, ChunkTaskStatusPatch>();
    const afterWorker = patchChunkTaskStatuses(chunk(), patches);
    patches.set("task-1", { status: "STARTED", progress: 10, stage: 2, worldVersion: 2 });
    const beforeCommit = patchChunkTaskStatuses(afterWorker, patches);
    patches.set("task-1", { status: "TESTING", progress: 90, stage: 4, worldVersion: 3 });
    const beforePublish = patchChunkTaskStatuses(beforeCommit, patches);

    expect(beforeCommit.tasks[0]).toMatchObject({ status: "STARTED", stage: 2 });
    expect(beforePublish).toMatchObject({ worldVersion: 3 });
    expect(beforePublish.tasks[0]).toMatchObject({ status: "TESTING", progress: 90, stage: 4 });
    patches.set("task-1", { status: "PLANNING", progress: 0, stage: 1, worldVersion: 2 });
    expect(patchChunkTaskStatuses(beforePublish, patches)).toBe(beforePublish);
  });

  it("patches a neighbouring decoration context before worker materialization", () => {
    const current = payload();
    const patched = patchChunkPayloadTaskStatuses(current, new Map([[
      "task-1", { status: "IN_PROGRESS", progress: 50, stage: 3, worldVersion: 2 },
    ]]));

    expect(patched).toMatchObject({ publishedVersion: 2 });
    expect(patched.decorationContext.tasks[0]).toMatchObject({ id: "task-1", stage: 3 });
    expect(current.decorationContext.tasks[0]).toMatchObject({ stage: 2 });
  });

  it("does not let a retained patch overwrite a newer payload context", () => {
    const current = { ...payload(), publishedVersion: 3 };
    expect(patchChunkPayloadTaskStatuses(current, new Map([[
      "task-1", { status: "IN_PROGRESS", progress: 50, stage: 3, worldVersion: 2 },
    ]]))).toBe(current);
  });
});
