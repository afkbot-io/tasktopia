import { expect,it } from 'vitest';
import { planIntercityRoads } from '../src/server/world/intercity-road-planner';
import { intercityRoadRasterNetwork, type IntercityRoadRoute } from '../src/shared/intercity-roads';
import { rasterizeBlockRoads } from '../src/shared/road-raster';
import { readPlanetGroundRoads } from '../src/shared/planet-ground-roads';
import { roadAtlasTile } from '../src/shared/road-atlas';
import { buildMobilityNetwork,mobilityNetworkSignature } from '../src/client/city-mobility-network';
import { compactRoadRuns,expandRoadRuns } from '../src/shared/world-cell-runs';

const city=(id:string,x:number,y=0)=>({id,blocks:[{origin:{x,y},width:8,height:8}],nodes:[{id:`${id}:exit`,x,y}]});
const request={countryId:'hierarchy',seed:73,isBuildable:()=>true,cities:[city('a',0),city('b',96)]};
it.each([[504,0,'COLLECTOR'],[512,0,'ARTERIAL'],[-256,-248,'COLLECTOR'],[-256,-256,'ARTERIAL']] as const)('classifies only a new route by its endpoint span %s,%s', (x,y,expected)=>{
  const plan=planIntercityRoads({...request,cities:[city('a',0),city('b',x,y)]});
  expect(plan.routes).toHaveLength(1);expect(plan.routes[0]!.roadClass).toBe(expected);
  expect(plan.routes[0]!.widthCells).toBe(3);
});
it('keeps a retained legacy road byte-for-byte without painting it as a new collector',()=>{
  const first=planIntercityRoads(request);
  const legacy=structuredClone(first);delete legacy.routes[0]!.roadClass;
  const before=JSON.stringify(legacy);
  const next=planIntercityRoads({...request,previous:legacy,cities:[...request.cities,city('c',800)]});
  expect(JSON.stringify(legacy)).toBe(before);expect(next.routes[0]).toBe(legacy.routes[0]);
  expect(next.routes[1]!.roadClass).toBe('ARTERIAL');
  expect(intercityRoadRasterNetwork(legacy.routes).segments[0]!.roadClass).toBe('LOCAL');
  for(const roadClass of [null,'HIGHWAY','SERVICE','toString'])expect(()=>planIntercityRoads({...request,
    previous:{...first,routes:[{...first.routes[0]!,roadClass} as IntercityRoadRoute]}})).toThrow(/class/i);
});
it('preserves the canonical class through planet whitelist, road/bridge raster and native tile selection',()=>{
  const source=planIntercityRoads(request).routes[0]!;
  const classified={...source,roadClass:'ARTERIAL' as const,
    bridges:[{...source.geometry,runs:[{...source.geometry.runs[0]!,length:16}]}]};
  const result=readPlanetGroundRoads([{countryId:'hierarchy',revision:1,cityIds:new Set(['a','b']),
    routes:[classified,{...classified,id:'invalid',roadClass:'HIGHWAY'}]}]).get('hierarchy')!;
  expect(result.routes).toEqual([classified]);expect(result.omittedReasons).toEqual({INVALID_GEOMETRY:1});
  const network=intercityRoadRasterNetwork(result.routes);
  expect(network.segments.map(s=>s.roadClass)).toEqual(['ARTERIAL','ARTERIAL']);
  const plain=rasterizeBlockRoads(intercityRoadRasterNetwork([{...source,roadClass:'ARTERIAL'}]));
  const local=rasterizeBlockRoads(intercityRoadRasterNetwork([{...source,roadClass:undefined}]));
  expect(plain.map(({x,y,mask})=>({x,y,mask}))).toEqual(local.map(({x,y,mask})=>({x,y,mask})));
  expect(plain.every(c=>c.roadClass==='ARTERIAL')).toBe(true);
  expect(plain.every(c=>c.widthCells===3)).toBe(true);
  expect(expandRoadRuns(compactRoadRuns(plain))).toEqual(plain);
  expect(roadAtlasTile(plain[0]!).sourceY).not.toBe(roadAtlasTile(local[0]!).sourceY);
  const bridgeRaster=rasterizeBlockRoads(network);
  expect(bridgeRaster.every(c=>c.roadClass==='ARTERIAL')).toBe(true);
  expect(bridgeRaster.some(c=>c.structure==='BRIDGE')).toBe(true);
  expect(bridgeRaster.some(c=>c.structure==='ROAD')).toBe(true);
});
it('preserves directed travel lanes when the same three-cell corridor changes material',()=>{
  const route=planIntercityRoads(request).routes[0]!;
  const loops=[0,96].map((x,i)=>({...route,id:`loop-${i}`,geometry:{start:{x,y:0},runs:[
    {direction:'E' as const,length:16},{direction:'S' as const,length:16},{direction:'W' as const,length:16},{direction:'N' as const,length:16},
  ]},roadClass:undefined}));
  const network=(roadClass:IntercityRoadRoute['roadClass'])=>buildMobilityNetwork({
    roads:new Map(rasterizeBlockRoads(intercityRoadRasterNetwork([...loops,{...route,roadClass}])).map(c=>[`${c.x},${c.y}`,c])),
    walkGraph:new Map(),crosswalks:new Set(),activityCells:new Set(),
  });
  const local=network(undefined),arterial=network('ARTERIAL');
  expect(local.carEdges.size).toBeGreaterThan(100);
  expect([...arterial.carEdges]).toEqual([...local.carEdges]);
  const seen=new Set(['16,1']),queue=[{x:16,y:1}];
  for(let i=0;i<queue.length;i++)for(const p of arterial.carEdges.get(`${queue[i]!.x},${queue[i]!.y}`)??[]){
    const key=`${p.x},${p.y}`;if(!seen.has(key)){seen.add(key);queue.push(p);}
  }
  expect(seen.has('80,1')).toBe(true);
  expect(arterial.carEdges.get('48,1')).toContainEqual({x:49,y:1});
  expect(arterial.carEdges.get('48,1')).not.toContainEqual({x:47,y:1});
});
it('does not merge a narrow profile with an adjacent legacy broad profile in compressed JSON',()=>{
  const cells=Array.from({length:4},(_,x)=>({x,y:0,mask:10,structure:'ROAD' as const,roadClass:'ARTERIAL' as const,
    ...(x<2?{widthCells:3 as const}:{})}));
  const runs=compactRoadRuns(cells);
  expect(runs).toHaveLength(2);
  expect(expandRoadRuns(JSON.parse(JSON.stringify(runs)))).toEqual(cells);
});
it('invalidates retained mobility when explicit physical width changes at the same material and coordinates',()=>{
  const cell={x:0,y:0,mask:15,structure:'ROAD' as const,roadClass:'ARTERIAL' as const};
  const input={roads:new Map([['0,0',cell]]),walkGraph:new Map(),crosswalks:new Set<string>(),activityCells:new Set<string>()};
  expect(mobilityNetworkSignature({...input,roads:new Map([['0,0',{...cell,widthCells:3}]])}))
    .not.toBe(mobilityNetworkSignature(input));
});
