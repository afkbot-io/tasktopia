import type {Cell} from "./contracts";
import {atlasGridPath} from "./atlas-grid-transport";
import {transportSchedule} from "./transport-schedule";
import {retainedTransportNetwork,type TransportNetworkEdge} from "./transport-network";
export type PortStop={id:string;cityId:string;countryId:string;continent:number;stage:number;dock:Cell};
export type PortRoute={id:string;from:PortStop;to:PortStop;cells:Cell[]};
const key=(point:Cell)=>`${point.x},${point.y}`;

/** Input is the authorized open-ocean set, never all blue terrain. The radius
 * must enclose the entire vessel at every heading (including turns). Eroding
 * water by that square protects the full swept hull between adjacent centres.
 * Only ready, real stops participate; at most N-1 deterministic routes exist. */
export function portRoutes(stops:readonly PortStop[],ocean:readonly Cell[],hullRadius:number,previous:readonly TransportNetworkEdge[]=[]):PortRoute[]{
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
  const groups=new Map<number,PortStop[]>();
  for(const stop of unique.values()){const component=components.get(key(stop.dock))!,group=groups.get(component)??[];group.push(stop);groups.set(component,group);}
  const pairs=[...groups.values()].flatMap(group=>{
    const byCity=new Map(group.map(stop=>[stop.cityId,stop]));
    return retainedTransportNetwork(group.map(stop=>({taskId:stop.id,cityId:stop.cityId,point:stop.dock})),previous)
      .map(edge=>({from:byCity.get(edge.fromCityId)!,to:byCity.get(edge.toCityId)!}));
  });
  const routes:PortRoute[]=[];
  for(const {from,to} of pairs){
    const cells=atlasGridPath(from.dock,new Set([key(to.dock)]),clear);
    if(cells.length<2)continue;
    routes.push({id:transportSchedule("SEA",from.id,to.id).id,from,to,cells});
  }
  return routes.sort((a,b)=>a.id.localeCompare(b.id));
}
