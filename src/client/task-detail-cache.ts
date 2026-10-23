import type { RealtimeEvent, TaskDto } from "../shared/contracts";
import { api } from "./api";
import { RevisionCache } from "./map-scene-cache";
import { clearTaskReadCaches, forgetTaskCard, invalidateTaskReadCaches } from './task-read-cache';
import { taskEventRefreshesDependencies } from './task-read-invalidation';
export { taskEventRefreshesDependencies } from './task-read-invalidation';

const cache = new RevisionCache<TaskDto>(24);
export function clearTaskDetailCache(): void { cache.clear(); clearTaskReadCaches(); }
export function forgetTaskDetail(countryId: string, taskId: string): void { cache.delete(`${countryId}:${taskId}`); forgetTaskCard(countryId, taskId); }
export function peekTaskDetail(countryId: string, taskId: string): TaskDto | undefined { return cache.peek(`${countryId}:${taskId}`); }
export function loadTaskDetail(countryId: string, taskId: string, load = () => api<TaskDto>(`/api/tasks/${taskId}`)): Promise<TaskDto> {
  return cache.read(`${countryId}:${taskId}`, load);
}
/** Returns the affected identity; undefined means no task, null means the country. */
export function invalidateTaskDetails(event: RealtimeEvent): string | null | undefined {
  invalidateTaskReadCaches(event);
  const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : undefined;
  if (taskId) {
    cache.delete(`${event.countryId}:${taskId}`);
    if (taskEventRefreshesDependencies(event)) for (const key of cache.keys()) if (key.startsWith(`${event.countryId}:`)
      && (cache.hasPending(key) || cache.peek(key)?.dependencies?.some(dependency => dependency.id === taskId))) cache.delete(key);
    return taskId;
  }
  if (event.type === "country.regenerated" || event.type.startsWith("district.") || event.type.startsWith("city.")) {
    for (const key of cache.keys()) if (key.startsWith(`${event.countryId}:`)) cache.delete(key);
    return null;
  }
  return undefined;
}
