import { expect,it } from 'vitest';
import { projectPlanetGroundRoads,preparePlanetGroundRoads } from '../src/shared/planet-ground-road-projection';
import type { ProjectedPlanetAtlas } from '../src/shared/planet-atlas';
import { readPlanetGroundRoads } from '../src/shared/planet-ground-roads';

function fixture():ProjectedPlanetAtlas {
  const road={id:'saved-road',fromCityId:'a',toCityId:'b',fromNodeId:'an',toNodeId:'bn',widthCells:3,
    geometry:{start:{x:0,y:0},runs:[{direction:'E',length:32}]}};
  const country={id:'country',name:'Road country',seed:1,worldVersion:1,cityCount:2,districtCount:2,buildingCount:2,
    unfinishedBuildingCount:0,progress:100,worldBounds:{minX:0,minY:0,maxX:32,maxY:8},
    cities:[{id:'a',center:{x:0,y:0},districts:[],airports:[]},{id:'b',center:{x:32,y:0},districts:[],airports:[]}],
    cells:Array.from({length:5},(_,q)=>({id:`c${q}`,q,r:0,terrain:'grass' as const})),
    cityAnchors:{a:{x:4,y:4},b:{x:36,y:4}},districtIcons:[],airports:[],center:{x:20,y:4},continent:0,color:'#000',accent:'#fff',
    groundRoads:readPlanetGroundRoads([{countryId:'country',revision:7,routes:[road],cityIds:new Set(['a','b'])}]).get('country')!};
  return {width:1000,height:700,hexRadius:4,viewBox:'0 0 1000 700',oceanCells:[],coastCells:[],countries:[country],routes:[],clouds:[],stars:[],edgeFog:[]};
}
it('keeps canonical identity and existing anchors on a dry orthogonal route without moving geography',()=>{
  const atlas=fixture(),before=structuredClone(atlas),result=projectPlanetGroundRoads(atlas);
  expect(result.unavailable).toEqual([]);expect(result.routes).toHaveLength(1);
  const route=result.routes[0]!;
  expect(route).toMatchObject({id:'saved-road',countryId:'country',fromCityId:'a',toCityId:'b'});
  expect(route.points[0]).toEqual({x:4,y:4});expect(route.points.at(-1)).toEqual({x:36,y:4});
  expect(route.cells).toEqual(Array.from({length:5},(_,x)=>({x,y:0})));
  for(let i=1;i<route.points.length;i++)expect(route.points[i]!.x===route.points[i-1]!.x||route.points[i]!.y===route.points[i-1]!.y).toBe(true);
  expect(atlas).toEqual(before);expect(projectPlanetGroundRoads(atlas)).toEqual(result);
});
it('retains the order of canonical bends and detours only through inherited dry cells',()=>{
  const atlas=fixture(),country=atlas.countries[0]!;
  country.worldBounds!.maxY=16;country.cityAnchors.b={x:36,y:20};country.cities[1]!.center={x:32,y:16};
  country.cells=Array.from({length:15},(_,i)=>({id:`c${i}`,q:i%5,r:Math.floor(i/5),terrain:i===2?'river':'grass'}));
  country.groundRoads!.routes[0]!.geometry.runs.push({direction:'S',length:16});
  const result=projectPlanetGroundRoads(atlas);expect(result.routes).toHaveLength(1);
  const cells=result.routes[0]!.cells;
  expect(cells.some(p=>p.x===2&&p.y===0)).toBe(false);
  expect(cells.findIndex(p=>p.x===4&&p.y===0)).toBeLessThan(cells.findIndex(p=>p.x===4&&p.y===2));
  for(let i=1;i<cells.length;i++)expect(Math.abs(cells[i]!.x-cells[i-1]!.x)+Math.abs(cells[i]!.y-cells[i-1]!.y)).toBe(1);
});
it('omits a disconnected crossing or missing anchor without a water chord or a synthetic endpoint',()=>{
  const atlas=fixture();atlas.countries[0]!.cells=atlas.countries[0]!.cells.filter(c=>c.q===0||c.q===4);
  const disconnected=projectPlanetGroundRoads(atlas);expect(disconnected.routes).toEqual([]);
  expect(disconnected.unavailable).toContainEqual(expect.objectContaining({routeId:'saved-road',reason:'DISCONNECTED_LAND'}));
  const missing=fixture();delete (missing.countries[0]!.cityAnchors as Record<string,unknown>).b;
  expect(projectPlanetGroundRoads(missing).unavailable).toContainEqual(expect.objectContaining({reason:'UNPROJECTABLE_ANCHOR'}));
  const legacy=fixture();delete legacy.countries[0]!.groundRoads;expect(projectPlanetGroundRoads(legacy).routes).toEqual([]);
});
it('bounds source projection work and supports pre-abort and mid-preparation cancellation',async()=>{
  const limited=projectPlanetGroundRoads(fixture(),{maxProjectSamples:1});expect(limited.routes).toEqual([]);
  expect(limited.metrics.projectSamples).toBeLessThanOrEqual(1);
  expect(limited.unavailable).toContainEqual(expect.objectContaining({reason:'TOTAL_BUDGET'}));
  const controller=new AbortController();controller.abort();let reads=0;
  const atlas=fixture();Object.defineProperty(atlas,'countries',{get(){reads++;throw new Error('Must not inspect cancelled input');}});
  await expect(preparePlanetGroundRoads(atlas,{}, {signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(reads).toBe(0);
  const midway=new AbortController();
  await expect(preparePlanetGroundRoads(fixture(),{}, {signal:midway.signal,maxOperations:1,now:()=>0,
    yieldTask:async()=>{midway.abort();}})).rejects.toMatchObject({name:'AbortError'});
});
