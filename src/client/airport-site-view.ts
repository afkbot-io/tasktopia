import type { Graphics } from "pixi.js";
import type { AirportSitePlan } from "../shared/airport-site";
import type { Cell } from "../shared/contracts";
import type {RoadAtlasSurface} from '../shared/road-atlas';
export type AirportMaterialPainter=(view:Graphics,x:number,y:number,width:number,height:number,kind:RoadAtlasSurface)=>boolean;
/** New scenes provide an explicit small airport list; old cached scenes keep
 * their original visible-task apron fallback without a canonical city scan. */
export function selectAirportApronTasks<T extends {serviceRole?:string|null}>(sites:readonly {taskId:string}[]|undefined,
  tasks:Pick<ReadonlyMap<string,T>,'get'|'values'>):T[]{
 return sites===undefined?[...tasks.values()].filter(task=>task.serviceRole==='AIRPORT')
  :sites.flatMap(site=>{const task=tasks.get(site.taskId);return task?[task]:[];});
}
/** Resolve only visible canonical facilities to their existing task. An old
 * persisted airfield can outlive a demolished terminal; it is not a task. */
export function airportFacilityTaskAt(sites: readonly { taskId: string; stage: number; plan: AirportSitePlan | null }[],
  tasks: ReadonlyMap<string, { stage: number }>, point: Cell): string | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  for (const { taskId, stage, plan } of sites) {
    if (!plan || stage < 1 || (tasks.get(taskId)?.stage ?? 0) < 1) continue;
    const r = plan.airfield;
    if (point.x >= r.minX && point.x < r.maxX + 1 && point.y >= r.minY && point.y < r.maxY + 1
      || plan.access.some(cell => Math.floor(point.x) === cell.x && Math.floor(point.y) === cell.y)) return taskId;
  }
  return undefined;
}
export function airportSiteIntersectsRect(sites:readonly {plan:AirportSitePlan|null}[],origin:Cell,width:number,height:number):boolean{
  return sites.some(({plan})=>plan&&(origin.x<=plan.airfield.maxX&&origin.x+width>plan.airfield.minX&&origin.y<=plan.airfield.maxY&&origin.y+height>plan.airfield.minY
    ||plan.access.some(p=>p.x>=origin.x&&p.x<origin.x+width&&p.y>=origin.y&&p.y<origin.y+height)));
}
/** The site is composed at native pixels, independently of the terminal PNG. */
export function drawCityAirportSites(view:Graphics,sites:readonly {stage:number;plan:AirportSitePlan|null}[],cell:number,paint?:AirportMaterialPainter):void{
 const material=(x:number,y:number,w:number,h:number,kind:RoadAtlasSurface,fallback:number)=>{
  if(!paint?.(view,x,y,w,h,kind))view.rect(x,y,w,h).fill(fallback);
 };
 for(const {stage,plan} of sites){
  if(!plan||stage<1)continue;
  const r=plan.airfield,x=r.minX*cell,y=r.minY*cell,w=(r.maxX-r.minX+1)*cell,h=(r.maxY-r.minY+1)*cell;
  material(x,y,w,h,stage<3?'PATH_EARTH':'PAVEMENT',stage<3?0x9b8969:0x657771);
  for(const p of plan.access)material(p.x*cell,p.y*cell,cell,cell,stage<3?'PATH_EARTH':'PATH_PAVERS',stage<3?0x9b8969:0x89917e);
  if(stage<3){for(let px=x;px<x+w;px+=8)view.rect(px,y,1,3).rect(px,y+h-3,1,3).fill(0x675a46);continue;}
  const a=plan.runway[0],b=plan.runway[1],left=(a.x-1)*cell,top=(a.y-1)*cell,rw=(b.x-a.x+3)*cell;
  material(left,top,rw,3*cell,stage===3?'PATH_EARTH':'PATH_ASPHALT',stage===3?0x796e56:0x344b4c);
  if(stage>=4){
   const taxi=plan.taxiPath;
   for(let i=1;i<taxi.length;i++){const p=taxi[i-1]!,q=taxi[i]!;material(Math.min(p.x,q.x)*cell,Math.min(p.y,q.y)*cell,Math.abs(p.x-q.x)*cell+cell,Math.abs(p.y-q.y)*cell+cell,'DRIVEWAY',0x566c68);}
   for(const row of [r.minY+5,r.minY+7])material((r.minX+3)*cell,row*cell,32*cell,cell,'DRIVEWAY',0x566c68);
   material((r.minX+34)*cell,(r.minY+2)*cell,cell,4*cell,'DRIVEWAY',0x566c68);
   for(const stand of plan.stands){
    material(stand.x*cell,(r.minY+5)*cell,cell,6*cell,'DRIVEWAY',0x566c68);
    material((stand.x-2)*cell,(stand.y-1)*cell,4*cell,3*cell,'PAVEMENT',0x74857b);
   }
  }
  if(stage===5){
   for(const stand of plan.stands)material((stand.x-1)*cell,(stand.y+1)*cell,2*cell,2*cell,'PATH_PAVERS',0x89917e);
   view.rect(left,top,rw,1).rect(left,top+3*cell-1,rw,1).fill(0xbab99a);
   for(let px=left+9;px<left+rw-9;px+=12)view.rect(px,top+Math.floor(1.5*cell),5,1).fill(0xd7cead);
   for(const px of [left+3,left+rw-8])for(let py=top+3;py<top+3*cell-3;py+=4)view.rect(px,py,4,1).fill(0xd7cead);
   for(const stand of plan.stands){
    view.rect(stand.x*cell,(stand.y-1)*cell,1,3*cell).rect((stand.x-1)*cell,(stand.y+1)*cell,2*cell,1).fill(0xb1aa78);
    view.rect(stand.x*cell+2,(stand.y+1)*cell+2,4,4).fill(0xbaa77c);
   }
   view.rect((r.minX+8)*cell,(plan.gate.y-1)*cell+2,22*cell,4).fill(0x89917e);
   view.rect(plan.gate.x*cell+2,(plan.gate.y-1)*cell+2,4,cell+2).fill(0x89917e);
  }
 }
}
