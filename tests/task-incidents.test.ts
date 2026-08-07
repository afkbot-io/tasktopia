import { describe, expect, it } from "vitest";
import { MAX_INCIDENT_ENGINES, incidentMode, planIncidentEngines } from "../src/client/task-incidents";
import type { ChunkTaskDto } from "../src/shared/contracts";

function task(overrides: Partial<ChunkTaskDto> = {}): ChunkTaskDto {
  return {
    id: "task-1",
    taskNumber: 1,
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

describe("planIncidentEngines", () => {
  it("caps the visible fire engines and lets the rest degrade to a roof alarm", () => {
    const incidents = ["a", "b", "c", "d", "e"].map((id) => ({ id, mode: "DEFECT_REPORTED" as const }));
    const allowance = planIncidentEngines(incidents);
    expect(allowance.size).toBe(MAX_INCIDENT_ENGINES);
  });

  it("keeps every engine when incidents fit under the cap", () => {
    const incidents = [
      { id: "a", mode: "DEFECT_REPORTED" as const },
      { id: "b", mode: "HOTFIX_ACTIVE" as const },
    ];
    expect(planIncidentEngines(incidents)).toEqual(new Set(["a", "b"]));
  });

  it("prioritises active emergencies over open reports", () => {
    const incidents = [
      { id: "report-1", mode: "DEFECT_REPORTED" as const },
      { id: "report-2", mode: "DEFECT_REPORTED" as const },
      { id: "report-3", mode: "DEFECT_REPORTED" as const },
      { id: "report-4", mode: "DEFECT_REPORTED" as const },
      { id: "hotfix", mode: "HOTFIX_ACTIVE" as const },
      { id: "repair", mode: "DEFECT_REPAIRING" as const },
    ];
    const allowance = planIncidentEngines(incidents);
    expect(allowance.has("hotfix")).toBe(true);
    expect(allowance.has("repair")).toBe(true);
    expect(allowance.size).toBe(MAX_INCIDENT_ENGINES);
    expect([...allowance].filter((id) => id.startsWith("report-")).length).toBe(1);
  });

  it("is deterministic for ties so overlays do not flicker between frames", () => {
    const incidents = [
      { id: "zeta", mode: "DEFECT_REPORTED" as const },
      { id: "alpha", mode: "DEFECT_REPORTED" as const },
      { id: "mid", mode: "DEFECT_REPORTED" as const },
      { id: "beta", mode: "DEFECT_REPORTED" as const },
    ];
    expect(planIncidentEngines(incidents)).toEqual(planIncidentEngines([...incidents].reverse()));
  });
});
