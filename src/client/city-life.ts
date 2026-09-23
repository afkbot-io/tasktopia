import type { Cell, ChunkTaskDto, Rect } from '../shared/contracts';
import { incidentMode } from './task-incidents';
export type CityLifeTask = Pick<ChunkTaskDto, 'id'|'status'|'stage'|'accessPath'|'visualKind'|'serviceRole'|'workItemType'|'defectSummary'>;

export type CityLifeKind='MOVING'|'DELIVERY'|'GARDEN'|'MUSIC'|'CELEBRATION'|'CLEANING'|'MAINTENANCE'|'DRILL';
export const CITY_LIFE_LABEL:Record<CityLifeKind,string>={MOVING:'Новосёлы',DELIVERY:'Доставка',GARDEN:'Уход за двором',MUSIC:'Уличная музыка',CELEBRATION:'Праздник во дворе',CLEANING:'Уборка улицы',MAINTENANCE:'Уход за фасадом',DRILL:'Учебный выезд'};
export type CityLifeSite={taskId:string;kind:CityLifeKind;route:Cell[]};
export type CityLifePlan=CityLifeSite & {id:string;start:number;durationMs:number};
export type CityLifeScene=CityLifePlan & {phase:'ARRIVING'|'ACTIVITY'|'LEAVING';progress:number;position:Cell;durationMs:number};
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
export function cityLifeSites(tasks:readonly CityLifeTask[],walkGraph:ReadonlyMap<string,Cell>,blocked:ReadonlySet<string>):CityLifeSite[] {
  const sites:CityLifeSite[]=[];
  for(const task of [...new Map(tasks.map(task=>[task.id,task])).values()].sort((a,b)=>a.id.localeCompare(b.id))) {
    if(task.status!=='COMPLETED'||task.stage!==5||incidentMode(task)!=='NONE')continue;
    const entrance=task.accessPath.find(cell=>walkGraph.has(key(cell))&&!blocked.has(key(cell)));
    if(!entrance)continue;
    const queue:Cell[][]=[[entrance]],seen=new Set([key(entrance)]);
    let route:Cell[]=[];
    for(let index=0;index<queue.length&&index<96;index++) {
      const current=queue[index]!;
      if(current.length>=7){route=current;break;}
      for(const delta of directions) {
        const tail=current.at(-1)!,cell={x:tail.x+delta.x,y:tail.y+delta.y},id=key(cell);
        if(seen.has(id)||!walkGraph.has(id)||blocked.has(id))continue;
        seen.add(id);queue.push([...current,cell]);
      }
    }
    if(route.length<7)continue;
    sites.push({taskId:task.id,kind:kindFor(task),route:route.reverse()});
  }
  return sites;
}

/** One deterministic scene per window; compile candidates only when the window
 * or canonical site list changes. No camera-dependent event identity. */
export function planCityLife(cityId:string,sites:readonly CityLifeSite[],now:number,canonicalTaskIds:readonly string[]=sites.map(site=>site.taskId)):CityLifePlan|undefined {
  const window=Math.floor(now/180_000);
  const candidates=[...new Set(canonicalTaskIds)].filter(id=>cityLifeHash(id)%4===((window%4)+4)%4).sort();
  if(!candidates.length)return;
  const selected=candidates[cityLifeHash(`${cityId}:${window}`)%candidates.length]!;
  const site=sites.find(site=>site.taskId===selected);if(!site)return;
  return {...site,id:`${cityId}:${window}:${site.taskId}`,start:window*180_000+15_000+cityLifeHash(`${cityId}:${window}:start`)%90_000,durationMs:38_000};
}
export function cityLifePose(plan:CityLifePlan|undefined,now:number,view:Rect,options:{enabled:boolean;reducedMotion:boolean}):CityLifeScene|undefined {
  if(!plan||!options.enabled||options.reducedMotion||!Number.isFinite(now))return;
  const anchor=plan.route.at(-1)!;
  if(anchor.x<view.minX||anchor.x>view.maxX||anchor.y<view.minY||anchor.y>view.maxY)return;
  const elapsed=now-plan.start;if(elapsed<0||elapsed>=plan.durationMs)return;
  const phase=elapsed<8000?'ARRIVING':elapsed<30000?'ACTIVITY':'LEAVING';
  const progress=phase==='ARRIVING'?elapsed/8000:phase==='ACTIVITY'?1:1-(elapsed-30000)/8000;
  const step=progress*(plan.route.length-1),from=plan.route[Math.floor(step)]!,to=plan.route[Math.min(plan.route.length-1,Math.floor(step)+1)]!;
  return {...plan,phase,progress,position:{x:from.x+(to.x-from.x)*(step%1),y:from.y+(to.y-from.y)*(step%1)}};
}
export function sampleCityLife(cityId:string,sites:readonly CityLifeSite[],now:number,view:Rect,options:{enabled:boolean;reducedMotion:boolean}):CityLifeScene|undefined {
  return cityLifePose(planCityLife(cityId,[...sites].sort((a,b)=>a.taskId.localeCompare(b.taskId)),now),now,view,options);
}
