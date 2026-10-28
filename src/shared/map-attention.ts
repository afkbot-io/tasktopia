import type { TaskStatus } from "./contracts";
export const MAP_ATTENTION_DEFAULT_PAGE_SIZE = 250;
export const MAP_ATTENTION_MAX_PAGE_SIZE = 1000;
export type MapAttentionMode = "MINE" | "TESTING" | "DEFECTS" | "OVERDUE";
export type MapAttentionTask = { id: string; mine: boolean; status: TaskStatus; dueAt: string | null; hasDefects: boolean };
export type MapAttentionPage = { revision: number; tasks: MapAttentionTask[]; next: string | null };
export function matchesMapAttention(task: MapAttentionTask, mode: MapAttentionMode, now: number): boolean {
  switch (mode) {
    case "MINE": return task.mine;
    case "TESTING": return task.status === "TESTING";
    case "DEFECTS": return task.hasDefects;
    case "OVERDUE": return task.status !== "COMPLETED" && task.dueAt !== null && Date.parse(task.dueAt) <= now;
  }
}
