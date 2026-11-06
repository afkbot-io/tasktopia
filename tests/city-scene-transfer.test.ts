import { expect, it, vi } from "vitest";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import type {RoadRunDto} from '../src/shared/contracts';
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

it("explicit packed storage owns immutable geometry while default hydration remains compatible",async()=>{
  const input=scene(),packed=packCitySceneTransfer(input);
  const restored=await hydrateCitySceneTransfer(packed,{runStorage:'PACKED_IMMUTABLE'});
  // The private reader must own a snapshot, even if its original carrier is
  // subsequently reused or changed before the first geometry read.
  packed.coordinates[0]=999;packed.metadata[0]!.fields.orientation='changed';
  packed.metadataIndices.fill(0xffff_ffff);packed.arrays[0]!.length=0;
  const runs=restored.chunks[0]!.roadRuns;
  expect(Object.isFrozen(runs)).toBe(true);
  expect(Object.isFrozen(runs[0])).toBe(true);expect(Object.isFrozen(runs[0]!.start)).toBe(true);
  expect(runs).toEqual(input.chunks[0]!.roadRuns);
  expect(Object.is(runs[0]!.start.x,-0)).toBe(true);
  expect(restored.chunks[0]!.surfaceRuns).toBe(runs);
  expect(()=>{runs[0]!.start.x=17;}).toThrow(TypeError);
  expect(JSON.stringify(restored)).toBe(JSON.stringify(input));
  const eager=await hydrateCitySceneTransfer(packCitySceneTransfer(input));
  expect(Object.isFrozen(eager.chunks[0]!.roadRuns)).toBe(false);
  eager.chunks[0]!.roadRuns[0]!.start.x=17;
  expect(eager.chunks[0]!.roadRuns[0]!.start.x).toBe(17);
  expect(Object.is(input.chunks[0]!.roadRuns[0]!.start.x,-0)).toBe(true);
});

it('does not read or copy a private carrier after its packed owner is already cancelled',async()=>{
  const packed=packCitySceneTransfer(scene()),controller=new AbortController();let reads=0;
  Object.defineProperty(packed,'metadata',{enumerable:true,get(){reads++;return [];}});
  controller.abort(new DOMException('owner cancelled','AbortError'));
  await expect(hydrateCitySceneTransfer(packed,{runStorage:'PACKED_IMMUTABLE',signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(reads).toBe(0);
});

it('rejects malformed packed buffers and uncloneable metadata through its promise boundary',async()=>{
  for(const bad of ['buffer','metadata'] as const){
    const packed=packCitySceneTransfer(scene());
    if(bad==='buffer')packed.coordinates=undefined as unknown as Float64Array;
    else packed.metadata[0]!.fields.extra=()=>undefined;
    let pending:Promise<CitySceneDto>|undefined;
    expect(()=>{pending=hydrateCitySceneTransfer(packed,{runStorage:'PACKED_IMMUTABLE'});}).not.toThrow();
    await expect(pending!).rejects.toThrow();
  }
});

it('rejects every invalid packed range, row, coordinate and reference before a scene can be adopted',async()=>{
  for(const bad of ['range','index','coordinate','reference'] as const){
    const packed=packCitySceneTransfer(scene());
    if(bad==='range')packed.arrays[0]!.length++;
    if(bad==='index')packed.metadataIndices[0]=999;
    if(bad==='coordinate')packed.coordinates[0]=NaN;
    if(bad==='reference')(packed.scene as CitySceneDto).chunks[0]!.roadRuns={runArray:999} as unknown as RoadRunDto[];
    await expect(hydrateCitySceneTransfer(packed,{runStorage:'PACKED_IMMUTABLE'})).rejects.toThrow(/Invalid city run/);
  }
});

it('rejects malformed lazy metadata before publication rather than on the first geometry read',async()=>{
  for(const bad of ['missing-keys','duplicate-keys','shadowed-coordinate','non-record'] as const){
    const packed=packCitySceneTransfer(scene()),meta=packed.metadata[0]!;
    if(bad==='missing-keys'){meta.order=[];meta.canonicalOrder=false;}
    if(bad==='duplicate-keys'){meta.startOrder=['x','x','y'];meta.canonicalOrder=false;}
    if(bad==='shadowed-coordinate')meta.fields.start={x:999,y:999};
    if(bad==='non-record')meta.fields='invalid' as unknown as Record<string,unknown>;
    await expect(hydrateCitySceneTransfer(packed,{runStorage:'PACKED_IMMUTABLE'})).rejects.toThrow('Invalid city run metadata');
  }
});

it('keeps packed nested metadata immutable and falls back safely when WeakRef is unavailable',async()=>{
  for(const fallback of [false,true]){
    const input=scene(1),run=input.chunks[0]!.roadRuns[0]! as unknown as {extra:{nested:number[]}};
    run.extra={nested:[1,2]};const expected=structuredClone(input);
    if(fallback)vi.stubGlobal('WeakRef',undefined);
    try{
      const packed=packCitySceneTransfer(input),restored=await hydrateCitySceneTransfer(packed,{runStorage:'PACKED_IMMUTABLE'});
      (packed.metadata[0]!.fields.extra as {nested:number[]}).nested[0]=999;
      const extra=(restored.chunks[0]!.roadRuns[0] as unknown as {extra:{nested:number[]}}).extra;
      expect(extra.nested).toEqual([1,2]);expect(Object.isFrozen(extra)).toBe(true);expect(Object.isFrozen(extra.nested)).toBe(true);
      expect(restored).toEqual(expected);
    }finally{vi.unstubAllGlobals();}
  }
});

it("preserves every run kind, extras, direction, empty arrays and absent versus undefined metadata",async()=>{
  const input=scene(),chunk=input.chunks[0]!;
  const road={start:{x:-13,y:-0,label:"start"},end:{x:-13,y:-11},mask:3,structure:"bridge",roadClass:undefined,orientation:"backward",extra:{active:false}};
  const pavement={start:{x:8,y:-2},end:{x:-4,y:-2},kind:"plaza",finish:"stone"};
  chunk.roadRuns=[road] as unknown as typeof chunk.roadRuns;
  chunk.surfaceRuns=[pavement,{...pavement,finish:undefined},{start:{x:0,y:0},end:{x:0,y:0},kind:"path"}] as typeof chunk.surfaceRuns;
  chunk.districts[0]!.cellRuns=[];chunk.decorationContext.districts[0]!.cellRuns=chunk.districts[0]!.cellRuns;
  const before=structuredClone(input);
  for(const options of [{},{runStorage:'PACKED_IMMUTABLE' as const}]){
  const packed=packCitySceneTransfer(input);
  const restored=await hydrateCitySceneTransfer(structuredClone(packed,{transfer:[packed.coordinates.buffer,packed.metadataIndices.buffer]}),options);
  expect(restored).toEqual(before);expect(input).toEqual(before);
  expect(JSON.stringify(restored)).toBe(JSON.stringify(before));
  expect(Object.is(restored.chunks[0]!.roadRuns[0]!.start.y,-0)).toBe(true);
  expect(Object.hasOwn(restored.chunks[0]!.surfaceRuns[1]!,"finish")).toBe(true);
  expect(Object.hasOwn(restored.chunks[0]!.surfaceRuns[2]!,"finish")).toBe(false);
  expect(restored.chunks[0]!.districts[0]!.cellRuns).toBe(restored.chunks[0]!.decorationContext.districts[0]!.cellRuns);
  expect(restored.chunks[0]!.tasks).toBe(restored.completedDistrictSnapshots[0]!.tasks);
  expect(restored.chunks[0]!.tasks[0]!.footprint).toBe(restored.completedDistrictSnapshots[0]!.tasks[0]!.footprint);
  }
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
  for(const options of [{},{runStorage:'PACKED_IMMUTABLE' as const}]){
  const restored=await hydrateCitySceneTransfer(packCitySceneTransfer(input),options);
  expect(restored).toEqual(input);expect(JSON.stringify(restored)).toBe(JSON.stringify(input));
  expect(Object.keys(restored.chunks[0]!.roadRuns[0]!)).toEqual(Object.keys(road));
  expect(Object.keys(restored.chunks[0]!.roadRuns[0]!.start)).toEqual(Object.keys(start));
  }
});


it("bounds repeated primitive metadata serialization while transferring5000 uniform coordinate runs",async()=>{
  const input=scene(5_000);let primitiveSerializations=0;
  const original=JSON.stringify;
  const serialize=vi.spyOn(JSON,"stringify").mockImplementation((...args:Parameters<typeof JSON.stringify>)=>{
    if(args[0]==="vertical")primitiveSerializations++;
    return original(...args);
  });
  let packed;
  try{packed=packCitySceneTransfer(input);}finally{serialize.mockRestore();}
  expect(primitiveSerializations).toBeLessThanOrEqual(2);
  expect(await hydrateCitySceneTransfer(packed)).toEqual(input);
});

it("does not miss changed or nested extras, key additions, undefined, signed zero or legacy key order",async()=>{
  const input=scene(0);
  const point=(x:number)=>({x,y:0,note:"same"});
  const run=(x:number,extra:unknown)=>({start:point(x),end:point(x+1),extra});
  const runs=[run(0,1),run(1,1),run(2,2),run(3,-0),run(4,0),run(5,{nested:[1,undefined]}),run(6,{nested:[1,undefined]}),
    {...run(7,undefined),newKey:"added"},{...run(8,undefined),otherKey:"renamed"},
    {extra:undefined,end:point(10),start:{note:"legacy",y:-0,x:9}}];
  input.chunks[0]!.roadRuns=runs as unknown as typeof input.chunks[0]["roadRuns"];
  const restored=await hydrateCitySceneTransfer(packCitySceneTransfer(input));
  expect(restored).toEqual(input);expect(JSON.stringify(restored)).toBe(JSON.stringify(input));
  expect(Object.is((restored.chunks[0]!.roadRuns[3] as unknown as {extra:number}).extra,-0)).toBe(true);
  expect(restored.chunks[0]!.roadRuns).toHaveLength(runs.length);
});
