import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "../src/shared/contracts";
import { pushPayloadForEvent } from "../src/server/push-delivery";

function event(countryId: string, taskId: string): RealtimeEvent {
  return { id: 19, countryId, type: "task.created", worldVersion: 1, createdAt: "2026-09-05T10:00:00Z", payload: {
    building: { id: taskId, taskNumber: 7, title: "Task", visualKind: "BUILDING", status: "PLANNING", progress: 0, stage: 1,
      origin: { x: 4, y: 4 }, country: { id: countryId, name: "Country" },
      city: { id: "city", name: "City", center: { x: 0, y: 0 }, bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 } },
      district: { id: "district", name: "District" } },
  } };
}

describe("unambiguous notification task links", () => {
  it("keeps explicit country and canonical task IDs when task numbers repeat across countries", () => {
    const a = pushPayloadForEvent(event("country-a", "task-a"))!, b = pushPayloadForEvent(event("country-b", "task-b"))!;
    expect(a.url).toBe("/task/7?countryId=country-a&taskId=task-a");
    expect(b.url).toBe("/task/7?countryId=country-b&taskId=task-b");
  });
  it("encodes context values rather than allowing query injection", () => {
    const url = new URL(pushPayloadForEvent(event("country&a=x", "task#fragment"))!.url, "https://tasktopia.test");
    expect(url.searchParams.get("countryId")).toBe("country&a=x");
    expect(url.searchParams.get("taskId")).toBe("task#fragment");
    expect(url.hash).toBe("");
  });
  it("does not link a demolished building back to a deleted task", () => {
    expect(pushPayloadForEvent({ ...event("country-a", "task-a"), type: "task.deleted" })!.url).toBe("/");
  });
  it("never falls back to an ambiguous task number from incomplete historical identity", () => {
    for (const input of [event("country-a", ""), event("", "task-a"),
      { ...event("other-country", "task-a"), countryId: "country-a" }]) {
      expect(pushPayloadForEvent(input)!.url).toBe("/");
    }
  });
});
