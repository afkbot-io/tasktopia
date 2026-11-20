import type { ChunkDto, ChunkPayloadDto, ChunkTaskDto, WorldFeatureDto } from "../shared/contracts";
import {copyCitySceneRunFields} from './city-scene-run-owner';

export type ChunkTaskStatusPatch = Pick<ChunkTaskDto, "status" | "progress" | "stage"> & {
  worldVersion: number;
};

function patchContinuationFeatures(features:WorldFeatureDto[],patches:ReadonlyMap<string,ChunkTaskStatusPatch>,version:number){
  let worldVersion=version,changed=false;
  const next=features.map(feature=>{
    const site=feature.continuation,patch=site?.taskId?patches.get(site.taskId):undefined;
    if(!site||site.outcome!=='OPEN'||!patch||patch.worldVersion<=version)return feature;
    worldVersion=Math.max(worldVersion,patch.worldVersion);
    if(site.status===patch.status&&site.progress===patch.progress)return feature;
    changed=true;
    return {...feature,continuation:{...site,status:patch.status,progress:patch.progress,
      outcome:patch.status==='COMPLETED'?'COMPLETED' as const:'OPEN' as const}};
  });
  return {features:changed?next:features,worldVersion,changed};
}

/**
 * Applies the newest realtime task state to a decoded chunk. This is also run
 * after worker materialization, closing the race where a response fetched
 * before the event would otherwise commit stale task visuals afterwards.
 */
export function patchChunkTaskStatuses(
  chunk: ChunkDto,
  patches: ReadonlyMap<string, ChunkTaskStatusPatch>,
): ChunkDto {
  if(patches.size===0)return chunk;
  const linked=patchContinuationFeatures(chunk.worldFeatures,patches,chunk.worldVersion);
  let changed = linked.changed;
  let worldVersion = linked.worldVersion;
  const tasks = chunk.tasks.map((task) => {
    const patch = patches.get(task.id);
    if (!patch || patch.worldVersion <= chunk.worldVersion) return task;
    worldVersion = Math.max(worldVersion, patch.worldVersion);
    if (task.status === patch.status && task.progress === patch.progress && task.stage === patch.stage) return task;
    changed = true;
    return { ...task, status: patch.status, progress: patch.progress, stage: patch.stage };
  });
  return changed || worldVersion !== chunk.worldVersion ? { ...chunk, tasks, worldFeatures:linked.features,worldVersion } : chunk;
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
  if(patches.size===0)return payload;
  const linked=patchContinuationFeatures(payload.worldFeatures,patches,payload.publishedVersion);
  let changed = linked.changed;
  let publishedVersion = linked.worldVersion;
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
  return copyCitySceneRunFields(payload,{tasks,publishedVersion,worldFeatures:linked.features,
    decorationContext:copyCitySceneRunFields(payload.decorationContext,{tasks:contextTasks})});
}
