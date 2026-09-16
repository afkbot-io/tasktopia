import type { Cell, ChunkTaskDto, TaskStatus, WorldFeatureDto } from "../shared/contracts";
export type ConstructionBand = "FOUNDATION" | "STRUCTURE" | "FINISHING" | "INSPECTION";
export function constructionBand(status: TaskStatus, progress: number): ConstructionBand | null {
  if (status === "PLANNING" || status === "COMPLETED") return null;
  if (status === "TESTING") return "INSPECTION";
  if (status === "STARTED" || progress <= 26) return "FOUNDATION";
  return progress <= 52 ? "STRUCTURE" : "FINISHING";
}
export type ConstructionLifeTask = Pick<ChunkTaskDto,"id"|"taskNumber"|"districtId"|"footprint"|"accessPath"|"status"|"progress"|"siteBounds">;
export type ConstructionLifeSite = { taskId: string; band: ConstructionBand; workers: { id: string; path: Cell[] }[]; materials: { key: "compact-construction-bricks" | "compact-construction-sand"; cell: Cell }[] };
const key=(cell:Cell)=>`${cell.x},${cell.y}`;
/** Only callers' visible tasks. Geometry/road/prop blockers are authoritative;
 * access paths remain pedestrian-only, materials never occupy a passage. */
export function planConstructionLife(tasks: readonly ConstructionLifeTask[], activeDistricts: ReadonlySet<string>, blocked: ReadonlySet<string>, incidents: ReadonlySet<string>, options: { reducedMotion: boolean; economy: boolean; materialCells?: ReadonlySet<string>; features?: readonly Pick<WorldFeatureDto,"footprint"|"accessPath">[] }): ConstructionLifeSite[] {
  let remaining=options.reducedMotion?0:options.economy?2:8;
  let materialsRemaining=options.economy?4:16;
  const occupied=new Set(blocked), passages=new Set(tasks.flatMap(t=>t.accessPath.map(key)));
  for(const task of tasks)for(const cell of task.footprint)occupied.add(key(cell));
  for(const feature of options.features??[])for(const cell of [...feature.footprint,...feature.accessPath])occupied.add(key(cell));
  const result: ConstructionLifeSite[]=[];
  for(const task of [...tasks].sort((a,b)=>a.taskNumber-b.taskNumber||a.id.localeCompare(b.id))) {
    const band=constructionBand(task.status,task.progress);
    if(!band || !activeDistricts.has(task.districtId) || incidents.has(task.id))continue;
    const site:ConstructionLifeSite={taskId:task.id,band,workers:[],materials:[]};
    const path:Cell[]=[];
    for(const cell of task.accessPath) {
      if(occupied.has(key(cell))) {if(path.length)break;continue;}
      const previous=path.at(-1);
      if(previous&&Math.abs(previous.x-cell.x)+Math.abs(previous.y-cell.y)!==1)break;
      path.push(cell); if(path.length===5)break;
    }
    const workerCount=Math.min(remaining,band==="STRUCTURE"?2:1,path.length>=2?2:0);
    for(let i=0;i<workerCount;i++)site.workers.push({id:`${task.id}:${i}`,path:band==="INSPECTION"?[path[i]!]:path});
    remaining-=workerCount;
    if(band!=="INSPECTION" && task.siteBounds && options.materialCells && materialsRemaining > 0) {
      const max=Math.min(materialsRemaining,band==="STRUCTURE"?2:1);
      for(const cell of task.footprint) {
        if(site.materials.length>=max)break;
        for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
          const candidate={x:cell.x+dx!,y:cell.y+dy!}, id=key(candidate);
          if(candidate.x < task.siteBounds.minX || candidate.x > task.siteBounds.maxX || candidate.y < task.siteBounds.minY || candidate.y > task.siteBounds.maxY)continue;
          if(!options.materialCells.has(id)||occupied.has(id)||passages.has(id))continue;
          site.materials.push({key:band==="FOUNDATION"?"compact-construction-sand":"compact-construction-bricks",cell:candidate});occupied.add(id);materialsRemaining--;break;
        }
      }
    }
    result.push(site);
  }
  return result;
}

export type WorkerPose = { x: number; y: number; direction: "north" | "east" | "south" | "west"; frame: 0 | 1 };
/** Shared scene time, stable phase by identity, with a work pause at both ends.
 * Returning to a visible chunk resumes the same cycle rather than restarting it. */
export function constructionWorkerPose(worker: ConstructionLifeSite["workers"][number], timeMs: number): WorkerPose | null {
  const path = worker.path;
  if (!path.length) return null;
  if (path.length === 1) return { ...path[0]!, direction: "south", frame: 0 };
  let hash = 0;
  for (const char of worker.id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const travel = (path.length - 1) * 1100, pause = 2400, half = travel + pause;
  const phase = ((Math.max(0, timeMs) + hash % (half * 2)) % (half * 2));
  const returning = phase >= half, local = phase % half;
  const along = Math.min(local, travel) / 1100;
  const distance = returning ? path.length - 1 - along : along;
  const index = Math.min(path.length - 2, Math.floor(distance));
  const start = path[index]!, end = path[index + 1]!, fraction = distance - index;
  const dx = (end.x - start.x) * (returning ? -1 : 1), dy = (end.y - start.y) * (returning ? -1 : 1);
  return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction,
    direction: dx > 0 ? "east" : dx < 0 ? "west" : dy > 0 ? "south" : "north",
    frame: local >= travel && Math.floor(local / 600) % 2 === 1 ? 1 : 0 };
}
