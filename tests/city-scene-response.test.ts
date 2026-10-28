import {expect,it,vi} from "vitest";
import {packCitySceneTransfer} from "../src/client/city-scene-transfer";
import type {CitySceneDto} from "../src/shared/city-scene-contract";
import {citySceneResponseMetrics,loadCitySceneResponse,type SceneResponseMessage,type SceneResponseRequest,type SceneResponseWorker} from "../src/client/city-scene-response";
import {loadMapWithTimeout} from "../src/client/map-load-timeout";
import {citySceneDataWeight} from "../src/client/map-scene-cache";

vi.mock("../src/client/city-scene-response-worker.ts?worker&url",()=>({default:"https://store.tasktopia.online/assets/city-scene-response-worker-test.js"}));

class Worker implements SceneResponseWorker{
  message:((event:MessageEvent<SceneResponseMessage>)=>void)|undefined;
  error:((event:ErrorEvent)=>void)|undefined;
  listeners=0;terminated=0;posted:SceneResponseRequest[]=[];
  addEventListener(type:"message"|"error",listener:((event:MessageEvent<SceneResponseMessage>)=>void)|((event:ErrorEvent)=>void)){
    this.listeners++;if(type==="message")this.message=listener as typeof this.message;else this.error=listener as typeof this.error;
  }
  removeEventListener(type:"message"|"error") {this.listeners--;if(type==="message")this.message=undefined;else this.error=undefined;}
  postMessage(message:SceneResponseRequest){this.posted.push(message);}
  terminate(){this.terminated++;}
}

it("keeps headers, binary body and worker return phases on the owning page clock",async()=>{
  let now=0,body!:ReadableStreamDefaultController<Uint8Array>,headers!:(response:Response)=>void;
  const clock=vi.spyOn(performance,"now").mockImplementation(()=>now),worker=new Worker();
  const pending=loadCitySceneResponse("/api/countries/c/cities/a/scene",new AbortController().signal,()=>worker,
    ()=>new Promise<Response>(resolve=>{headers=resolve;}));
  try{
    now=10;headers(new Response(new ReadableStream({start(controller){body=controller;}})));
    await Promise.resolve();await Promise.resolve();
    now=30;body.enqueue(new TextEncoder().encode("{}"));body.close();
    await vi.waitFor(()=>expect(worker.posted).toHaveLength(1));
    const scene={schemaVersion:5,city:{id:"a"},lod:"DETAIL"} as CitySceneDto;
    now=45;worker.message!({data:{scene,metrics:{decodedBytes:2,requestMs:30,parseMs:1,decodeMs:1,headersAtEpoch:performance.timeOrigin+10}}} as MessageEvent<SceneResponseMessage>);
    expect(citySceneResponseMetrics(await pending)).toMatchObject({fetchHeadersMs:10,bodyReadMs:20,workerRoundTripMs:15,ownerMs:45});
  }finally{clock.mockRestore();}
});

it("delegates one whole scene read and removes the worker/listeners after success",async()=>{
  const worker=new Worker(),signal=new AbortController().signal;
  const fetcher=vi.fn(async()=>new Response("{}"));
  const pending=loadCitySceneResponse("/api/countries/c/cities/a/scene",signal,()=>worker,fetcher);
  const outcome=pending.catch(error=>error as Error);
  const scene={schemaVersion:5,city:{id:"a"},lod:"DETAIL"} as CitySceneDto;
  await vi.waitFor(()=>expect(worker.posted).toHaveLength(1));
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual(["/api/countries/c/cities/a/scene",expect.objectContaining({credentials:"include",headers:expect.objectContaining({accept:expect.stringContaining("compact-v1")})})]);
  expect(worker.posted[0]!.body.byteLength).toBe(2);
  worker.message!({data:{scene}} as MessageEvent<SceneResponseMessage>);
  expect(await outcome).toBe(scene);expect(worker.terminated).toBe(1);expect(worker.listeners).toBe(0);
});

it("preserves HTTP errors and cleans failed or disconnected response workers",async()=>{
  for(const failure of ["http","worker","abort"]){
    const worker=new Worker(),controller=new AbortController();
    const pending=loadCitySceneResponse("/api/countries/c/cities/a/scene",controller.signal,()=>worker,async()=>new Response("{}"));
    const outcome=pending.catch(error=>error as Error&{status?:number});
    await vi.waitFor(()=>expect(worker.posted).toHaveLength(1));
    if(failure==="http")worker.message!({data:{error:{status:401,message:"Сессия завершена"}}} as MessageEvent<SceneResponseMessage>);
    if(failure==="worker")worker.error!({message:"Worker failed"} as ErrorEvent);
    if(failure==="abort")controller.abort();
    const error=await outcome as Error&{status?:number};
    if(failure==="http")expect(error.status).toBe(401);
    if(failure==="worker")expect(error.message).toBe("Worker failed");
    if(failure==="abort")expect(error.name).toBe("AbortError");
    expect(worker.terminated).toBe(1);expect(worker.listeners).toBe(0);
  }
});

it("loads the response worker from the application origin when regular assets use the CDN",async()=>{
  const owned:Worker[]=[];
  const urls:string[]=[];
  class BrowserWorker extends Worker{constructor(url:string|URL){super();urls.push(String(url));owned.push(this);}}
  vi.stubGlobal("Worker",BrowserWorker);vi.stubGlobal("location",new URL("https://tasktopia.online/country"));
  try{
    const controller=new AbortController(),outcome=loadCitySceneResponse("/api/countries/c/cities/a/scene",controller.signal,undefined,async()=>new Response("{}")).catch(error=>error as Error);
    await vi.waitFor(()=>expect(urls).toEqual(["https://tasktopia.online/assets/city-scene-response-worker-test.js"]));
    controller.abort();expect((await outcome as Error).name).toBe("AbortError");
    expect(owned[0]!.terminated).toBe(1);expect(owned[0]!.listeners).toBe(0);
  }finally{vi.unstubAllGlobals();}
});

it("cancels during lazy worker loading and disposes any late constructor result without sending a request",async()=>{
  const worker=new Worker(),controller=new AbortController();
  let release!:(worker:SceneResponseWorker)=>void;
  const outcome=loadCitySceneResponse("/api/countries/c/cities/a/scene",controller.signal,
    ()=>new Promise<SceneResponseWorker>(resolve=>{release=resolve;})).catch(error=>error as Error);
  controller.abort();expect((await outcome as Error).name).toBe("AbortError");
  release(worker);await Promise.resolve();
  expect(worker.posted).toEqual([]);expect(worker.terminated).toBe(1);expect(worker.listeners).toBe(0);
});

it("timestamps the actual request after a slow lazy worker load",async()=>{
  const now=vi.spyOn(performance,"now").mockReturnValue(0),worker=new Worker();
  let release!:(worker:SceneResponseWorker)=>void;
  try{
    const controller=new AbortController();
    const outcome=loadCitySceneResponse("/api/countries/c/cities/a/scene",controller.signal,
      ()=>new Promise<SceneResponseWorker>(resolve=>{release=resolve;}),async()=>new Response("{}")).catch(error=>error as Error);
    now.mockReturnValue(4000);release(worker);
    await vi.waitFor(()=>expect(worker.posted).toHaveLength(1));
    controller.abort();await outcome;
    expect(worker.posted[0]!.startedEpoch).toBe(performance.timeOrigin+4000);
    expect(worker.posted[0]!.headersAtEpoch-worker.posted[0]!.startedEpoch).toBe(0);
  }finally{now.mockRestore();}
});

it("a map deadline aborts a silent worker and no late scene can publish",async()=>{
  vi.useFakeTimers();
  const worker=new Worker();
  try{
    const pending=loadMapWithTimeout(signal=>loadCitySceneResponse("/api/countries/c/cities/a/scene",signal,()=>worker,async()=>new Response("{}")),20);
    const outcome=pending.catch(error=>error as Error);
    await vi.advanceTimersByTimeAsync(21);
    expect((await outcome as Error).message).toMatch(/слишком долго/);
    expect(worker.terminated).toBe(1);expect(worker.listeners).toBe(0);
  }finally{vi.useRealTimers();}
});

it("reuses the worker's retained-data estimate without walking a large scene again on the main thread",async()=>{
  let traversed=0;
  const scene={schemaVersion:5,city:{id:"a"},lod:"DETAIL"} as CitySceneDto;
  Object.defineProperty(scene,"chunks",{enumerable:true,get(){traversed++;return[];}});
  const worker=new Worker(),pending=loadCitySceneResponse("/api/countries/c/cities/a/scene",new AbortController().signal,()=>worker,async()=>new Response("{}"));
  await vi.waitFor(()=>expect(worker.posted).toHaveLength(1));
  worker.message!({data:{scene,metrics:{decodedBytes:100,requestMs:1,parseMs:1,decodeMs:1,headersAtEpoch:0,retainedWeight:12345}}} as MessageEvent<SceneResponseMessage>);
  expect(citySceneDataWeight(await pending)).toBe(12345);
  expect(traversed).toBe(0);
});


it("terminates the response worker before cooperative rehydration, cancels that owner, and retries normally",async()=>{
  const makeScene=()=>({schemaVersion:5,city:{id:"a"},lod:"DETAIL",chunks:[{roadRuns:Array.from({length:50_000},(_,x)=>({start:{x,y:0},end:{x,y:1}})),
    surfaceRuns:[],districts:[],decorationContext:{surfaceHaloRuns:[],blockedCellRuns:[],districts:[]}}]}) as unknown as CitySceneDto;
  const worker=new Worker(),controller=new AbortController();let ticks=0;
  const now=vi.spyOn(performance,"now").mockImplementation(()=>ticks++);
  try{
    const outcome=loadCitySceneResponse("/api/countries/c/cities/a/scene",controller.signal,()=>worker,async()=>new Response("{}")).catch(error=>error as Error);
    await vi.waitFor(()=>expect(worker.posted).toHaveLength(1));
    worker.message!({data:{transfer:packCitySceneTransfer(makeScene())}} as unknown as MessageEvent<SceneResponseMessage>);
    expect(worker.terminated).toBe(1);expect(worker.listeners).toBe(0);
    controller.abort();expect((await outcome as Error).name).toBe("AbortError");
    expect(worker.terminated).toBe(1);
    const retryWorker=new Worker(),retry=loadCitySceneResponse("/api/countries/c/cities/a/scene",new AbortController().signal,()=>retryWorker,async()=>new Response("{}"));
    await vi.waitFor(()=>expect(retryWorker.posted).toHaveLength(1));
    const scene=makeScene();scene.chunks[0]!.roadRuns=[];
    retryWorker.message!({data:{transfer:packCitySceneTransfer(scene),metrics:{decodedBytes:2,requestMs:1,parseMs:1,decodeMs:1,headersAtEpoch:0,packMs:2}}} as unknown as MessageEvent<SceneResponseMessage>);
    expect(await retry).toEqual(scene);expect(citySceneResponseMetrics(await retry)!.mainRehydrateMs).toBeGreaterThanOrEqual(0);
    expect(citySceneResponseMetrics(await retry)!.packMs).toBe(2);expect(retryWorker.terminated).toBe(1);
  }finally{now.mockRestore();}
});
