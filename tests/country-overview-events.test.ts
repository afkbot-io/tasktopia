import { describe, expect, it } from "vitest";
import {
  countryOverviewEventBatchImpact,
  countryOverviewEventImpact,
  enqueueCountryOverviewEvent,
} from "../src/shared/country-overview-events";
import type { RealtimeEvent } from "../src/shared/contracts";

function event(type: string, payload: Record<string, unknown> = {}): RealtimeEvent {
  return { id: 9, countryId: "country", type, worldVersion: 12, payload, createdAt: "2026-08-24T00:00:00.000Z" };
}

describe("country atlas event policy", () => {
  it("rebuilds only for structural mutations", () => {
    expect(countryOverviewEventImpact(event("city.created"))).toBe("STRUCTURE");
    expect(countryOverviewEventImpact(event("district.renamed"))).toBe("STRUCTURE");
    expect(countryOverviewEventImpact(event("task.created"))).toBe("STRUCTURE");
    expect(countryOverviewEventImpact(event("task.renamed"))).toBe("STRUCTURE");
    expect(countryOverviewEventImpact(event("task.comment_added"))).toBe("NONE");
    expect(countryOverviewEventImpact(event("task.fields_updated", { changedFields: ["documents"] }))).toBe("NONE");
    expect(countryOverviewEventImpact(event("task.fields_updated", { changedFields: ["priority"] }))).toBe("STRUCTURE");
    expect(countryOverviewEventImpact(event("task.status_changed", { groundChanged: false }))).toBe("TASK_PROGRESS");
    expect(countryOverviewEventImpact(event("task.status_changed", { groundChanged: true }))).toBe("STRUCTURE");
  });

  it("keeps every progress event in a replay batch and lets structure dominate", () => {
    const first = event("task.status_changed", {
      taskId: "task-a", status: "IN_PROGRESS", progress: 80, stage: 4, groundChanged: false,
    });
    const second = { ...event("task.status_changed", {
      taskId: "task-b", status: "COMPLETED", progress: 100, stage: 5, groundChanged: false,
    }), id: 10, worldVersion: 13 };
    expect(countryOverviewEventBatchImpact([first, second])).toBe("TASK_PROGRESS");
    expect(countryOverviewEventBatchImpact([first, event("city.created")])).toBe("STRUCTURE");
  });

  it("compacts irrelevant and repeated events while preserving a pending structure reload", () => {
    const structure = event("district.created");
    const first = event("task.status_changed", {
      taskId: "task-a", status: "IN_PROGRESS", progress: 40, stage: 2, groundChanged: false,
    });
    const latest = { ...first, id: 11, worldVersion: 14, payload: { ...first.payload, progress: 80, stage: 4 } };
    let queued = enqueueCountryOverviewEvent([], event("task.comment_added"));
    expect(queued).toEqual([]);
    queued = enqueueCountryOverviewEvent(queued, structure);
    queued = enqueueCountryOverviewEvent(queued, first);
    queued = enqueueCountryOverviewEvent(queued, latest);
    expect(queued).toEqual([structure, latest]);
    expect(enqueueCountryOverviewEvent(queued, event("city.created"))).toEqual([event("city.created")]);
  });
});
