import type { ChunkTaskDto } from "../shared/contracts";

export type IncidentMode = "NONE" | "DEFECT_REPORTED" | "DEFECT_REPAIRING" | "DEFECT_VERIFYING" | "HOTFIX_ACTIVE";

export function incidentMode(task: Pick<ChunkTaskDto, "workItemType" | "status" | "defectSummary">): IncidentMode {
  const defects = task.defectSummary;
  if (defects?.inProgress) return "DEFECT_REPAIRING";
  if (defects?.verifying) return "DEFECT_VERIFYING";
  if (defects?.open) return "DEFECT_REPORTED";
  if (task.workItemType === "HOTFIX" && task.status !== "PLANNING" && task.status !== "COMPLETED") return "HOTFIX_ACTIVE";
  return "NONE";
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

export function planIncidentEngines(incidents: ReadonlyArray<{ id: string; mode: Exclude<IncidentMode, "NONE"> }>): Set<string> {
  const ranked = [...incidents].sort((left, right) =>
    ENGINE_PRIORITY[left.mode] - ENGINE_PRIORITY[right.mode] || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return new Set(ranked.slice(0, MAX_INCIDENT_ENGINES).map((incident) => incident.id));
}
