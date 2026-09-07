import type { RealtimeEvent, TaskDto } from "../shared/contracts";
import { api } from "./api";
import { RevisionCache } from "./map-scene-cache";

const cache = new RevisionCache<TaskDto>(24);
export function clearTaskDetailCache(): void { cache.clear(); }
export function forgetTaskDetail(countryId: string, taskId: string): void { cache.delete(`${countryId}:${taskId}`); }
export function peekTaskDetail(countryId: string, taskId: string): TaskDto | undefined { return cache.peek(`${countryId}:${taskId}`); }
export function loadTaskDetail(countryId: string, taskId: string, load = () => api<TaskDto>(`/api/tasks/${taskId}`)): Promise<TaskDto> {
  return cache.read(`${countryId}:${taskId}`, load);
}
/** Returns the affected identity; undefined means no task, null means the country. */
export function invalidateTaskDetails(event: RealtimeEvent): string | null | undefined {
  const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : undefined;
  if (taskId) { forgetTaskDetail(event.countryId, taskId); return taskId; }
  if (event.type === "country.regenerated" || event.type.startsWith("district.") || event.type.startsWith("city.")) {
    for (const key of cache.keys()) if (key.startsWith(`${event.countryId}:`)) cache.delete(key);
    return null;
  }
  return undefined;
}
