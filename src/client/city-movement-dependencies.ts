import type { CitySceneDto } from "../shared/city-scene-contract";
import type { ChunkDto, ChunkTaskDto } from "../shared/contracts";
import { incidentMode } from "./task-incidents";

type Dependency = readonly unknown[];
type PhysicalPage = { arrays: readonly unknown[]; tasks: readonly Dependency[] };
// Immutable references are the fast path. Only replaced leaves need their
// original JSON equivalence (including key order, missing fields and -0).
// Array slots use JSON's null normalization; no serialized copy stays live.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let index=0; index<a.length; index++) if (!same(a[index], b[index])) return false;
    return true;
  }
  return JSON.stringify([a]) === JSON.stringify([b]);
}
const sameList = (a: readonly Dependency[], b: readonly Dependency[]) => a.length === b.length && a.every((value, index) => same(value, b[index]));

export function needsMovementPreparation(input:{mobilityReady:boolean;authoritativeCity:boolean;forced:boolean;geometryChanged:boolean;snapshotReady?:boolean}):boolean {
  return input.snapshotReady!==false && (!input.mobilityReady || !input.authoritativeCity&&input.forced || input.geometryChanged);
}

/** One current dependency set, no hash collisions or retained history. Versions,
 * title, description and progress are not physical geometry. Equivalent newly
 * decoded arrays are compared only when their immutable references change. */
export function createCityMovementDependencies() {
  let pages = new Map<string,PhysicalPage>(), completedGeometry: readonly Dependency[] = [];
  let lifeTasks = new Map<string,Dependency>(), transport: Dependency | undefined, geometry = 0, life = 0;
  const taskGeometry = new WeakMap<ChunkTaskDto,Dependency>(), taskLife = new WeakMap<ChunkTaskDto,Dependency>();
  const featureGeometry = new WeakMap<ChunkDto["worldFeatures"][number],Dependency>();
  const physical = (task:ChunkTaskDto) => {
    let value = taskGeometry.get(task);
    if (value === undefined) {
      value = [task.id,task.taskNumber,task.visualKind,task.visualAssetKey,task.stage === 5,
        task.visualAssetKey === "urban-parking" && task.status === "COMPLETED",task.footprint,task.accessPath];
      taskGeometry.set(task,value);
    }
    return value;
  };
  const activity = (task:ChunkTaskDto) => {
    let value = taskLife.get(task);
    if (value === undefined) { value = [physical(task),task.serviceRole,task.status === "COMPLETED",incidentMode(task)]; taskLife.set(task,value); }
    return value;
  };
  return (chunks: readonly ChunkDto[], completed: readonly ChunkTaskDto[], scene?: CitySceneDto) => {
    let changed = pages.size !== chunks.length;
    const next = new Map<string,PhysicalPage>(), nextLife = new Map<string,Dependency>();
    for (const chunk of chunks) {
      const id = `${chunk.chunkX},${chunk.chunkY}`, previous = pages.get(id);
      const features = (chunk.worldFeatures??[]).map(feature => {
        let value = featureGeometry.get(feature);
        if(value===undefined){value=[feature.id,feature.kind,feature.assetKind,feature.assetKey,feature.developmentStage,feature.footprint,feature.accessPath];featureGeometry.set(feature,value);}
        return value;
      });
      const arrays = [chunk.terrain,chunk.roads,chunk.surfaces,chunk.decorations,features];
      const tasks = chunk.tasks.map(physical);
      if (!previous || !sameList(previous.tasks,tasks) || arrays.some((array,index) => !same(array,previous.arrays[index]))) changed = true;
      next.set(id,{arrays,tasks});
      for (const task of chunk.tasks) nextLife.set(task.id,activity(task));
    }
    const completedNext = completed.map(physical);
    if (!sameList(completedGeometry,completedNext)) changed = true;
    for (const task of completed) nextLife.set(task.id,activity(task));
    const nextTransport = [scene?.railway,scene?.airports,scene?.ports,scene?.airportConnections,scene?.railConnections,scene?.seaConnections,scene?.intercityRoads];
    if (!same(transport, nextTransport)) changed = true;
    if (changed) geometry++;
    if (nextLife.size !== lifeTasks.size || [...nextLife].some(([id,value]) => !same(lifeTasks.get(id), value))) life++;
    pages = next; completedGeometry = completedNext; lifeTasks = nextLife; transport = nextTransport;
    return {geometry,life};
  };
}
