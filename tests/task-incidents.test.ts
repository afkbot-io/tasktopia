import { describe, expect, it } from "vitest";
import { incidentMode } from "../src/client/task-incidents";
import type { ChunkTaskDto } from "../src/shared/contracts";

function task(overrides: Partial<ChunkTaskDto> = {}): ChunkTaskDto {
  return {
    id: "task-1",
    cityId: "city-1",
    districtId: "district-1",
    title: "Проверить оплату",
    workItemType: "TASK",
    status: "TESTING",
    progress: 90,
    stage: 4,
    buildingType: "house-small-a",
    platformType: "YARD",
    origin: { x: 10, y: 10 },
    footprint: [{ x: 10, y: 10 }],
    ...overrides,
  };
}

describe("incidentMode", () => {
  it("keeps an ordinary task quiet when there are no active defects", () => {
    expect(incidentMode(task())).toBe("NONE");
  });

  it("shows the linked-defect lifecycle without changing the parent task stage", () => {
    expect(incidentMode(task({ defectSummary: { open: 1, inProgress: 0, verifying: 0, active: 1 } }))).toBe("DEFECT_REPORTED");
    expect(incidentMode(task({ defectSummary: { open: 0, inProgress: 1, verifying: 0, active: 1 } }))).toBe("DEFECT_REPAIRING");
    expect(incidentMode(task({ defectSummary: { open: 0, inProgress: 0, verifying: 1, active: 1 } }))).toBe("DEFECT_VERIFYING");
  });

  it("gives an active hotfix the emergency visual and hides it after completion", () => {
    expect(incidentMode(task({ workItemType: "HOTFIX", status: "IN_PROGRESS", stage: 3 }))).toBe("HOTFIX_ACTIVE");
    expect(incidentMode(task({ workItemType: "HOTFIX", status: "COMPLETED", progress: 100, stage: 5 }))).toBe("NONE");
  });

  it("still highlights a reopened linked defect on a completed task", () => {
    expect(incidentMode(task({
      status: "COMPLETED",
      progress: 100,
      stage: 5,
      defectSummary: { open: 1, inProgress: 0, verifying: 0, active: 1 },
    }))).toBe("DEFECT_REPORTED");
  });
});
