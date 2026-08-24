import { describe, expect, it } from "vitest";
import type { BuildingEventContext, RealtimeEvent } from "../src/shared/contracts";
import { presentRealtimeNotice } from "../src/shared/realtime-notifications";

const building: BuildingEventContext = {
  id: "task-42",
  taskNumber: 42,
  title: "Единый центр входящих запросов",
  visualKind: "BUILDING",
  status: "IN_PROGRESS",
  progress: 55,
  stage: 3,
  origin: { x: 144, y: -32 },
  country: { id: "country-atuta", name: "Атуталенд" },
  city: {
    id: "city-web",
    name: "Веб-версия",
    center: { x: 120, y: -20 },
    bounds: { minX: 40, minY: -100, maxX: 220, maxY: 70 },
  },
  district: { id: "district-core", name: "Личный кабинет" },
};

function event(type: string, payload: Record<string, unknown>): RealtimeEvent {
  return { id: 91, countryId: "country-atuta", type, worldVersion: 18, payload, createdAt: "2026-08-24T12:00:00.000Z" };
}

describe("realtime Tasktopia notification copy", () => {
  it("names the numbered building, construction stage, and full location", () => {
    expect(presentRealtimeNotice(event("task.status_changed", {
      taskId: building.id,
      status: "IN_PROGRESS",
      building,
    }))).toEqual({
      id: 91,
      title: "Здание №42 «Единый центр входящих запросов» перешло на этап «Строительство»",
      location: "Атуталенд · Веб-версия · Личный кабинет",
      tone: "info",
      actionLabel: "Открыть здание",
      target: building,
    });
  });

  it("uses explicit building language for creation, fields, defects, and completion", () => {
    expect(presentRealtimeNotice(event("task.created", { building }))?.title)
      .toBe("В районе «Личный кабинет» заложено здание №42 «Единый центр входящих запросов»");
    expect(presentRealtimeNotice(event("task.fields_updated", { building }))?.title)
      .toBe("У здания №42 «Единый центр входящих запросов» обновлены параметры строительства");
    expect(presentRealtimeNotice(event("task.fields_updated", { building, changedFields: ["implementationPlan"] }))?.title)
      .toBe("У здания №42 «Единый центр входящих запросов» обновлён план реализации");
    expect(presentRealtimeNotice(event("task.defect_created", { building }))?.title)
      .toBe("У здания №42 «Единый центр входящих запросов» зафиксирована неисправность");
    expect(presentRealtimeNotice(event("task.status_changed", {
      building: { ...building, status: "COMPLETED", progress: 100, stage: 5 },
      status: "COMPLETED",
    }))).toMatchObject({
      title: "Здание №42 «Единый центр входящих запросов» построено",
      tone: "success",
    });
  });

  it("does not revive generic task copy for comments or legacy events without context", () => {
    expect(presentRealtimeNotice(event("task.comment_added", { taskId: building.id }))).toBeNull();
    expect(presentRealtimeNotice(event("task.status_changed", { taskId: building.id, status: "IN_PROGRESS" }))).toBeNull();
  });

  it("keeps task-backed parks as canonical city parks", () => {
    const park = { ...building, visualKind: "PARK" as const, title: "Сад у набережной" };
    expect(presentRealtimeNotice(event("task.status_changed", { building: park, status: "IN_PROGRESS" }))).toMatchObject({
      title: "Парк №42 «Сад у набережной» перешёл на этап «Благоустройство»",
      actionLabel: "Открыть парк",
    });
    expect(presentRealtimeNotice(event("task.fields_updated", { building: park, changedFields: ["checklist"] }))?.title)
      .toContain("чек-лист благоустройства");
    expect(presentRealtimeNotice(event("task.fields_updated", { building: park, changedFields: ["documents"] }))?.title)
      .toContain("документы благоустройства");
    expect(presentRealtimeNotice(event("task.fields_updated", { building: park, changedFields: ["dependencies"] }))?.title)
      .toContain("связанные объекты");
  });
});
