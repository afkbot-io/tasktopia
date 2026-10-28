import { expect, it } from "vitest";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import { packCitySceneTransfer, hydrateCitySceneTransfer } from "../src/client/city-scene-transfer";

const scene = (count = 3): CitySceneDto => {
  const runs = Array.from({length:count},(_,i)=>({start:{x:i===0?-0:-i,y:i},end:{x:-i,y:i+1},orientation:"vertical",optional:undefined}));
  const tasks=[{id:"task",footprint:[{x:1,y:2}]}];
  return {schemaVersion:5,sceneRevision:"test",city:{id:"city"},chunks:[{roadRuns:runs,surfaceRuns:runs,districts:[{id:"d",cellRuns:runs}],
    tasks,decorationContext:{surfaceHaloRuns:runs,blockedCellRuns:runs,districts:[{id:"d",cellRuns:runs}],tasks}}],
    completedDistrictSnapshots:[{tasks}]} as unknown as CitySceneDto;
};

it("transfers50k runs through two genuinely detachable buffers without a plain start/end object forest",async()=>{
  const original=scene(50_000),packed=packCitySceneTransfer(original);
  expect(packed.coordinates.byteLength).toBe(50_000*4*8);
  expect(packed.metadataIndices.byteLength).toBe(50_000*4);
  expect(Array.isArray((packed.scene as CitySceneDto).chunks[0]!.roadRuns)).toBe(false);
  expect(packed.metadata.length).toBeLessThanOrEqual(2);expect(packed.arrays).toHaveLength(1);
  const seen=new WeakSet<object>();let plainObjects=0;
  const visit=(value:unknown)=>{
    if(!value||typeof value!=="object"||seen.has(value)||ArrayBuffer.isView(value)||value instanceof ArrayBuffer)return;
    seen.add(value);if(!Array.isArray(value))plainObjects++;
    for(const next of Object.values(value))visit(next);
  };
  visit(packed);expect(plainObjects).toBeLessThan(100);
  const received=structuredClone(packed,{transfer:[packed.coordinates.buffer,packed.metadataIndices.buffer]});
  expect(packed.coordinates.byteLength).toBe(0);expect(packed.metadataIndices.byteLength).toBe(0);
  const restored=await hydrateCitySceneTransfer(received);
  expect(restored).toEqual(original);
  expect(restored.chunks[0]!.roadRuns).toBe(restored.chunks[0]!.surfaceRuns);
  expect(original.chunks[0]!.roadRuns).toHaveLength(50_000);
});

it("keeps legacy already-decoded scene replies compatible",async()=>{
  const original=scene();expect(await hydrateCitySceneTransfer(original)).toBe(original);
});

it("preserves every run kind, extras, direction, empty arrays and absent versus undefined metadata",async()=>{
  const input=scene(),chunk=input.chunks[0]!;
  const road={start:{x:-13,y:-0,label:"start"},end:{x:-13,y:-11},mask:3,structure:"bridge",roadClass:undefined,orientation:"backward",extra:{active:false}};
  const pavement={start:{x:8,y:-2},end:{x:-4,y:-2},kind:"plaza",finish:"stone"};
  chunk.roadRuns=[road] as unknown as typeof chunk.roadRuns;
  chunk.surfaceRuns=[pavement,{...pavement,finish:undefined},{start:{x:0,y:0},end:{x:0,y:0},kind:"path"}] as typeof chunk.surfaceRuns;
  chunk.districts[0]!.cellRuns=[];chunk.decorationContext.districts[0]!.cellRuns=chunk.districts[0]!.cellRuns;
  const before=structuredClone(input),packed=packCitySceneTransfer(input);
  const restored=await hydrateCitySceneTransfer(structuredClone(packed,{transfer:[packed.coordinates.buffer,packed.metadataIndices.buffer]}));
  expect(restored).toEqual(before);expect(input).toEqual(before);
  expect(JSON.stringify(restored)).toBe(JSON.stringify(before));
  expect(Object.is(restored.chunks[0]!.roadRuns[0]!.start.y,-0)).toBe(true);
  expect(Object.hasOwn(restored.chunks[0]!.surfaceRuns[1]!,"finish")).toBe(true);
  expect(Object.hasOwn(restored.chunks[0]!.surfaceRuns[2]!,"finish")).toBe(false);
  expect(restored.chunks[0]!.districts[0]!.cellRuns).toBe(restored.chunks[0]!.decorationContext.districts[0]!.cellRuns);
  expect(restored.chunks[0]!.tasks).toBe(restored.completedDistrictSnapshots[0]!.tasks);
  expect(restored.chunks[0]!.tasks[0]!.footprint).toBe(restored.completedDistrictSnapshots[0]!.tasks[0]!.footprint);
});

it("yields through large hydration, aborts without returning a partial city, and permits an independent retry",async()=>{
  const input=scene(50_000),packed=packCitySceneTransfer(input),controller=new AbortController();let ticks=0,yields=0;
  await expect(hydrateCitySceneTransfer(packed,{signal:controller.signal,now:()=>ticks++,yieldTask:async()=>{
    yields++;controller.abort(new DOMException("owner cancelled","AbortError"));
  }})).rejects.toMatchObject({name:"AbortError"});
  expect(yields).toBe(1);
  let retryTicks=0,retryYields=0;
  const restored=await hydrateCitySceneTransfer(packed,{now:()=>retryTicks++,yieldTask:async()=>{retryYields++;}});
  expect(retryYields).toBeGreaterThan(10);expect(restored).toEqual(input);
});

it("rejects malformed private buffer ranges or metadata instead of publishing a partial scene",async()=>{
  const input=scene();
  const badRange=packCitySceneTransfer(input);badRange.arrays[0]!.length++;
  await expect(hydrateCitySceneTransfer(badRange)).rejects.toThrow("Invalid city run range");
  const badMetadata=packCitySceneTransfer(input);badMetadata.metadataIndices[0]=999;
  await expect(hydrateCitySceneTransfer(badMetadata)).rejects.toThrow("Invalid city run metadata");
  expect(input.chunks[0]!.roadRuns).toHaveLength(3);
});

it("retains legacy own-key order as well as canonical JSON and never changes the input",async()=>{
  const input=scene(0),start={label:"old",y:-0,x:-5,missing:undefined},end={y:-4,x:2};
  const road={orientation:"reversed",end,mask:1,start,optional:undefined};
  input.chunks[0]!.roadRuns=[road] as unknown as typeof input.chunks[0]["roadRuns"];
  const restored=await hydrateCitySceneTransfer(packCitySceneTransfer(input));
  expect(restored).toEqual(input);expect(JSON.stringify(restored)).toBe(JSON.stringify(input));
  expect(Object.keys(restored.chunks[0]!.roadRuns[0]!)).toEqual(Object.keys(road));
  expect(Object.keys(restored.chunks[0]!.roadRuns[0]!.start)).toEqual(Object.keys(start));
});
