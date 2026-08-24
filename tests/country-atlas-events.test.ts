import { describe, expect, it } from "vitest";
import { countryAtlasEventBatchImpact, countryAtlasEventImpact, enqueueCountryAtlasEvent, patchCountryAtlasTaskProgress } from "../src/shared/country-atlas-events";
import type { CountryAtlasDto } from "../src/shared/country-atlas-contract";
import type { RealtimeEvent } from "../src/shared/contracts";

function event(type: string, payload: Record<string, unknown> = {}): RealtimeEvent {
  return { id: 9, countryId: "country", type, worldVersion: 12, payload, createdAt: "2026-08-24T00:00:00.000Z" };
}

const atlas: CountryAtlasDto = {
  schemaVersion: 5,
  worldVersion: 8,
  terrainSeed: 777,
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
  connections: [],
  cities: [{
    id: "city", name: "City", status: "ACTIVE", sourceCenter: { x: 0, y: 0 },
    sourceBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, atlasCenter: { x: 10, y: 10 },
    atlasBounds: { minX: 5, minY: 5, maxX: 15, maxY: 15 },
    labelBounds: { minX: 6, minY: 1, maxX: 14, maxY: 4 }, labelAnchor: { x: 10, y: 5 },
    scale: 0.5, miniatureSizePx: { width: 80, height: 80 }, atlasMask: [], cutoutMask: [], roads: [], surfaces: [], features: [],
    districts: [{
      id: "district", name: "District", status: "ACTIVE", color: "#fff", progress: 25,
      sourceCenter: { x: 0, y: 0 }, sourceBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      atlasCenter: { x: 10, y: 10 }, atlasCells: [], displayCells: [],
    }],
    buildings: [
      { id: "task-a", taskNumber: 1, districtId: "district", title: "A", workItemType: "TASK", status: "IN_PROGRESS", progress: 50, stage: 3, buildingType: "house-brick", visualKind: "BUILDING", visualAssetKey: "house-brick", platformType: "STONE", sourceOrigin: { x: 0, y: 0 }, atlasOrigin: { x: 10, y: 10 }, atlasFootprint: [] },
      { id: "task-b", taskNumber: 2, districtId: "district", title: "B", workItemType: "TASK", status: "PLANNING", progress: 0, stage: 1, buildingType: "house-brick", visualKind: "BUILDING", visualAssetKey: "house-brick", platformType: "STONE", sourceOrigin: { x: 1, y: 0 }, atlasOrigin: { x: 11, y: 10 }, atlasFootprint: [] },
    ],
  }],
};

describe("country atlas event policy", () => {
  it("rebuilds only for structural mutations", () => {
    expect(countryAtlasEventImpact(event("city.created"))).toBe("STRUCTURE");
    expect(countryAtlasEventImpact(event("district.renamed"))).toBe("STRUCTURE");
    expect(countryAtlasEventImpact(event("task.created"))).toBe("STRUCTURE");
    expect(countryAtlasEventImpact(event("task.renamed"))).toBe("STRUCTURE");
    expect(countryAtlasEventImpact(event("task.comment_added"))).toBe("NONE");
    expect(countryAtlasEventImpact(event("task.fields_updated", { changedFields: ["documents"] }))).toBe("NONE");
    expect(countryAtlasEventImpact(event("task.fields_updated", { changedFields: ["priority"] }))).toBe("STRUCTURE");
    expect(countryAtlasEventImpact(event("task.status_changed", { groundChanged: false }))).toBe("TASK_PROGRESS");
    expect(countryAtlasEventImpact(event("task.status_changed", { groundChanged: true }))).toBe("STRUCTURE");
  });

  it("patches one building and recomputes its district progress without a rebuild", () => {
    const updated = patchCountryAtlasTaskProgress(atlas, event("task.status_changed", {
      taskId: "task-b", status: "COMPLETED", progress: 100, stage: 5, groundChanged: false,
    }));
    expect(updated.worldVersion).toBe(12);
    expect(updated.cities[0]!.buildings[1]).toMatchObject({ status: "COMPLETED", progress: 100, stage: 5 });
    expect(updated.cities[0]!.districts[0]!.progress).toBe(75);
  });

  it("keeps every progress event in a replay batch and lets structure dominate", () => {
    const first = event("task.status_changed", {
      taskId: "task-a", status: "IN_PROGRESS", progress: 80, stage: 4, groundChanged: false,
    });
    const second = { ...event("task.status_changed", {
      taskId: "task-b", status: "COMPLETED", progress: 100, stage: 5, groundChanged: false,
    }), id: 10, worldVersion: 13 };
    expect(countryAtlasEventBatchImpact([first, second])).toBe("TASK_PROGRESS");
    const updated = [first, second].reduce((snapshot, item) => patchCountryAtlasTaskProgress(snapshot, item), atlas);
    expect(updated.cities[0]!.buildings.map((building) => building.progress)).toEqual([80, 100]);
    expect(updated.cities[0]!.districts[0]!.progress).toBe(90);
    expect(countryAtlasEventBatchImpact([first, event("city.created")])).toBe("STRUCTURE");
  });

  it("compacts irrelevant and repeated events while preserving a pending structure reload", () => {
    const structure = event("district.created");
    const first = event("task.status_changed", {
      taskId: "task-a", status: "IN_PROGRESS", progress: 40, stage: 2, groundChanged: false,
    });
    const latest = { ...first, id: 11, worldVersion: 14, payload: { ...first.payload, progress: 80, stage: 4 } };
    let queued = enqueueCountryAtlasEvent([], event("task.comment_added"));
    expect(queued).toEqual([]);
    queued = enqueueCountryAtlasEvent(queued, structure);
    queued = enqueueCountryAtlasEvent(queued, first);
    queued = enqueueCountryAtlasEvent(queued, latest);
    expect(queued).toEqual([structure, latest]);
    expect(enqueueCountryAtlasEvent(queued, event("city.created"))).toEqual([event("city.created")]);
  });
});
