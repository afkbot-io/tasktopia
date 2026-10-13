import type { Cell,Rect } from "./contracts";
export type AirportSitePlan={schemaVersion:1;airfield:Rect;gate:Cell;access:Cell[];runway:[Cell,Cell];taxiPath:Cell[];stands:Cell[]};
type Input={bounds:Rect;entrance:Cell;occupied:readonly Rect[];airfieldObstacles?:readonly Rect[];isDry:(p:Cell)=>boolean;existing?:AirportSitePlan};
const key=(p:Cell)=>`${p.x},${p.y}`;
const inside=(p:Cell,r:Rect)=>p.x>=r.minX&&p.x<=r.maxX&&p.y>=r.minY&&p.y<=r.maxY;
const overlaps=(a:Rect,b:Rect)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
/** Compact runway plus4 stands on already free dry outskirts. A single bounded
 * search joins the real terminal entrance. No parcel or terrain is moved. */
export function planAirportSite(input:Input):AirportSitePlan|null{
  if(![...Object.values(input.bounds),input.entrance.x,input.entrance.y].every(Number.isSafeInteger))return null;
  const dryCache=new Map<string,boolean>();
  const dry=(p:Cell)=>{const id=key(p);let result=dryCache.get(id);if(result===undefined){result=input.isDry(p);dryCache.set(id,result);}return result;};
  const free=(p:Cell)=>dry(p)&&!input.occupied.some(rect=>inside(p,rect));
  if(!free(input.entrance))return null;
  const candidates:AirportSitePlan[]=input.existing?[input.existing]:[];
  const b=input.bounds;
  if(!input.existing)for(const distance of [8,24,40])for(const [x,y] of [[b.minX,b.minY-distance-14],[b.maxX-37,b.minY-distance-14],[b.minX,b.maxY+distance],[b.maxX-37,b.maxY+distance],[b.minX-distance-38,b.minY],[b.minX-distance-38,b.maxY-13],[b.maxX+distance,b.minY],[b.maxX+distance,b.maxY-13]]){
    const airfield={minX:x!,minY:y!,maxX:x!+37,maxY:y!+13};
    if([...input.occupied,...input.airfieldObstacles??[]].some(rect=>overlaps(airfield,rect)))continue;
    let valid=true;
    for(let py=airfield.minY;py<=airfield.maxY&&valid;py++)for(let px=airfield.minX;px<=airfield.maxX;px++)if(!dry({x:px,y:py})){valid=false;break;}
    if(!valid)continue;
    const gate={x:x!+18,y:y!+13};
    candidates.push({schemaVersion:1,airfield,gate,access:[],runway:[{x:x!+3,y:y!+2},{x:x!+34,y:y!+2}],
      stands:[8,15,22,29].map(offset=>({x:x!+offset,y:y!+10})),taxiPath:[{x:x!+18,y:y!+10},{x:x!+18,y:y!+7},{x:x!+3,y:y!+7},{x:x!+3,y:y!+2}]});
  }
  if(!candidates.length)return null;
  const goals=new Map(candidates.map(plan=>[key(plan.gate),plan]));
  const bounds={minX:Math.min(b.minX,input.entrance.x)-80,maxX:Math.max(b.maxX,input.entrance.x)+80,minY:Math.min(b.minY,input.entrance.y)-80,maxY:Math.max(b.maxY,input.entrance.y)+80};
  const queue=[input.entrance],parents=new Map<string,Cell|undefined>([[key(input.entrance),undefined]]);
  for(let head=0;head<queue.length&&head<50_000;head++){
    const p=queue[head]!,plan=goals.get(key(p));
    if(plan){const access:Cell[]=[];for(let cursor:Cell|undefined=p;cursor;cursor=parents.get(key(cursor)))access.push(cursor);
      access.reverse();if(access.slice(0,-1).some(point=>inside(point,plan.airfield)))continue;
      return {...plan,access};}
    for(const [dx,dy] of [[0,1],[1,0],[-1,0],[0,-1]] as const){
      const next={x:p.x+dx,y:p.y+dy},id=key(next);
      if(!inside(next,bounds)||parents.has(id)||!free(next)||!goals.has(id)&&candidates.some(candidate=>inside(next,candidate.airfield)))continue;
      parents.set(id,p);queue.push(next);
    }
  }
  return null;
}
export function airportSiteReservations(plan:AirportSitePlan|null|undefined,purpose:"PARCEL"|"ROAD"="PARCEL"):Rect[]{
  if(!plan)return [];
  return [plan.airfield,...(purpose==="ROAD"?[]:plan.access.map(p=>({minX:p.x-1,minY:p.y-1,maxX:p.x+1,maxY:p.y+1})))];
}
