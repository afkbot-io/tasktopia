import { describe, expect, it } from "vitest";
import { MAX_INCIDENT_ENGINES, incidentMode, incidentVisualProfile, planIncidentEngines } from "../src/client/task-incidents";
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
    expect(incidentMode(task({
      workItemType: "HOTFIX",
      status: "IN_PROGRESS",
      stage: 3,
      defectSummary: { open: 1, inProgress: 0, verifying: 0, active: 1 },
    }))).toBe("HOTFIX_ACTIVE");
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

describe("incidentVisualProfile", () => {
  it("increases smoke for every active defect up to the fire threshold", () => {
    const profiles = [1, 2, 3, 4, 5].map((active) => incidentVisualProfile(task({
      defectSummary: { open: active, inProgress: 0, verifying: 0, active },
    })));

    expect(profiles.map((profile) => profile.smokeStrength)).toEqual([1, 2, 3, 4, 5]);
    expect(profiles.map((profile) => profile.plumeCount)).toEqual([1, 1, 2, 2, 3]);
    expect(profiles.every((profile) => !profile.burning)).toBe(true);
  });

  it("turns six or more active defects into a fire and caps visual density", () => {
    const six = incidentVisualProfile(task({ defectSummary: { open: 6, inProgress: 0, verifying: 0, active: 6 } }));
    const many = incidentVisualProfile(task({ defectSummary: { open: 30, inProgress: 0, verifying: 0, active: 30 } }));

    expect(six).toMatchObject({ activeDefects: 6, smokeStrength: 6, plumeCount: 3, burning: true });
    expect(many).toMatchObject({ activeDefects: 30, smokeStrength: 6, plumeCount: 3, burning: true });
  });

  it("keeps an active hotfix burning even before a linked defect is recorded", () => {
    expect(incidentVisualProfile(task({ workItemType: "HOTFIX", status: "IN_PROGRESS", defectSummary: undefined })))
      .toMatchObject({ activeDefects: 0, smokeStrength: 6, plumeCount: 3, burning: true });
  });

  it("stays quiet without active defects or an active hotfix", () => {
    expect(incidentVisualProfile(task())).toEqual({ activeDefects: 0, smokeStrength: 0, plumeCount: 0, burning: false });
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

  it("always sends an engine to a burning building before smoke-only reports", () => {
    const incidents = [
      { id: "alpha", mode: "DEFECT_REPORTED" as const, smokeStrength: 2, burning: false },
      { id: "beta", mode: "DEFECT_REPORTED" as const, smokeStrength: 3, burning: false },
      { id: "gamma", mode: "DEFECT_REPORTED" as const, smokeStrength: 4, burning: false },
      { id: "zeta-fire", mode: "DEFECT_REPORTED" as const, smokeStrength: 6, burning: true },
    ];

    const allowance = planIncidentEngines(incidents);
    expect(allowance.has("zeta-fire")).toBe(true);
    expect(allowance.has("alpha")).toBe(false);
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
