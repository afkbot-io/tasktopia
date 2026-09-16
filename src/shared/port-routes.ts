import type {Cell} from "./contracts";
import {atlasGridPath} from "./atlas-grid-transport";
import {transportSchedule} from "./transport-schedule";
export type PortStop={id:string;cityId:string;countryId:string;continent:number;stage:number;dock:Cell};
export type PortRoute={id:string;from:PortStop;to:PortStop;cells:Cell[]};
const key=(point:Cell)=>`${point.x},${point.y}`;

/** Input is the authorized open-ocean set, never all blue terrain. The radius
 * must enclose the entire vessel at every heading (including turns). Eroding
 * water by that square protects the full swept hull between adjacent centres.
 * Only ready, real stops participate; at most N-1 deterministic routes exist. */
export function portRoutes(stops:readonly PortStop[],ocean:readonly Cell[],hullRadius:number):PortRoute[]{
  if(!Number.isInteger(hullRadius)||hullRadius<0||hullRadius>32)throw new Error("Invalid vessel clearance");
  const water=new Set(ocean.filter(p=>Number.isInteger(p.x)&&Number.isInteger(p.y)).map(key));
  const clear=new Set<string>();
  for(const p of ocean){
    if(!water.has(key(p)))continue;
    let safe=true;
    for(let dy=-hullRadius;dy<=hullRadius&&safe;dy++)for(let dx=-hullRadius;dx<=hullRadius;dx++)
      if(!water.has(`${p.x+dx},${p.y+dy}`)){safe=false;break;}
    if(safe)clear.add(key(p));
  }
  // Reject disconnected pairs before path search, rather than walking a whole
  // sea once for every possible pair of ports on a large atlas.
  const components=new Map<string,number>();let component=0;
  for(const id of clear){
    if(components.has(id))continue;
    const [x,y]=id.split(",").map(Number),queue=[{x:x!,y:y!}];components.set(id,component);
    for(let i=0;i<queue.length;i++){
      const p=queue[i]!;
      for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]] as const){
        const next={x:p.x+dx,y:p.y+dy},nextId=key(next);
        if(clear.has(nextId)&&!components.has(nextId)){components.set(nextId,component);queue.push(next);}
      }
    }
    component++;
  }
  const unique=new Map<string,PortStop>(),cities=new Set<string>();
  for(const stop of [...stops].sort((a,b)=>a.id.localeCompare(b.id))){
    if(stop.stage!==5||!stop.id||!stop.cityId||!stop.countryId||unique.has(stop.id)||cities.has(stop.cityId)||!clear.has(key(stop.dock)))continue;
    unique.set(stop.id,stop);cities.add(stop.cityId);
  }
  const ready=[...unique.values()],parents=new Map(ready.map(stop=>[stop.id,stop.id]));
  const root=(id:string):string=>{let value=id;while(parents.get(value)!==value)value=parents.get(value)!;return value;};
  const pairs=ready.flatMap((from,i)=>ready.slice(i+1).filter(to=>to.continent!==from.continent&&components.get(key(from.dock))===components.get(key(to.dock)))
    .map(to=>({from,to,distance:(from.dock.x-to.dock.x)**2+(from.dock.y-to.dock.y)**2})));
  pairs.sort((a,b)=>a.distance-b.distance||a.from.id.localeCompare(b.from.id)||a.to.id.localeCompare(b.to.id));
  const routes:PortRoute[]=[];
  for(const {from,to} of pairs){
    if(root(from.id)===root(to.id))continue;
    const cells=atlasGridPath(from.dock,new Set([key(to.dock)]),clear);
    if(cells.length<2)continue;
    parents.set(root(to.id),root(from.id));
    routes.push({id:transportSchedule("SEA",from.id,to.id).id,from,to,cells});
  }
  return routes.sort((a,b)=>a.id.localeCompare(b.id));
}
