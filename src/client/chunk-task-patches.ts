import type { ChunkDto, ChunkPayloadDto, ChunkTaskDto } from "../shared/contracts";

export type ChunkTaskStatusPatch = Pick<ChunkTaskDto, "status" | "progress" | "stage"> & {
  worldVersion: number;
};

/**
 * Applies the newest realtime task state to a decoded chunk. This is also run
 * after worker materialization, closing the race where a response fetched
 * before the event would otherwise commit stale task visuals afterwards.
 */
export function patchChunkTaskStatuses(
  chunk: ChunkDto,
  patches: ReadonlyMap<string, ChunkTaskStatusPatch>,
): ChunkDto {
  let changed = false;
  let worldVersion = chunk.worldVersion;
  const tasks = chunk.tasks.map((task) => {
    const patch = patches.get(task.id);
    if (!patch || patch.worldVersion <= chunk.worldVersion) return task;
    worldVersion = Math.max(worldVersion, patch.worldVersion);
    if (task.status === patch.status && task.progress === patch.progress && task.stage === patch.stage) return task;
    changed = true;
    return { ...task, status: patch.status, progress: patch.progress, stage: patch.stage };
  });
  return changed || worldVersion !== chunk.worldVersion ? { ...chunk, tasks, worldVersion } : chunk;
}

/**
 * Applies realtime task stages before deterministic decoration generation.
 * A neighbouring chunk may only contain the task in decorationContext, so
 * patch both representations and let the worker rebuild entity decorations
 * without downloading or rebaking static ground.
 */
export function patchChunkPayloadTaskStatuses(
  payload: ChunkPayloadDto,
  patches: ReadonlyMap<string, ChunkTaskStatusPatch>,
): ChunkPayloadDto {
  let changed = false;
  let publishedVersion = payload.publishedVersion;
  const tasks = payload.tasks.map((task) => {
    const patch = patches.get(task.id);
    if (!patch || patch.worldVersion <= payload.publishedVersion) return task;
    publishedVersion = Math.max(publishedVersion, patch.worldVersion);
    if (task.status === patch.status && task.progress === patch.progress && task.stage === patch.stage) return task;
    changed = true;
    return { ...task, status: patch.status, progress: patch.progress, stage: patch.stage };
  });
  const contextTasks = payload.decorationContext.tasks.map((task) => {
    const patch = patches.get(task.id);
    if (!patch || patch.worldVersion <= payload.publishedVersion) return task;
    publishedVersion = Math.max(publishedVersion, patch.worldVersion);
    if (task.stage === patch.stage) return task;
    changed = true;
    return { ...task, stage: patch.stage };
  });
  if (!changed && publishedVersion === payload.publishedVersion) return payload;
  return {
    ...payload,
    tasks,
    publishedVersion,
    decorationContext: { ...payload.decorationContext, tasks: contextTasks },
  };
}
