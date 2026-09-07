import { describe, expect, it } from "vitest";
import { MAX_INCIDENT_ENGINES, incidentMode, incidentRenderSignature, incidentVisualLayout, incidentVisualProfile, incidentWaterJetFrame, incidentWaterTargetFrame, planIncidentEngines } from "../src/client/task-incidents";
import type { ChunkTaskDto } from "../src/shared/contracts";

function task(overrides: Partial<ChunkTaskDto> = {}): ChunkTaskDto {
  return {
    id: "task-1", taskNumber: 1, cityId: "city-1", districtId: "district-1",
    title: "Проверить оплату", workItemType: "TASK", status: "TESTING", progress: 90,
    stage: 4, buildingType: "compact-wide-v1", visualKind: "BUILDING",
    visualAssetKey: "compact-wide-v1", platformType: "YARD", origin: { x: 10, y: 10 },
    footprint: [{ x: 10, y: 10 }], accessPath: [], ...overrides,
  };
}
const defects = (open: number, inProgress = 0, verifying = 0) => ({ open, inProgress, verifying, active: open + inProgress + verifying });

describe("compact incident lifecycle", () => {
  it("keeps ordinary tasks quiet, but shows a BUG's own lifecycle", () => {
    expect(incidentMode(task())).toBe("NONE");
    for (const [status, mode] of [["PLANNING", "DEFECT_REPORTED"], ["STARTED", "DEFECT_REPAIRING"], ["IN_PROGRESS", "DEFECT_REPAIRING"], ["TESTING", "DEFECT_VERIFYING"], ["COMPLETED", "NONE"]] as const) {
      expect(incidentMode(task({ workItemType: "BUG", status }))).toBe(mode);
    }
  });
  it("distinguishes queued, active and verifying HOTFIX", () => {
    for (const [status, mode, burning] of [["PLANNING", "HOTFIX_QUEUED", false], ["STARTED", "HOTFIX_ACTIVE", true], ["IN_PROGRESS", "HOTFIX_ACTIVE", true], ["TESTING", "HOTFIX_VERIFYING", false], ["COMPLETED", "NONE", false]] as const) {
      const item = task({ workItemType: "HOTFIX", status });
      expect(incidentMode(item)).toBe(mode);
      expect(incidentVisualProfile(item).burning).toBe(burning);
    }
  });
  it("prioritizes unresolved defects and shows reopened issues after completion", () => {
    expect(incidentMode(task({ defectSummary: defects(1, 0, 8) }))).toBe("DEFECT_REPORTED");
    expect(incidentMode(task({ defectSummary: defects(1, 1, 8) }))).toBe("DEFECT_REPAIRING");
    expect(incidentMode(task({ status: "COMPLETED", stage: 5, defectSummary: defects(1) }))).toBe("DEFECT_REPORTED");
    expect(incidentMode(task({ defectSummary: defects(0, 0, 30) }))).toBe("DEFECT_VERIFYING");
    expect(incidentVisualProfile(task({ defectSummary: defects(0, 0, 30) })))
      .toEqual({ activeDefects: 30, smokeStrength: 0, plumeCount: 0, burning: false });
  });
  it("does not mutate stages or paint a fire over a fence, foundation or park", () => {
    for (const change of [{ stage: 1 }, { stage: 2 }, { visualKind: "PARK" }] as const) {
      const item = task({ workItemType: "HOTFIX", status: "IN_PROGRESS", ...change });
      const before = structuredClone(item);
      expect(incidentMode(item)).toBe("HOTFIX_ACTIVE");
      expect(incidentVisualProfile(item)).toMatchObject({ smokeStrength: 0, plumeCount: 0, burning: false });
      expect(item).toEqual(before);
    }
  });
  it("counts only unresolved issues toward fire; caps visuals, not recorded counts", () => {
    expect(incidentVisualProfile(task({ defectSummary: defects(1, 0, 50) })))
      .toMatchObject({ activeDefects: 51, smokeStrength: 1, plumeCount: 1, burning: false });
    expect(incidentVisualProfile(task({ defectSummary: defects(3) }))).toMatchObject({ plumeCount: 2, burning: false });
    expect(incidentVisualProfile(task({ defectSummary: defects(60) })))
      .toMatchObject({ activeDefects: 60, smokeStrength: 6, plumeCount: 2, burning: true });
  });
});

describe("compact native effect registration", () => {
  it.each([24, 32, 48])("fits complete effects inside a 48×%i native building", (height) => {
    const bounds = { left: 1, top: 2, right: 47, bottom: height };
    const layout = incidentVisualLayout(48, height, incidentVisualProfile(task({ defectSummary: defects(6) })), bounds);
    expect(layout.flameAnchors).toHaveLength(2);
    expect(layout.smokeAnchors).toHaveLength(2);
    for (const { x, y } of [...layout.flameAnchors, ...layout.smokeAnchors]) {
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(x - 2).toBeGreaterThanOrEqual(bounds.left - 24);
      expect(x + 3).toBeLessThanOrEqual(bounds.right - 24);
      expect(y - 5).toBeGreaterThanOrEqual(bounds.top - height);
      expect(y).toBeLessThanOrEqual(-5);
    }
  });
  it("has no flame in smoke-only state and no lingering effect after resolving", () => {
    expect(incidentVisualLayout(48, 32, incidentVisualProfile(task({ defectSummary: defects(3) })))).toMatchObject({ flameAnchors: [] });
    expect(incidentVisualLayout(48, 32, incidentVisualProfile(task()))).toEqual({ flameAnchors: [], smokeAnchors: [] });
  });
  it("reconciles stage, status, footprint, visual kind, position and response", () => {
    const original = task({ defectSummary: defects(6) });
    const signature = incidentRenderSignature(original, true);
    const updates: Partial<ChunkTaskDto>[] = [{ stage: 3 }, { status: "COMPLETED" }, { visualKind: "PARK" }, { origin: { x: 11, y: 10 } }, { footprint: [{ x: 11, y: 10 }] }];
    for (const update of updates) expect(incidentRenderSignature(task({ ...original, ...update }), true)).not.toBe(signature);
    expect(incidentRenderSignature(original, false)).not.toBe(signature);
  });
  it("reconciles TASK to BUG even when the incident mode stays reported", () => {
    const original = task({ status: "PLANNING", defectSummary: defects(2) });
    const changed = task({ ...original, workItemType: "BUG" });
    expect(incidentMode(changed)).toBe(incidentMode(original));
    expect(incidentVisualProfile(changed).plumeCount).not.toBe(incidentVisualProfile(original).plumeCount);
    expect(incidentRenderSignature(changed, false)).not.toBe(incidentRenderSignature(original, false));
  });
});

describe("compact fire response", () => {
  it("dispatches only to fires and caps deterministic emergency response", () => {
    const reports = ["r1", "r2"].map((id) => ({ id, mode: "DEFECT_REPORTED" as const, burning: false }));
    expect(planIncidentEngines(reports).size).toBe(0);
    const fires = ["e", "d", "c", "b", "a"].map((id) => ({ id, mode: "DEFECT_REPAIRING" as const, burning: true, smokeStrength: 6 }));
    const items = [...reports, ...fires, { id: "hotfix", mode: "HOTFIX_ACTIVE" as const, burning: true }];
    expect([...planIncidentEngines(items)]).toEqual(["hotfix", "a", "b"]);
    expect(planIncidentEngines(items).size).toBe(MAX_INCIDENT_ENGINES);
    expect(planIncidentEngines([...items].reverse())).toEqual(planIncidentEngines(items));
  });
  it("uses a continuous one-pixel hose, stable endpoints and bounded spray", () => {
    const source = { x: 28, y: -4 }; const target = { x: -10, y: -18 };
    const first = incidentWaterJetFrame(source, target, 0, 9);
    const second = incidentWaterJetFrame(source, target, 240, 9);
    expect(first.core[0]).toEqual({ ...source, size: 1 });
    expect(first.core.at(-1)).toEqual({ ...target, size: 1 });
    expect(first.core.every(({ size }) => size === 1)).toBe(true);
    expect(first.core.length).toBeLessThanOrEqual(65);
    for (let index = 1; index < first.core.length; index++) {
      expect(Math.abs(first.core[index]!.x - first.core[index - 1]!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(first.core[index]!.y - first.core[index - 1]!.y)).toBeLessThanOrEqual(1);
    }
    expect(first.spray.every(({ x, y, size }) => Math.abs(x - target.x) <= 2 && Math.abs(y - target.y) <= 2 && size === 1)).toBe(true);
    expect(second.core).toEqual(first.core);
    expect(second.highlights).not.toEqual(first.highlights);
  });
  it("holds and pixel-aligns turns between targets; has no target when resolved", () => {
    const targets = [{ x: -10, y: -18 }, { x: 10, y: -18 }];
    expect(incidentWaterTargetFrame([], 200)).toBeUndefined();
    expect(incidentWaterTargetFrame(targets, 600)).toEqual({ index: 0, target: targets[0] });
    expect(incidentWaterTargetFrame(targets, 1760)).toEqual({ index: 1, target: { x: 0, y: -18 } });
    expect(incidentWaterTargetFrame(targets, 2000)).toEqual({ index: 1, target: targets[1] });
    expect(incidentWaterTargetFrame([targets[0]!], 9999)).toEqual({ index: 0, target: targets[0] });
  });
});
