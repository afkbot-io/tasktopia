import type { TaskStatus } from "./contracts";
export type ReportTask = {
  id: string;
  taskNumber: number;
  title: string;
  status: TaskStatus;
  progress: number;
  cityName: string;
  districtName: string;
  assignee: string | null;
  dueAt: string | null;
  defects: number;
  dependencies: number;
};
export type CityReport = {
  items: ReportTask[];
  total: number;
  nextOffset: number | null;
  counts: {
    working: number;
    planned: number;
    completed: number;
    testing: number;
    attention: number;
    completedPeriod: number;
  };
};
export function taskAttention(task: ReportTask, now = Date.now()): string[] {
  const reasons: string[] = [];
  if (task.status === "COMPLETED")
    return task.defects ? [`Нужен ремонт · ${task.defects}`] : reasons;
  if (task.dueAt && Date.parse(task.dueAt) < now) reasons.push("Срок прошёл");
  if (!task.assignee && task.status !== "PLANNING")
    reasons.push("Нет исполнителя");
  if (task.defects) reasons.push(`Нужен ремонт · ${task.defects}`);
  if (task.dependencies)
    reasons.push(`Ожидает другие задачи · ${task.dependencies}`);
  if (task.status === "TESTING") reasons.push("На приёмке");
  return reasons;
}
export const REPORT_GROUPS = [
  "В работе",
  "Запланировано",
  "Завершено",
] as const;
export function reportGroup(status: TaskStatus) {
  return status === "COMPLETED" ? 2 : status === "PLANNING" ? 1 : 0;
}
