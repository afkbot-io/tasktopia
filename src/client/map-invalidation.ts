import type { RealtimeEvent, Rect } from "../shared/contracts";
import { BLOCK_SERVICE_ROLES, type BlockServiceRole } from "../shared/block-world";

export type MapInvalidation = {
  id: number;
  worldVersion: number;
  type: string;
  affectedBounds?: Rect;
  taskId?: string;
  status?: string;
  progress?: number;
  stage?: number;
  groundChanged?: boolean;
  /** A canonical country-road snapshot changed in this mutation transaction. */
  groundRoadTopologyChanged?: boolean;
  serviceRole?: BlockServiceRole;
  cityId?: string;
  changedFields?: string[];
  /** Bounded queue overflow requests an authoritative snapshot, never drops changes. */
  resync?: boolean;
};

export type MapInvalidationImpact = 'NONE' | 'TASK_STATUS' | 'SCENE';
const TASK_DETAIL_FIELDS = new Set(['description', 'acceptanceCriteria', 'documents', 'attachments', 'mergeRequests', 'checklist', 'dependencies']);
export function mapInvalidationAffectsCity(event: MapInvalidation, cityId?: string): boolean {
  // Each city contains routes to remote completed airports. Deletion payloads
  // may no longer contain the removed task's role, so invalidate conservatively.
  return !cityId || !event.cityId || event.cityId === cityId || event.resync === true
    || event.groundRoadTopologyChanged === true
    || event.serviceRole === 'AIRPORT'
    || ['country.regenerated', 'task.deleted', 'district.deleted', 'city.deleted'].includes(event.type);
}

export function mapInvalidationImpact(event: MapInvalidation): MapInvalidationImpact {
  if (event.resync || event.groundRoadTopologyChanged === true) return 'SCENE';
  if (['task.comment_added', 'task.assignee_changed', 'country.profile_updated', 'archive.record_updated'].includes(event.type)) return 'NONE';
  if (event.type === 'task.fields_updated' && event.changedFields?.length
    && event.changedFields.every(field => TASK_DETAIL_FIELDS.has(field))) return 'NONE';
  return event.type === 'task.status_changed' && event.groundChanged === false && event.serviceRole !== 'AIRPORT'
    && event.taskId && event.status && event.progress !== undefined && event.stage !== undefined ? 'TASK_STATUS' : 'SCENE';
}

export function enqueueMapInvalidation(current: readonly MapInvalidation[], next: MapInvalidation, capacity = 512): MapInvalidation[] {
  const byId = new Map([...current, next].map(event => [event.id, event]));
  const ordered = [...byId.values()].sort((left, right) => left.id - right.id);
  const latest = ordered.at(-1)!;
  if (ordered.some(event => event.resync)) return [{ id: latest.id, worldVersion: Math.max(...ordered.map(event => event.worldVersion)), type: 'world.resync_required', resync: true }];
  const latestTaskStatus = new Map<string, number>();
  for (const event of ordered) if (mapInvalidationImpact(event) === 'TASK_STATUS') latestTaskStatus.set(event.taskId!, event.id);
  const pending = ordered.filter(event => mapInvalidationImpact(event) !== 'TASK_STATUS' || latestTaskStatus.get(event.taskId!) === event.id);
  if (pending.length <= Math.max(1, capacity)) return pending;
  return [{ id: latest.id, worldVersion: Math.max(...ordered.map(event => event.worldVersion)), type: 'world.resync_required', resync: true }];
}

export function acknowledgeMapInvalidations(current: readonly MapInvalidation[], cursor: number): MapInvalidation[] {
  return current.filter(event => event.id > cursor);
}

export function eventInvalidation(event: RealtimeEvent): MapInvalidation {
  const building = event.payload.building as { city?: { id?: unknown } } | undefined;
  const candidate = event.payload.affectedBounds as Partial<Rect> | undefined;
  const affectedBounds = candidate
    && [candidate.minX, candidate.minY, candidate.maxX, candidate.maxY].every(Number.isFinite)
    ? candidate as Rect
    : undefined;
  return {
    id: event.id,
    worldVersion: event.worldVersion,
    type: event.type,
    affectedBounds,
    taskId: typeof event.payload.taskId === "string" ? event.payload.taskId : undefined,
    status: typeof event.payload.status === "string" ? event.payload.status : undefined,
    progress: typeof event.payload.progress === "number" ? event.payload.progress : undefined,
    stage: typeof event.payload.stage === "number" ? event.payload.stage : undefined,
    groundChanged: typeof event.payload.groundChanged === "boolean" ? event.payload.groundChanged : undefined,
    groundRoadTopologyChanged: event.payload.groundRoadTopologyChanged === true ? true : undefined,
    serviceRole: BLOCK_SERVICE_ROLES.includes(event.payload.serviceRole as BlockServiceRole)
      ? event.payload.serviceRole as BlockServiceRole : undefined,
    cityId: typeof event.payload.cityId === 'string' ? event.payload.cityId
      : typeof building?.city?.id === 'string' ? building.city.id : undefined,
    changedFields: Array.isArray(event.payload.changedFields) ? event.payload.changedFields.filter((field): field is string => typeof field === 'string') : undefined,
  };
}
