import {expect,it,vi} from "vitest";
import {loadCitySceneWithTimeout,createCitySceneRefresh} from "../src/client/city-scene-deadline";
import {loadMapWithTimeout} from "../src/client/map-load-timeout";
import {BoundedMapRefresh} from "../src/client/bounded-map-refresh";

it.each(["initial","refresh"])("keeps a bounded30s city %s owner and aborts the slow read at its deadline",async kind=>{
  vi.useFakeTimers();
  try{
    let signal:AbortSignal|undefined,settled=false;
    const work=(value:AbortSignal)=>{signal=value;return new Promise<never>(()=>{});};
    const pending=kind==="initial"?loadCitySceneWithTimeout(work):createCitySceneRefresh().request(work);
    const outcome=pending.then(()=>{settled=true;return undefined;},error=>{settled=true;return error as Error;});
    await vi.advanceTimersByTimeAsync(20001);
    expect(settled).toBe(false);expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect((await outcome)!.message).toMatch(/слишком долго/);expect(signal!.aborted).toBe(true);
  }finally{vi.useRealTimers();}
});

it("retains the20s default deadline for non-city map owners",async()=>{
  vi.useFakeTimers();
  try{
    for(const kind of ["initial","refresh"]){
      const work=()=>new Promise<never>(()=>{});
      const pending=kind==="initial"?loadMapWithTimeout(work):new BoundedMapRefresh().request(work);
      const outcome=pending.catch(error=>error as Error);
      await vi.advanceTimersByTimeAsync(20001);
      expect((await outcome as Error).message).toMatch(/слишком долго/);
    }
  }finally{vi.useRealTimers();}
});
