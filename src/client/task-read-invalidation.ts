import type { RealtimeEvent } from '../shared/contracts';

/** A dependent card may be open even when the changed task is not selected. */
export function taskEventRefreshesDependencies(event: RealtimeEvent): boolean {
  if (typeof event.payload.taskId !== 'string') return false;
  if (['task.deleted', 'task.renamed', 'task.status_changed'].includes(event.type)) return true;
  if (event.type !== 'task.fields_updated') return false;
  return !Array.isArray(event.payload.changedFields) || event.payload.changedFields.some(field => field === 'title' || field === 'status');
}
