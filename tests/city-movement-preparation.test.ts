import {afterEach,expect,it,vi} from "vitest";
import {CityMovementPreparation} from "../src/client/city-movement-preparation";
const gate=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(finish=>{resolve=finish;});return{promise,resolve};};
afterEach(()=>vi.useRealTimers());

it("deduplicates an unchanged canonical topology but atomically commits only the latest preparation",async()=>{
 const preparation=new CityMovementPreparation(),old=gate<number>(),fresh=gate<number>(),commits:number[]=[];
 let calls=0,oldSignal!:AbortSignal;
 const first=preparation.request("a",signal=>{calls++;oldSignal=signal;return old.promise;},v=>commits.push(v));
 expect(preparation.request("a",async()=>99,v=>commits.push(v))).toBe(first);
 await Promise.resolve();expect(calls).toBe(1);
 const second=preparation.request("b",()=>fresh.promise,v=>commits.push(v));
 expect(oldSignal.aborted).toBe(true);fresh.resolve(2);expect(await second).toBe(true);
 old.resolve(1);expect(await first).toBe(false);expect(commits).toEqual([2]);expect(preparation.busy).toBe(false);
});

it("fences a hidden, changed or disposed owner even if a producer ignores abort",async()=>{
 const preparation=new CityMovementPreparation(),commits:number[]=[],pending=gate<number>();let valid=true;
 const first=preparation.request("a",()=>pending.promise,v=>commits.push(v),()=>valid);
 valid=false;pending.resolve(1);expect(await first).toBe(false);expect(commits).toEqual([]);
 const next=preparation.request("a",()=>new Promise<number>(()=>undefined),v=>commits.push(v));
 preparation.cancel();expect(await next).toBe(false);
 const last=preparation.request("b",async()=>2,v=>commits.push(v));preparation.dispose();expect(await last).toBe(false);
 expect(await preparation.request("c",async()=>3,v=>commits.push(v))).toBe(false);expect(commits).toEqual([]);
});

it("bounds a hung producer, aborts remaining work and permits a real retry",async()=>{
 vi.useFakeTimers();const preparation=new CityMovementPreparation(50);let signal!:AbortSignal;
 const result=preparation.request("a",current=>{signal=current;return new Promise<number>(()=>undefined);},()=>undefined);
 const failed=expect(result).rejects.toThrow("слишком долго");await vi.advanceTimersByTimeAsync(50);await failed;
 expect(signal.aborted).toBe(true);expect(preparation.busy).toBe(false);
 const commit=vi.fn();expect(await preparation.request("a",async()=>1,commit)).toBe(true);expect(commit).toHaveBeenCalledWith(1);expect(vi.getTimerCount()).toBe(0);
});

it("permits a bounded large-city request beyond20s without changing the next default request",async()=>{
 vi.useFakeTimers();const preparation=new CityMovementPreparation(),pending=gate<number>(),commit=vi.fn();let signal!:AbortSignal;
 const result=preparation.request("large",current=>{signal=current;return pending.promise;},commit,()=>true,{timeoutMs:90_000});
 const settled=result.then(value=>({value}),error=>({error}));
 try{
  await vi.advanceTimersByTimeAsync(66_000);expect(signal.aborted).toBe(false);expect(preparation.busy).toBe(true);
  pending.resolve(7);expect(await settled).toEqual({value:true});expect(commit).toHaveBeenCalledWith(7);expect(vi.getTimerCount()).toBe(0);
  const small=preparation.request("small",()=>new Promise<number>(()=>undefined),commit);
  const failed=expect(small).rejects.toThrow("слишком долго");await vi.advanceTimersByTimeAsync(20_000);await failed;
  expect(preparation.busy).toBe(false);expect(commit).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 }finally{preparation.dispose();}
});

it("keeps the90s cap from request start, ignores a late producer and allows a fresh retry",async()=>{
 vi.useFakeTimers();const preparation=new CityMovementPreparation(),pending=gate<number>(),commit=vi.fn();let signal!:AbortSignal;
 const result=preparation.request("large",current=>{signal=current;return pending.promise;},commit,()=>true,{timeoutMs:90_000});
 const failed=expect(result).rejects.toThrow("слишком долго");
 try{
  await vi.advanceTimersByTimeAsync(60_000);expect(signal.aborted).toBe(false);
  expect(preparation.request("large",async()=>99,commit,()=>true,{timeoutMs:90_000})).toBe(result);
  await vi.advanceTimersByTimeAsync(29_999);expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);await failed;expect(signal.aborted).toBe(true);expect(preparation.busy).toBe(false);
  pending.resolve(1);await Promise.resolve();expect(commit).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  expect(await preparation.request("large",async()=>2,commit,()=>true,{timeoutMs:90_000})).toBe(true);
  expect(commit).toHaveBeenCalledExactlyOnceWith(2);expect(vi.getTimerCount()).toBe(0);
 }finally{preparation.dispose();}
});

it.each(["cancel","dispose"] as const)("cancels a large-city request immediately on %s without a late commit",async action=>{
 vi.useFakeTimers();const preparation=new CityMovementPreparation(),pending=gate<number>(),commit=vi.fn();let signal!:AbortSignal;
 const result=preparation.request("large",current=>{signal=current;return pending.promise;},commit,()=>true,{timeoutMs:90_000});
 try{
  await Promise.resolve();expect(signal.aborted).toBe(false);preparation[action]();
  expect(await result).toBe(false);expect(signal.aborted).toBe(true);expect(preparation.busy).toBe(false);
  pending.resolve(4);await Promise.resolve();expect(commit).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 }finally{preparation.dispose();}
});

it("rejects an invalid override before cancelling or deduplicating an existing owner",async()=>{
 vi.useFakeTimers();const preparation=new CityMovementPreparation(),pending=gate<number>(),commit=vi.fn();let signal!:AbortSignal;
 const result=preparation.request("held",current=>{signal=current;return pending.promise;},commit);
 try{
  await Promise.resolve();
  for(const timeoutMs of [0,-1,.5,NaN,Infinity,90_001])for(const key of ["held","replacement"]){
   expect(()=>preparation.request(key,async()=>8,commit,()=>true,{timeoutMs})).toThrow("Invalid movement preparation timeout");
   expect(signal.aborted).toBe(false);expect(preparation.busy).toBe(true);
  }
  pending.resolve(5);expect(await result).toBe(true);expect(commit).toHaveBeenCalledExactlyOnceWith(5);expect(vi.getTimerCount()).toBe(0);
 }finally{preparation.dispose();}
});

it("reuses prepared physical geometry while a held life plan retries only the latest semantic revision",async()=>{
 const {prepareLatestCityLife}=await import("../src/client/city-movement-preparation") as unknown as {
  prepareLatestCityLife:<S,T>(read:()=>{revision:number;state:S},prepare:(state:S,signal:AbortSignal)=>Promise<T>,signal:AbortSignal)=>Promise<{revision:number;value:T}>;
 };
 const held=gate<string>(),controller=new AbortController(),physical={walk:"same canonical network"};
 let current={revision:1,state:"COMPLETED SCHOOL"};const plans:string[]=[];
 const result=prepareLatestCityLife(()=>current,async state=>{plans.push(state);return plans.length===1?held.promise:`${state}:${physical.walk}`;},controller.signal);
 current={revision:2,state:"TESTING SHOP"};held.resolve("stale school");
 expect(await result).toEqual({revision:2,value:"TESTING SHOP:same canonical network"});
 expect(plans).toEqual(["COMPLETED SCHOOL","TESTING SHOP"]);
});

it("cancels a stale held life plan before starting its replacement",async()=>{
 const {prepareLatestCityLife}=await import("../src/client/city-movement-preparation") as unknown as {
  prepareLatestCityLife:<S,T>(read:()=>{revision:number;state:S},prepare:(state:S,signal:AbortSignal)=>Promise<T>,signal:AbortSignal)=>Promise<{revision:number;value:T}>;
 };
 const held=gate<number>(),controller=new AbortController();let revision=1,calls=0;
 const result=prepareLatestCityLife(()=>({revision,state:revision}),async()=>{calls++;return held.promise;},controller.signal);
 revision=2;const reason=new DOMException("owner gone","AbortError");controller.abort(reason);held.resolve(1);
 await expect(result).rejects.toBe(reason);expect(calls).toBe(1);
});
