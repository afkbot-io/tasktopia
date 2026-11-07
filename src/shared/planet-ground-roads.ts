import { isIntercityRoadClass, type IntercityRoadRoute } from './intercity-roads';
import type { OrthogonalRoadGeometry,OrthogonalDirection } from './semantic-road';

export const PLANET_GROUND_ROAD_LIMITS=Object.freeze({routes:1024,routesPerCountry:100,runs:16_384,worldCells:300_000});
type Omission='CAPACITY'|'INVALID_GEOMETRY'|'MISSING_CITY';
export type PlanetGroundRoads={
  state:'READY'|'MISSING_SNAPSHOT'|'INVALID_SNAPSHOT';revision:number;routes:IntercityRoadRoute[];
  omittedRoutes:number;omittedReasons:Partial<Record<Omission,number>>;
};
export type PlanetGroundRoadSource={countryId:string;revision:number|null;routes:unknown;cityIds:ReadonlySet<string>};
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:undefined;
const identity=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=256;
const deltas:Record<OrthogonalDirection,readonly [number,number]>={N:[0,-1],E:[1,0],S:[0,1],W:[-1,0]};

/** Bounded field whitelist for the atlas read model. It never plans, repairs
 * or expands source roads, and it does not expose planner/private metadata. */
export function readPlanetGroundRoads(sources:readonly PlanetGroundRoadSource[]):Map<string,PlanetGroundRoads> {
  const result=new Map<string,PlanetGroundRoads>();
  let examined=0,examinedRuns=0,worldCells=0;
  const geometry=(value:unknown,maxCells:number):{value:OrthogonalRoadGeometry;length:number}|Omission=>{
    const raw=object(value),start=object(raw?.start),sourceRuns=raw?.runs;
    if(!start||!Number.isSafeInteger(start.x)||!Number.isSafeInteger(start.y)||!Array.isArray(sourceRuns)||!sourceRuns.length)return 'INVALID_GEOMETRY';
    if(sourceRuns.length>PLANET_GROUND_ROAD_LIMITS.runs-examinedRuns)return 'CAPACITY';
    const runs:OrthogonalRoadGeometry['runs']=[];let x=start.x as number,y=start.y as number,length=0;
    for(const source of sourceRuns){
      examinedRuns++;
      const run=object(source);
      if(!run||typeof run.direction!=='string'||!Object.hasOwn(deltas,run.direction)
        ||!Number.isSafeInteger(run.length)||(run.length as number)<=0)return 'INVALID_GEOMETRY';
      const direction=run.direction as OrthogonalDirection,size=run.length as number,[dx,dy]=deltas[direction];
      length+=size;if(!Number.isSafeInteger(length)||length>maxCells)return 'CAPACITY';
      x+=dx*size;y+=dy*size;if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y))return 'INVALID_GEOMETRY';
      runs.push({direction,length:size});
    }
    return {value:{start:{x:start.x as number,y:start.y as number},runs},length};
  };
  for(const source of sources){
    if(!identity(source.countryId)||result.has(source.countryId))throw new RangeError('Invalid atlas road country identity');
    const validRevision=source.revision!==null&&Number.isSafeInteger(source.revision)&&source.revision>=0;
    const target:PlanetGroundRoads={state:'READY',revision:validRevision?Number(source.revision):0,routes:[],omittedRoutes:0,omittedReasons:{}};
    result.set(source.countryId,target);
    if(source.revision===null){target.state='MISSING_SNAPSHOT';continue;}
    if(!validRevision||!Array.isArray(source.routes)){target.state='INVALID_SNAPSHOT';continue;}
    const omit=(reason:Omission,count=1)=>{target.omittedRoutes+=count;target.omittedReasons[reason]=(target.omittedReasons[reason]??0)+count;};
    const ids=new Set<string>();
    for(let index=0;index<source.routes.length;index++){
      if(index>=PLANET_GROUND_ROAD_LIMITS.routesPerCountry||examined>=PLANET_GROUND_ROAD_LIMITS.routes){
        omit('CAPACITY',source.routes.length-index);break;
      }
      examined++;
      const raw=object(source.routes[index]);
      if(!raw||!identity(raw.id)||ids.has(raw.id)||!identity(raw.fromCityId)||!identity(raw.toCityId)
        ||raw.fromCityId===raw.toCityId||!identity(raw.fromNodeId)||!identity(raw.toNodeId)||raw.widthCells!==3){omit('INVALID_GEOMETRY');continue;}
      if(raw.roadClass!==undefined&&!isIntercityRoadClass(raw.roadClass)){omit('INVALID_GEOMETRY');continue;}
      if(!source.cityIds.has(raw.fromCityId)||!source.cityIds.has(raw.toCityId)){omit('MISSING_CITY');continue;}
      const path=geometry(raw.geometry,PLANET_GROUND_ROAD_LIMITS.worldCells-worldCells);
      if(typeof path==='string'){omit(path);continue;}
      const bridges:OrthogonalRoadGeometry[]=[];let failure:Omission|undefined;
      if(raw.bridges!==undefined){
        if(!Array.isArray(raw.bridges)){omit('INVALID_GEOMETRY');continue;}
        if(raw.bridges.length>PLANET_GROUND_ROAD_LIMITS.runs-examinedRuns){omit('CAPACITY');continue;}
        for(const bridge of raw.bridges){
          const span=geometry(bridge,64);
          if(typeof span==='string'){failure=span;break;}
          if(span.length<8||span.value.runs.length!==1){failure='INVALID_GEOMETRY';break;}
          bridges.push(span.value);
        }
      }
      if(failure){omit(failure);continue;}
      ids.add(raw.id);worldCells+=path.length;
      target.routes.push({id:raw.id,fromCityId:raw.fromCityId,toCityId:raw.toCityId,
        fromNodeId:raw.fromNodeId,toNodeId:raw.toNodeId,widthCells:3,geometry:path.value,
        ...(raw.roadClass!==undefined?{roadClass:raw.roadClass}:{}),
        ...(raw.bridges!==undefined?{bridges}:{})});
    }
  }
  return result;
}
