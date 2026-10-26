import type { TaskDto } from "./contracts";

export const TASK_SCALAR_FIELDS = ["title", "status", "progress", "priority", "estimate", "dueAt", "workItemType", "assignee"] as const;
export type TaskScalarField = typeof TASK_SCALAR_FIELDS[number];
export type TaskScalarChange = { field: TaskScalarField; before: string | number | null; after: string | number | null; beforeLabel?: string | null; afterLabel?: string | null };
type ScalarSource = Pick<TaskDto, "title" | "status" | "progress" | "priority" | "estimate" | "dueAt" | "workItemType"> & { assignee?: { id: string; name?: string } | null };

/** Copy only allowed short values; long task/document bodies never enter audit diffs. */
export function taskScalarChanges(before: ScalarSource, after: ScalarSource): TaskScalarChange[] {
  const values = (source: ScalarSource) => ({ title: source.title.slice(0, 160), status: source.status,
    progress: source.progress, priority: source.priority, estimate: source.estimate, dueAt: source.dueAt,
    workItemType: source.workItemType, assignee: source.assignee?.id ?? null });
  const previous = values(before), next = values(after);
  return TASK_SCALAR_FIELDS.flatMap(field => previous[field] === next[field] ? [] : [{ field, before: previous[field], after: next[field],
    ...(field === "assignee" ? { beforeLabel: before.assignee?.name?.slice(0,60) ?? null, afterLabel: after.assignee?.name?.slice(0,60) ?? null } : {}) }]);
}
