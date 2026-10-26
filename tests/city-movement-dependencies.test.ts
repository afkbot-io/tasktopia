import { expect, it } from "vitest";
import { createCityMovementDependencies,needsMovementPreparation } from "../src/client/city-movement-dependencies";
import type { ChunkDto, ChunkTaskDto } from "../src/shared/contracts";

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
