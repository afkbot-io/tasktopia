import type { Cell, ChunkTaskDto } from '../shared/contracts';
import { incidentMode } from './task-incidents';
import { completePreparation, prepareCooperatively, stableSortPreparation, type CooperativePreparationOptions } from '../shared/cooperative-preparation';
export type CityLifeTask = Pick<ChunkTaskDto, 'id'|'status'|'stage'|'accessPath'|'visualKind'|'serviceRole'|'workItemType'|'defectSummary'>;

export type CityLifeKind='MOVING'|'DELIVERY'|'GARDEN'|'MUSIC'|'CELEBRATION'|'CLEANING'|'MAINTENANCE'|'DRILL';
export type CityLifeSite={taskId:string;kind:CityLifeKind;route:Cell[];responseCells?:readonly Cell[]};
export type CityLifePlan=CityLifeSite & {id:string;start:number;durationMs:number};
export type CityLifeScene=CityLifePlan & {phase:'ARRIVING'|'ACTIVITY'|'LEAVING';position:Cell;actorIds:string[];serviceId?:string;arrived:number};
const key=(cell:Cell)=>`${cell.x},${cell.y}`;
export function cityLifeHash(value:string) {let h=2166136261;for(const char of value)h=Math.imul(h^char.charCodeAt(0),16777619);return h>>>0;}
const directions=[{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];

function kindFor(task:CityLifeTask):CityLifeKind {
  const hash=cityLifeHash(task.id);
  if(task.serviceRole==='FIRE')return 'DRILL';
  if(task.serviceRole==='SHOP')return 'DELIVERY';
  if(task.visualKind==='PARK')return (['GARDEN','MUSIC','CELEBRATION'] as const)[hash%3]!;
  if(task.serviceRole)return hash%2?'MAINTENANCE':'CLEANING';
  return (['MOVING','GARDEN','MAINTENANCE'] as const)[hash%3]!;
}

/** Compile only real walkable approaches. Completed task records remain immutable. */
export function* cityLifeSitesSteps(tasks:readonly CityLifeTask[],walkGraph:ReadonlyMap<string,Cell>,blocked:Pick<ReadonlySet<string>, 'has'>,roads?:ReadonlyMap<string,Cell>):Generator<void,CityLifeSite[],void> {
  const sites:CityLifeSite[]=[];
  const unique=new Map<string,CityLifeTask>();
  for(const task of tasks){unique.set(task.id,task);yield;}
  const ordered=yield* stableSortPreparation(unique.values(),(a,b)=>a.id.localeCompare(b.id));
  for(const task of ordered) {
    yield;
    if(task.status!=='COMPLETED'||task.stage!==5||incidentMode(task)!=='NONE')continue;
    const entrance=task.accessPath.find(cell=>walkGraph.has(key(cell))&&!blocked.has(key(cell)));
    if(!entrance)continue;
    const queue:Cell[][]=[[entrance]],seen=new Set([key(entrance)]);
    let route:Cell[]=[];
    for(let index=0;index<queue.length&&index<96;index++) {
      yield;
      const current=queue[index]!;
      if(current.length>=7){route=current;break;}
      for(const delta of directions) {
        const tail=current.at(-1)!,cell={x:tail.x+delta.x,y:tail.y+delta.y},id=key(cell);
        if(seen.has(id)||!walkGraph.has(id)||blocked.has(id))continue;
        seen.add(id);queue.push([...current,cell]);
      }
    }
    if(route.length<7)continue;
    const kind = kindFor(task), responseCells: Cell[] = [];
    if (kind === 'DRILL' && roads) for (let y = entrance.y - 8; y <= entrance.y + 8; y++) for (let x = entrance.x - 8; x <= entrance.x + 8; x++) {
      const cell = roads.get(`${x},${y}`);if (cell) responseCells.push(cell);yield;
    }
    responseCells.sort((a,b)=>Math.abs(a.x-entrance.x)+Math.abs(a.y-entrance.y)-Math.abs(b.x-entrance.x)-Math.abs(b.y-entrance.y));
    sites.push({taskId:task.id,kind,route:route.reverse(),...(kind === 'DRILL' ? {responseCells:responseCells.slice(0,16)} : {})});
  }
  return sites;
}
export function cityLifeSites(tasks:readonly CityLifeTask[],walkGraph:ReadonlyMap<string,Cell>,blocked:Pick<ReadonlySet<string>, 'has'>,roads?:ReadonlyMap<string,Cell>):CityLifeSite[] {
  return completePreparation(cityLifeSitesSteps(tasks,walkGraph,blocked,roads));
}
export function cityLifeSitesAsync(tasks:readonly CityLifeTask[],walkGraph:ReadonlyMap<string,Cell>,blocked:Pick<ReadonlySet<string>, 'has'>,options:CooperativePreparationOptions={},roads?:ReadonlyMap<string,Cell>):Promise<CityLifeSite[]> {
  return prepareCooperatively(cityLifeSitesSteps(tasks,walkGraph,blocked,roads),options);
}

/** The shared director supplies bounded visible candidates and owns admission.
 * A site keeps its window ID even when a temporary conflict delays its start. */
export function planCityLife(cityId:string,sites:readonly CityLifeSite[],now:number):CityLifePlan|undefined {
  if(!sites.length||!Number.isFinite(now))return;
  const window=Math.floor(now/180_000);
  const ordered=[...sites].sort((a,b)=>a.taskId.localeCompare(b.taskId));
  const site=ordered[cityLifeHash(`${cityId}:${window}`)%ordered.length]!;
  return {...site,id:`${cityId}:${window}:${site.taskId}`,start:now,durationMs:75_000};
}
