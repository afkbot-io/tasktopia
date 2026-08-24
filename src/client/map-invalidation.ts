import type { RealtimeEvent, Rect } from "../shared/contracts";

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
};

export function eventInvalidation(event: RealtimeEvent): MapInvalidation {
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
  };
}
