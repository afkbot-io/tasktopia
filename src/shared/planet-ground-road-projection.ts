import type { Cell } from './contracts';
import type { ProjectedPlanetAtlas } from './planet-atlas';
import { atlasGridPath } from './atlas-grid-transport';
import { readPlanetGroundRoads } from './planet-ground-roads';
import { completePreparation,prepareCooperatively,type CooperativePreparationOptions } from './cooperative-preparation';

export type PlanetRoadProjectionLimits={maxGridCells:number;maxProjectSamples:number;maxComparisons:number;maxSearchCells:number;maxOutputPoints:number;maxOutputCells:number};
export const PLANET_ROAD_PROJECTION_LIMITS:Readonly<PlanetRoadProjectionLimits>=Object.freeze({maxGridCells:16_384,maxProjectSamples:40_000,
  maxComparisons:2_000_000,maxSearchCells:100_000,maxOutputPoints:50_000,maxOutputCells:50_000});
type Limits=PlanetRoadProjectionLimits;
export type PlanetRoadFailure='INVALID_GEOMETRY'|'NO_LAND'|'UNPROJECTABLE_ANCHOR'|'DISCONNECTED_LAND'
  |'NO_ORDERED_CORRIDOR'|'TOTAL_BUDGET';
export type PlanetGroundRoadProjection={
  routes:Array<{id:string;countryId:string;fromCityId:string;toCityId:string;points:Cell[];cells:Cell[]}>;
  unavailable:Array<{routeId:string;countryId:string;reason:PlanetRoadFailure}>;
  metrics:{gridCells:number;projectSamples:number;comparisons:number;searchCellsCharged:number;outputPoints:number;outputCells:number};
};
const key=(p:Cell)=>`${p.x},${p.y}`;
const same=(a:Cell,b:Cell)=>a.x===b.x&&a.y===b.y;
const deltas={N:[0,-1],E:[1,0],S:[0,1],W:[-1,0]} as const;
const neighbors=(p:Cell)=>Object.values(deltas).map(([x,y])=>({x:p.x+x,y:p.y+y}));

/** Join ports through cell centres with integer-axis bends. Endpoints stay at
 * the existing city anchors; every segment remains inside the proven cells. */
function displayPoints(cells:Cell[],from:Cell,to:Cell,unit:number):Cell[]{
  const points:Cell[]=[];
  const append=(p:Cell)=>{
    if(points.length&&same(points.at(-1)!,p))return;
    if(points.length>=2){const a=points.at(-2)!,b=points.at(-1)!;
      if((a.x===b.x&&b.x===p.x||a.y===b.y&&b.y===p.y)
        &&(b.x-a.x)*(p.x-b.x)+(b.y-a.y)*(p.y-b.y)>=0)points.pop();}
    points.push(p);
  };
  const center=(p:Cell)=>({x:(p.x+.5)*unit,y:(p.y+.5)*unit});
  const port=(a:Cell,b:Cell)=>{const aa=center(a),bb=center(b);return{x:(aa.x+bb.x)/2,y:(aa.y+bb.y)/2};};
  append({...from});
  if(cells.length===1){append({x:to.x,y:from.y});append({...to});return points;}
  const first=port(cells[0]!,cells[1]!);
  append(cells[0]!.x!==cells[1]!.x?{x:from.x,y:first.y}:{x:first.x,y:from.y});append(first);
  for(let i=1;i<cells.length-1;i++){append(center(cells[i]!));append(port(cells[i]!,cells[i+1]!));}
  const last=points.at(-1)!;
  append(cells.at(-2)!.x!==cells.at(-1)!.x?{x:to.x,y:last.y}:{x:last.x,y:to.y});append({...to});
  return points;
}

/** Cartographic projection of saved routes, not a world connection planner.
 * Search is limited to explicitly inherited dry macro cells and ordered source
 * samples. Work is charged before each bounded local BFS. */
export function* planetGroundRoadProjectionSteps(atlas:ProjectedPlanetAtlas,overrides:Partial<Limits>={}):Generator<void,PlanetGroundRoadProjection,void>{
  const limits={...PLANET_ROAD_PROJECTION_LIMITS,...overrides};
  for(const [name,value] of Object.entries(limits))if(!Object.hasOwn(PLANET_ROAD_PROJECTION_LIMITS,name)
    ||!Number.isSafeInteger(value)||value<=0||value>PLANET_ROAD_PROJECTION_LIMITS[name as keyof Limits])throw new RangeError('Invalid planet road projection limit');
  const result:PlanetGroundRoadProjection={routes:[],unavailable:[],metrics:{gridCells:0,projectSamples:0,comparisons:0,searchCellsCharged:0,outputPoints:0,outputCells:0}};
  const metrics=result.metrics,unit=atlas.hexRadius*2;
  if(!Number.isFinite(unit)||unit<=0)throw new RangeError('Invalid planet road grid');
  const models=readPlanetGroundRoads(atlas.countries.map(country=>({countryId:country.id,
    revision:country.groundRoads?.state==='READY'?country.groundRoads.revision:null,
    routes:country.groundRoads?.routes,cityIds:new Set(country.cities.map(city=>city.id))})));
  yield;
  for(const country of atlas.countries){
    const model=models.get(country.id)!;if(!model.routes.length){yield;continue;}
    const failAll=(reason:PlanetRoadFailure)=>{for(const route of model.routes)result.unavailable.push({routeId:route.id,countryId:country.id,reason});};
    if(country.cells.length>4096||metrics.gridCells+country.cells.length>limits.maxGridCells){failAll('TOTAL_BUDGET');yield;continue;}
    const bounds=country.worldBounds;
    if(!bounds||!Object.values(bounds).every(Number.isSafeInteger)||bounds.minX>bounds.maxX||bounds.minY>bounds.maxY
      ||!Number.isSafeInteger(bounds.maxX-bounds.minX)||!Number.isSafeInteger(bounds.maxY-bounds.minY)){
      failAll('INVALID_GEOMETRY');yield;continue;
    }
    const cells=new Map<string,Cell>(),dry=new Set<string>(),cellIds=new Set<string>(),land:Array<Cell&{id:string}>=[];
    let minQ=Infinity,minR=Infinity,maxQ=-Infinity,maxR=-Infinity,invalid=false;
    for(const cell of country.cells){
      yield;metrics.gridCells++;
      const p={x:cell.q,y:cell.r},id=key(p);
      if(!Number.isSafeInteger(cell.q)||!Number.isSafeInteger(cell.r)||cells.has(id)||typeof cell.id!=='string'
        ||!cell.id||cell.id.length>256||cellIds.has(cell.id)){invalid=true;break;}
      cellIds.add(cell.id);
      cells.set(id,p);minQ=Math.min(minQ,cell.q);maxQ=Math.max(maxQ,cell.q);minR=Math.min(minR,cell.r);maxR=Math.max(maxR,cell.r);
      if(['grass','meadow','forest','hill','mountain','coast','stone'].includes(cell.terrain)){
        dry.add(id);land.push({...p,id:cell.id});
      }
    }
    if(invalid){failAll('INVALID_GEOMETRY');continue;}
    if(!dry.size){failAll('NO_LAND');continue;}
    land.sort((a,b)=>a.id.localeCompare(b.id));
    const components=new Map<string,number>();let component=0;
    for(const p of land){
      const id=key(p);if(components.has(id))continue;
      const queue=[p];components.set(id,component);
      for(let at=0;at<queue.length;at++){
        yield;
        for(const next of neighbors(queue[at]!)){const nextId=key(next);
          if(dry.has(nextId)&&!components.has(nextId)){components.set(nextId,component);queue.push({...next,id:nextId});}
        }
      }
      component++;
    }
    const projected=new Map<string,Cell>();
    function* project(p:Cell):Generator<void,Cell|'TOTAL_BUDGET',void>{
      const id=key(p),known=projected.get(id);if(known)return known;
      if(metrics.projectSamples>=limits.maxProjectSamples)return 'TOTAL_BUDGET';metrics.projectSamples++;
      const q=minQ+(p.x-bounds!.minX)/Math.max(1,bounds!.maxX-bounds!.minX)*(maxQ-minQ);
      const r=minR+(p.y-bounds!.minY)/Math.max(1,bounds!.maxY-bounds!.minY)*(maxR-minR);
      let best:Cell|undefined,distance=Infinity;
      for(const cell of land){
        if(metrics.comparisons>=limits.maxComparisons)return 'TOTAL_BUDGET';
        metrics.comparisons++;if(metrics.comparisons%128===0)yield;
        const d=(cell.x-q)**2+(cell.y-r)**2;
        if(d<distance){distance=d;best=cell;}
      }
      projected.set(id,best!);return best!;
    }
    for(const route of model.routes){
      yield;
      const fail=(reason:PlanetRoadFailure)=>result.unavailable.push({routeId:route.id,countryId:country.id,reason});
      const from=country.cityAnchors[route.fromCityId],to=country.cityAnchors[route.toCityId];
      const anchorCell=(p:Cell|undefined)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)
        ?cells.get(key({x:Math.floor(p.x/unit),y:Math.floor(p.y/unit)})):undefined;
      const first=anchorCell(from),last=anchorCell(to);
      if(!first||!last||!dry.has(key(first))||!dry.has(key(last))||same(from!,to!)){fail('UNPROJECTABLE_ANCHOR');continue;}
      const owner=components.get(key(first));
      if(components.get(key(last))!==owner){fail('DISCONNECTED_LAND');continue;}
      const anchors:Cell[]=[first],positions=new Map([[key(first),0]]);
      const add=(p:Cell)=>{const id=key(p),old=positions.get(id);
        if(old!==undefined){while(anchors.length>old+1)positions.delete(key(anchors.pop()!));}
        else{positions.set(id,anchors.length);anchors.push(p);}
      };
      function* sample(p:Cell):Generator<void,PlanetRoadFailure|undefined,void>{
        const cell=yield* project(p);
        if(typeof cell==='string')return cell;
        if(components.get(key(cell))!==owner)return 'DISCONNECTED_LAND';
        add(cell);yield;
      }
      let error=yield* sample(route.geometry.start),cursor={...route.geometry.start};
      for(const run of route.geometry.runs){
        if(error)break;const [dx,dy]=deltas[run.direction];
        for(let offset=Math.min(8,run.length);;offset=Math.min(offset+8,run.length)){
          error=yield* sample({x:cursor.x+dx*offset,y:cursor.y+dy*offset});if(error||offset===run.length)break;
        }
        cursor={x:cursor.x+dx*run.length,y:cursor.y+dy*run.length};
      }
      if(error){fail(error);continue;}add(last);
      const path=[anchors[0]!],used=new Set([key(anchors[0]!)]),future=new Set(anchors.slice(1).map(key));
      for(let index=1;index<anchors.length;index++){
        yield;const start=path.at(-1)!,goal=anchors[index]!;future.delete(key(goal));
        const adjacent=Math.abs(start.x-goal.x)+Math.abs(start.y-goal.y)===1,charge=adjacent?1:dry.size;
        if(metrics.searchCellsCharged+charge>limits.maxSearchCells){error='TOTAL_BUDGET';break;}
        metrics.searchCellsCharged+=charge;
        // Consecutive source samples usually occupy adjacent inherited cells.
        // That proven edge needs no copy/filter of the whole country's land.
        let leg=adjacent?[start,goal]:atlasGridPath(start,new Set([key(goal)]),
          new Set([...dry].filter(id=>(!used.has(id)||id===key(start))&&!future.has(id))));
        // A coarse source sample can sit on a dry peninsula. Preserve the
        // ordered walk by returning over its proven neck, rather than hiding
        // the accepted connection. Keep future samples blocked and charge
        // this second bounded search before doing any work.
        if(!leg.length){
          if(metrics.searchCellsCharged+dry.size>limits.maxSearchCells){error='TOTAL_BUDGET';break;}
          metrics.searchCellsCharged+=dry.size;
          leg=atlasGridPath(start,new Set([key(goal)]),new Set([...dry].filter(id=>!future.has(id))));
        }
        if(!leg.length){error='NO_ORDERED_CORRIDOR';break;}
        for(const cell of leg.slice(1)){path.push(cell);used.add(key(cell));}
      }
      if(error){fail(error);continue;}
      const points=displayPoints(path,from!,to!,unit);
      if(metrics.outputPoints+points.length>limits.maxOutputPoints||metrics.outputCells+path.length>limits.maxOutputCells){fail('TOTAL_BUDGET');continue;}
      metrics.outputPoints+=points.length;metrics.outputCells+=path.length;
      result.routes.push({id:route.id,countryId:country.id,fromCityId:route.fromCityId,toCityId:route.toCityId,
        points,cells:path.map(p=>({x:p.x,y:p.y}))});
    }
  }
  return result;
}
export function projectPlanetGroundRoads(atlas:ProjectedPlanetAtlas,limits:Partial<Limits>={}){
  return completePreparation(planetGroundRoadProjectionSteps(atlas,limits));
}
export function preparePlanetGroundRoads(atlas:ProjectedPlanetAtlas,limits:Partial<Limits>={},options:CooperativePreparationOptions={}){
  return prepareCooperatively(planetGroundRoadProjectionSteps(atlas,limits),options,256);
}
