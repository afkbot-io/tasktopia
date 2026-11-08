import type { BlockServiceRole } from '../shared/block-world';
import type { Cell, ChunkTaskDto } from '../shared/contracts';
import { incidentMode } from './task-incidents';
import { BUILDING_CATALOG } from '../shared/catalog';
import { cityEventRecipe, eligibleNeighbourhoodRecipes, type CityLifeContext } from './city-event-recipes';
import { completePreparation, prepareCooperatively, stableSortPreparation, type CooperativePreparationOptions } from '../shared/cooperative-preparation';
export type CityLifeTask = Pick<ChunkTaskDto, 'id'|'status'|'stage'|'accessPath'|'visualKind'|'serviceRole'|'workItemType'|'defectSummary'> & Partial<Pick<ChunkTaskDto,'visualAssetKey'>>;

export type CityLifeKind='MOVING'|'DELIVERY'|'GARDEN'|'MUSIC'|'CELEBRATION'|'CLEANING'|'MAINTENANCE'|'DRILL'|'READING'|'ART'|'CULTURE';
export type CityLifeSite={taskId:string;kind:CityLifeKind;route:Cell[];context?:CityLifeContext;responseCells?:readonly Cell[]};
export type CityLifePlan=CityLifeSite & {id:string;start:number;durationMs:number;recipeId?:string};
export type CityLifeScene=CityLifePlan & {phase:'ARRIVING'|'ACTIVITY'|'LEAVING';position:Cell;actorIds:string[];serviceId?:string;arrived:number;activityAt?:number};
const key=(cell:Cell)=>`${cell.x},${cell.y}`;
/** These indexes belong to one completed physical snapshot. Life only asks
 * membership; duplicating their city-wide union retains hundreds of thousands
 * of hash entries without adding information. */
export function createCityLifeBlocker(blocked:Pick<ReadonlySet<string>,'has'>,roads:Pick<ReadonlySet<string>,'has'>,
  parking:Pick<ReadonlySet<string>,'has'>):Pick<ReadonlySet<string>,'has'>{
  return {has:id=>blocked.has(id)||roads.has(id)||parking.has(id)};
}
export function cityLifeHash(value:string) {let h=2166136261;for(const char of value)h=Math.imul(h^char.charCodeAt(0),16777619);return h>>>0;}
const directions=[{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
const buildings=new Map(BUILDING_CATALOG.map(building=>[building.key,building]));
const serviceContexts:Readonly<Record<BlockServiceRole,CityLifeContext>>={
  EDUCATION:'EDUCATION',MEDICAL:'MEDICAL',FIRE:'FIRE',POLICE:'POLICE',RAILWAY:'RAILWAY',AIRPORT:'AIRPORT',CIVIC:'CIVIC',SHOP:'SHOP',PORT:'PORT',
};
function contextFor(task:CityLifeTask):CityLifeContext {
  const role=task.serviceRole??buildings.get(task.visualAssetKey??'')?.serviceRole;
  if(role&&Object.hasOwn(serviceContexts,role))return serviceContexts[role as BlockServiceRole];
  if(task.visualKind==='PARK')return task.visualAssetKey==='urban-parking'?'PAVED':task.visualAssetKey==='urban-lake'?'WATER_EDGE':'GREEN';
  return 'HOME';
}

function kindFor(task:CityLifeTask,context:CityLifeContext):CityLifeKind {
  const hash=cityLifeHash(task.id);
  if(context==='FIRE')return 'DRILL';
  if(context==='SHOP')return 'DELIVERY';
  if(context==='PAVED'||context==='WATER_EDGE')return 'CLEANING';
  if(context==='GREEN')return (['GARDEN','MUSIC','CELEBRATION'] as const)[hash%3]!;
  if(context!=='HOME')return hash%2?'MAINTENANCE':'CLEANING';
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
    const context=contextFor(task),kind = kindFor(task,context), responseCells: Cell[] = [];
    if (kind === 'DRILL' && roads) for (let y = entrance.y - 8; y <= entrance.y + 8; y++) for (let x = entrance.x - 8; x <= entrance.x + 8; x++) {
      const cell = roads.get(`${x},${y}`);if (cell) responseCells.push(cell);yield;
    }
    responseCells.sort((a,b)=>Math.abs(a.x-entrance.x)+Math.abs(a.y-entrance.y)-Math.abs(b.x-entrance.x)-Math.abs(b.y-entrance.y));
    sites.push({taskId:task.id,kind,context,route:route.reverse(),...(kind === 'DRILL' ? {responseCells:responseCells.slice(0,16)} : {})});
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
  const recipes=site.context?eligibleNeighbourhoodRecipes(site.context):undefined;
  if(recipes&&!recipes.length)return;
  const recipe=recipes?.[cityLifeHash(`${cityId}:${window}:${site.taskId}:recipe`)%recipes.length];
  return {...site,...(recipe?{kind:recipe.kind,recipeId:recipe.id}:{}),id:`${cityId}:${window}:${site.taskId}`,start:now,durationMs:75_000};
}


/** Retained work follows current eligibility and real geometry, not a site's
 * legacy default kind when its selected recipe uses another action. */
export function cityLifePlanFitsSite(site:CityLifeSite,plan:CityLifePlan):boolean {
  if(site.taskId!==plan.taskId || site.route!==plan.route && (site.route.length!==plan.route.length
    || site.route.some((cell,index)=>cell.x!==plan.route[index]!.x||cell.y!==plan.route[index]!.y)))return false;
  if(!plan.recipeId)return site.kind===plan.kind;
  const recipe=cityEventRecipe(plan.recipeId);
  return !!recipe&&recipe.channel==='NEIGHBOURHOOD'&&recipe.kind===plan.kind&&!!site.context
    &&eligibleNeighbourhoodRecipes(site.context).includes(recipe);
}
