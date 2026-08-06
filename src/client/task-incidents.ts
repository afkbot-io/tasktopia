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
