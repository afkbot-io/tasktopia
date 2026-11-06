import {expect,it} from 'vitest';
import {resolveCityTransportFurniture} from '../src/shared/city-transport-furniture';
import {planAirportSite} from '../src/shared/airport-site';
import {cityRailwayPassengerPaths,type CityRailway} from '../src/shared/city-railway';
import {isBuildableTerrain,terrainAt} from '../src/shared/world-terrain';
import type {Cell} from '../src/shared/contracts';
import {buildCityWalkNetwork} from '../src/client/city-walk-network';
import {PROP_CATALOG} from '../src/shared/catalog';

const plan=planAirportSite({bounds:{minX:0,minY:0,maxX:30,maxY:30},entrance:{x:15,y:20},occupied:[],isDry:()=>true})!;
const railway:CityRailway={stationId:'rail',axis:'horizontal',from:{x:-100,y:40},to:{x:100,y:40},platform:{x:0,y:40},
  access:[{x:3,y:48},{x:3,y:42}],stage:5,running:true};
const taskMap=new Map([['air',{stage:5,status:'COMPLETED',serviceRole:'AIRPORT'}],['rail',{stage:5,status:'COMPLETED',serviceRole:'RAILWAY'}]]);
const input={airports:[{taskId:'air',stage:5,plan}],railway,tasks:{get:(id:string)=>taskMap.get(id)},free:()=>true};

it('places deterministic furniture in protected free pockets, clear of actual passenger paths',()=>{
  let reads=0;const before=JSON.stringify({plan,railway});
  const props=resolveCityTransportFurniture({...input,free:()=>{reads++;return true;}});
  expect(props.map(p=>p.kind)).toEqual(['airport-windsock','rail-platform-clock']);
  expect(props).toEqual(resolveCityTransportFurniture(input));expect(reads).toBeLessThan(100);
  for(const prop of props)expect(prop.id).toContain(prop.taskId);
  const paths=new Set([0,-1].flatMap(lane=>{const p=cityRailwayPassengerPaths(railway,lane as 0|-1);return [...p.access,...p.bridge,...p.platform,...p.boardingCells];}).map(p=>`${p.x},${p.y}`));
  const clock=props.find(p=>p.kind==='rail-platform-clock')!;
  for(let y=-1;y<=0;y++)for(let x=-1;x<=1;x++)expect(paths.has(`${clock.origin.x+x},${clock.origin.y+y}`)).toBe(false);
  expect(clock.origin.x).toBeGreaterThanOrEqual(railway.from.x);expect(clock.origin.x).toBeLessThan(railway.to.x);
  expect(clock.origin.y).toBeGreaterThan(railway.from.y);
  expect(clock.origin.y).toBeLessThanOrEqual(railway.from.y+3);
  expect(JSON.stringify({plan,railway})).toBe(before);
  const otherEnd=resolveCityTransportFurniture({...input,airports:[],free:p=>p.x>railway.platform.x});
  expect(otherEnd[0]?.origin).toEqual({x:5,y:42});
});
it('fails closed for water/obstacles, missing/deleted/incomplete/wrong-role tasks and malformed plans',()=>{
  expect(resolveCityTransportFurniture({...input,free:()=>false})).toEqual([]);
  for(const task of [undefined,{stage:4,status:'TESTING',serviceRole:'AIRPORT'},{stage:5,status:'COMPLETED',serviceRole:'SHOP'}]){
    expect(resolveCityTransportFurniture({...input,railway:undefined,tasks:{get:()=>task}})).toEqual([]);
  }
  expect(resolveCityTransportFurniture({...input,airports:[{taskId:'air',stage:4,plan}],railway:undefined})).toEqual([]);
  expect(resolveCityTransportFurniture({...input,airports:[{taskId:'air',stage:5,plan:{...plan,airfield:{...plan.airfield,maxX:NaN}}}],railway:undefined})).toEqual([]);
  expect(resolveCityTransportFurniture({...input,airports:[],railway:{...railway,from:{x:NaN,y:40}}})).toEqual([]);
  expect(resolveCityTransportFurniture({...input,airports:[],railway:{...railway,access:[{x:Number.MAX_SAFE_INTEGER,y:42},{x:3,y:40}]}})).toEqual([]);
  const oversized=new Proxy(Array<Cell>(4097),{get(target,key,receiver){if(key===Symbol.iterator)throw new Error('Oversized access must not be enumerated');return Reflect.get(target,key,receiver);}});
  expect(resolveCityTransportFurniture({...input,airports:[],railway:{...railway,access:oversized}})).toEqual([]);
});
it('preserves source-authored upright orientation on a vertical corridor and never searches past its fixed budget',()=>{
  const vertical={...railway,axis:'vertical' as const,from:{x:40,y:-100},to:{x:40,y:100},platform:{x:40,y:0},access:[{x:48,y:3},{x:42,y:3}]};
  const props=resolveCityTransportFurniture({...input,airports:[],railway:vertical});
  expect(props).toEqual([{id:'transport-furniture:rail:clock',taskId:'rail',kind:'rail-platform-clock',origin:{x:42,y:-22}}]);
  let reads=0;resolveCityTransportFurniture({...input,airports:Array.from({length:10000},(_,i)=>({taskId:`air${i}`,stage:5,plan})),
    tasks:{get:()=>taskMap.get('air')},free:()=>{reads++;return false;}});
  expect(reads).toBeLessThanOrEqual(256);
});
it('does not invent a dry pedestal for the native seed1 coastal platform from live QA',()=>{
  const wetLine={...railway,from:{x:-91,y:64},to:{x:579,y:64},platform:{x:229,y:64},access:[{x:229,y:66},{x:229,y:65},{x:229,y:64}]};
  expect(resolveCityTransportFurniture({...input,airports:[],railway:wetLine,free:p=>isBuildableTerrain(terrainAt(1,p.x,p.y).terrain)})).toEqual([]);
});
it('uses the published1x1 contact in the actual walking mask and frees it when the owner disappears',()=>{
  const props=resolveCityTransportFurniture(input);
  const cells=props.flatMap(prop=>[-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>({x:prop.origin.x+dx,y:prop.origin.y+dy}))));
  const base={roads:new Map(),terrain:cells.map(p=>({...p,terrain:'GRASS' as const,variant:0})),surfaces:cells.map(p=>({...p,kind:'PATH' as const})),tasks:[],features:[]};
  const occupied=buildCityWalkNetwork({...base,decorations:props}),removed=buildCityWalkNetwork({...base,decorations:[]});
  for(const prop of props){
    expect(PROP_CATALOG[prop.kind]?.footprint).toEqual({width:1,height:1});
    const id=`${prop.origin.x},${prop.origin.y}`,next=`${prop.origin.x+1},${prop.origin.y}`;
    expect(occupied.blockedCells.has(id)).toBe(true);expect(occupied.walkGraph.has(id)).toBe(false);
    expect(occupied.walkGraph.has(next)).toBe(true);expect(removed.blockedCells.has(id)).toBe(false);expect(removed.walkGraph.has(id)).toBe(true);
  }
});
