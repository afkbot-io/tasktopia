import type { ChunkTaskDto } from "../shared/contracts";

export type IncidentMode = "NONE" | "DEFECT_REPORTED" | "DEFECT_REPAIRING" | "DEFECT_VERIFYING" | "HOTFIX_ACTIVE";
export type IncidentVisualProfile = {
  activeDefects: number;
  /** 0 = quiet, 1..5 = progressively denser smoke, 6 = saturated smoke/fire. */
  smokeStrength: number;
  plumeCount: number;
  burning: boolean;
};

export function incidentMode(task: Pick<ChunkTaskDto, "workItemType" | "status" | "defectSummary">): IncidentMode {
  if (task.workItemType === "HOTFIX" && task.status !== "PLANNING" && task.status !== "COMPLETED") return "HOTFIX_ACTIVE";
  const defects = task.defectSummary;
  if (defects?.inProgress) return "DEFECT_REPAIRING";
  if (defects?.verifying) return "DEFECT_VERIFYING";
  if (defects?.open) return "DEFECT_REPORTED";
  return "NONE";
}

export function incidentVisualProfile(
  task: Pick<ChunkTaskDto, "workItemType" | "status" | "defectSummary">,
): IncidentVisualProfile {
  const defects = task.defectSummary;
  const activeDefects = defects
    ? Math.max(0, defects.active, defects.open + defects.inProgress + defects.verifying)
    : 0;
  const activeHotfix = task.workItemType === "HOTFIX" && task.status !== "PLANNING" && task.status !== "COMPLETED";
  if (activeDefects === 0 && !activeHotfix) {
    return { activeDefects: 0, smokeStrength: 0, plumeCount: 0, burning: false };
  }

  const smokeStrength = activeHotfix ? 6 : Math.min(activeDefects, 6);
  return {
    activeDefects,
    smokeStrength,
    plumeCount: smokeStrength >= 5 ? 3 : smokeStrength >= 3 ? 2 : 1,
    burning: activeHotfix || activeDefects > 5,
  };
}

/**
 * A whole fire crew per open defect turns a buggy release into a fire
 * station parade (the screenshot incident: eight engines in one row). At
 * most three full engine overlays are visible at once; the rest degrade to
 * a compact pulsing roof alarm. Active emergencies always outrank mere
 * reports.
 */
export const MAX_INCIDENT_ENGINES = 3;

const ENGINE_PRIORITY: Record<Exclude<IncidentMode, "NONE">, number> = {
  HOTFIX_ACTIVE: 0,
  DEFECT_REPAIRING: 1,
  DEFECT_VERIFYING: 2,
  DEFECT_REPORTED: 3,
};

export function planIncidentEngines(incidents: ReadonlyArray<{
  id: string;
  mode: Exclude<IncidentMode, "NONE">;
  burning?: boolean;
  smokeStrength?: number;
}>): Set<string> {
  const ranked = [...incidents].sort((left, right) =>
    Number(Boolean(right.burning)) - Number(Boolean(left.burning))
    || ENGINE_PRIORITY[left.mode] - ENGINE_PRIORITY[right.mode]
    || (right.smokeStrength ?? 0) - (left.smokeStrength ?? 0)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return new Set(ranked.slice(0, MAX_INCIDENT_ENGINES).map((incident) => incident.id));
}
