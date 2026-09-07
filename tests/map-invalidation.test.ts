import { describe, expect, it } from "vitest";
import { eventInvalidation, mapInvalidationAffectsCity, mapInvalidationImpact } from "../src/client/map-invalidation";
import type { RealtimeEvent } from "../src/shared/contracts";

describe("airport realtime invalidation", () => {
  it("preserves the typed role needed to refresh routes without treating every task completion as infrastructure", () => {
    const event: RealtimeEvent = {
      id: 7, worldVersion: 12, countryId: "country", type: "task.status_changed", createdAt: "2026-09-05T00:00:00.000Z",
      payload: { taskId: "airport", stage: 5, status: "COMPLETED", progress: 100, groundChanged: false, serviceRole: "AIRPORT" },
    };
    expect(eventInvalidation(event)).toMatchObject({ serviceRole: "AIRPORT", stage: 5, groundChanged: false });
    expect(eventInvalidation({ ...event, payload: { ...event.payload, serviceRole: "invalid" } }).serviceRole).toBeUndefined();
    const ordinary = { ...event.payload }; delete ordinary.serviceRole;
    expect(eventInvalidation({ ...event, payload: ordinary }).serviceRole).toBeUndefined();
  });
});

describe("canonical road topology invalidation", () => {
  it("refreshes a retained other-city scene only for an explicit country-road change", () => {
    const event: RealtimeEvent = { countryId: "country", id: 8, worldVersion: 13, type: "task.created", createdAt: "2026-09-07",
      payload: { building: { city: { id: "b" } }, groundRoadTopologyChanged: true } };
    const invalidation = eventInvalidation(event);
    expect(invalidation).toMatchObject({ cityId: "b", groundRoadTopologyChanged: true });
    expect(mapInvalidationAffectsCity(invalidation, "a")).toBe(true);
    expect(mapInvalidationImpact(invalidation)).toBe("SCENE");
    for (const value of [false, undefined, "true"]) {
      const ordinary = eventInvalidation({ ...event, payload: { ...event.payload, groundRoadTopologyChanged: value } });
      expect(mapInvalidationAffectsCity(ordinary, "a")).toBe(false);
    }
  });
});
