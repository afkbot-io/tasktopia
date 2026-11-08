import { expect, it } from "vitest";
import { createCityMovementDependencies,needsMovementPreparation } from "../src/client/city-movement-dependencies";
import type { ChunkDto, ChunkTaskDto } from "../src/shared/contracts";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import { baselineCityMovementDependencies } from "./fixtures/city-movement-dependencies-baseline";

it("uses complete CITY geometry after authoritative resync but keeps unknown/unscoped forced preparation",()=>{
  const ready={mobilityReady:true,forced:true,geometryChanged:false};
  expect(needsMovementPreparation({...ready,authoritativeCity:true})).toBe(false);
  expect(needsMovementPreparation({...ready,authoritativeCity:false})).toBe(true);
  expect(needsMovementPreparation({...ready,authoritativeCity:true,geometryChanged:true})).toBe(true);
  expect(needsMovementPreparation({...ready,authoritativeCity:true,mobilityReady:false})).toBe(true);
  expect(needsMovementPreparation({...ready,authoritativeCity:true,geometryChanged:true,snapshotReady:false})).toBe(false);
});

it("keeps physical paths for title/progress/version changes but detects a door, fence or parking change", () => {
  const task = {id:"a",stage:3,progress:40,status:"IN_PROGRESS",visualKind:"BUILDING",visualAssetKey:"house",footprint:[{x:2,y:2}],accessPath:[{x:2,y:3}]} as ChunkTaskDto;
  const chunk = {chunkX:0,chunkY:0,terrain:[],roads:[],surfaces:[],decorations:[],tasks:[task]} as unknown as ChunkDto;
  const read = createCityMovementDependencies();
  const original = read([chunk],[],undefined);
  const metadata = read([{...chunk,worldVersion:10,tasks:[{...task,title:"renamed",progress:45}]}],[],undefined);
  expect(metadata.geometry).toBe(original.geometry);
  expect(metadata.life).toBe(original.life);
  expect(read([{...chunk,tasks:[{...task,stage:5,status:"COMPLETED"}]}],[],undefined).geometry).not.toBe(original.geometry);
  expect(read([{...chunk,tasks:[{...task,accessPath:[{x:3,y:3}]}]}],[],undefined).geometry).not.toBe(original.geometry);
  const parking = {...task,stage:5 as const,visualAssetKey:"urban-parking",status:"COMPLETED" as const};
  expect(read([chunk],[parking],undefined).geometry).not.toBe(read([chunk],[{...parking,status:"TESTING"}],undefined).geometry);
  const feature = {id:"stop",kind:"BUS_STOP",assetKind:"BUILDING",assetKey:"shelter",developmentStage:5,footprint:[{x:10,y:10}],accessPath:[{x:10,y:11}]} as ChunkDto["worldFeatures"][number];
  const firstFeature=read([{...chunk,worldFeatures:[feature]}],[],undefined);
  expect(read([{...chunk,worldFeatures:[{...feature,accessPath:[{x:11,y:11}]}]}],[],undefined).geometry).not.toBe(firstFeature.geometry);
});

it("invalidates eligible resident destinations on role, completion or incident changes without rebuilding identical physical geometry",()=>{
 const task={id:"school",stage:5,status:"COMPLETED",serviceRole:"EDUCATION",workItemType:"TASK",visualKind:"BUILDING",visualAssetKey:"school",footprint:[{x:2,y:2}],accessPath:[{x:2,y:3}]} as ChunkTaskDto;
 const chunk={chunkX:0,chunkY:0,terrain:[],roads:[],surfaces:[],decorations:[],tasks:[task]} as unknown as ChunkDto;
 for(const changed of [{...task,serviceRole:"SHOP" as const},{...task,status:"TESTING" as const},{...task,defectSummary:{open:1,inProgress:0,verifying:0,active:1}}]){
  const read=createCityMovementDependencies(),before=read([chunk],[]),after=read([{...chunk,tasks:[changed]}],[]);
  expect(after.geometry).toBe(before.geometry);expect(after.life).toBeGreaterThan(before.life);
 }
});


it("tracks immutable task geometry without eagerly reading or retaining every footprint coordinate", () => {
  let reads=0;
  const tasks=Array.from({length:128},(_,id)=>({id:`task-${id}`,taskNumber:id,stage:5,status:"COMPLETED",visualKind:"BUILDING",visualAssetKey:"house",
    footprint:Array.from({length:64},(_,i)=>({get x(){reads++;return id*8+i%8;},get y(){reads++;return Math.floor(i/8);}})),
    accessPath:[{x:id*8,y:8}]} as ChunkTaskDto));
  const chunk={chunkX:0,chunkY:0,terrain:[],roads:[],surfaces:[],decorations:[],worldFeatures:[],tasks} as unknown as ChunkDto;
  const read=createCityMovementDependencies(),first=read([chunk],[]);
  expect(reads,'Dependency creation must reference immutable geometry instead of copying its coordinates to text').toBe(0);
  expect(read([{...chunk,tasks:tasks.map(task=>({...task,title:'metadata only',progress:80}))}],[])).toEqual(first);
  expect(reads,'A metadata replacement has the same immutable footprint and access path').toBe(0);
});


it("matches the frozen baseline through immutable geometry, life, transport and ordering changes", () => {
  const task={id:"a",taskNumber:1,stage:3,progress:30,status:"IN_PROGRESS",visualKind:"BUILDING",visualAssetKey:"house",serviceRole:"EDUCATION",workItemType:"TASK",
    footprint:[{x:-2,y:3},{x:-1,y:3}],accessPath:[{x:-1,y:4}]} as ChunkTaskDto;
  const feature={id:"stop",kind:"BUS_STOP",assetKind:"BUILDING",assetKey:"shelter",developmentStage:5,footprint:[{x:10,y:10}],accessPath:[{x:10,y:11}]} as ChunkDto["worldFeatures"][number];
  const chunk={chunkX:0,chunkY:0,terrain:[{x:0,y:0,terrain:"GRASS"}],roads:[{x:0,y:0,roadClass:"LOCAL",mask:1,structure:"SURFACE"}],surfaces:[{x:1,y:0,kind:"PATH"}],decorations:[],worldFeatures:[feature],tasks:[task]} as unknown as ChunkDto;
  const scene={railway:{route:[{x:2,y:2}]},airports:[],ports:[],airportConnections:[],railConnections:[],seaConnections:[],intercityRoads:[]} as unknown as CitySceneDto;
  const variants:Partial<ChunkTaskDto>[]=[
    {title:"renamed",progress:95}, {stage:4}, {stage:5}, {status:"COMPLETED"},
    {footprint:[{x:-3,y:3},{x:-2,y:3}]}, {accessPath:[{x:-2,y:4}]}, {serviceRole:"SHOP"},
    {defectSummary:{open:1,inProgress:0,verifying:0,active:1}},
    {defectSummary:{open:0,inProgress:1,verifying:0,active:1}},
    {defectSummary:{open:0,inProgress:0,verifying:1,active:1}},
    {defectSummary:{open:0,inProgress:0,verifying:0,active:0}},
    {workItemType:"HOTFIX",status:"IN_PROGRESS"}, {workItemType:"HOTFIX",status:"TESTING"},
    {visualAssetKey:"urban-parking",status:"COMPLETED",stage:5}, {visualAssetKey:"urban-parking",status:"TESTING",stage:5},
    {visualKind:"PARK"}, {taskNumber:2}, {id:"another"},
    {footprint:[{y:3,x:-2},{x:-1,y:3}]}, {serviceRole:undefined},
  ];
  const actual=createCityMovementDependencies(),baseline=baselineCityMovementDependencies();
  const check=(chunks:ChunkDto[],completed:ChunkTaskDto[]=[],transport:CitySceneDto|undefined=scene)=>{
    expect(actual(chunks,completed,transport)).toEqual(baseline(chunks,completed,transport));
    expect(actual(chunks,completed,transport)).toEqual(baseline(chunks,completed,transport));
    const copies=structuredClone({chunks,completed,transport});
    expect(actual(copies.chunks,copies.completed,copies.transport)).toEqual(baseline(copies.chunks,copies.completed,copies.transport));
  };
  check([chunk]);
  for(const patch of variants)check([{...chunk,tasks:[{...task,...patch}]}]);
  check([{...chunk,tasks:[task,{...task,id:"b"}]}]);
  check([{...chunk,tasks:[{...task,id:"b"},task]}]);
  check([{...chunk,tasks:[]}]);check([chunk],[{...task,id:"completed",stage:5}]);
  check([chunk],[]);check([]);check([chunk,{...chunk,chunkX:1}]);check([{...chunk,chunkX:1},chunk]);
  check([{...chunk,worldFeatures:[{...feature,accessPath:[{x:11,y:11}]}]}]);
  check([{...chunk,worldFeatures:[{...feature,developmentStage:4}]}]);
  check([{...chunk,worldFeatures:[]}]);
  check([{...chunk,roads:[{...chunk.roads[0]!,mask:2}]}]);
  check([{...chunk,surfaces:[]}]);check([{...chunk,terrain:[]}]);
  check([{...chunk,decorations:[{id:"bench",origin:{x:3,y:4},kind:"bench-horizontal"}]}]);
  for(const field of ['railway','airports','ports','airportConnections','railConnections','seaConnections','intercityRoads']){
    check([chunk],[],{...scene,[field]:[{id:field,route:[{x:2,y:3}]}]} as unknown as CitySceneDto);
  }
  expect(actual([chunk],[],undefined)).toEqual(baseline([chunk],[],undefined));
  check([chunk],[],{...scene,railway:undefined} as unknown as CitySceneDto);
});
