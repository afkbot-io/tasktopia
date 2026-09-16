import { afterEach, expect,it,vi } from "vitest";
import { establishDigestBaseline, readDigestCursor, rememberDigestCursor, worldDigestCursorKey } from "../src/client/world-digest-cursor";
it("isolates accounts and countries, preserves a monotonic session cursor without storage and repairs an invalid baseline",async()=>{
  const key = worldDigestCursorKey("user-a","country-a");
  expect(readDigestCursor(key)).toBeNull();
  await establishDigestBaseline(key,100);
  await rememberDigestCursor(key,150);
  await rememberDigestCursor(key,101);
  expect(readDigestCursor(key)).toBe(150);
  expect(readDigestCursor(worldDigestCursorKey("user-b","country-a"))).toBeNull();
  expect(readDigestCursor(worldDigestCursorKey("user-a","country-b"))).toBeNull();
  await rememberDigestCursor(key,Number.NaN);
  await rememberDigestCursor(key,-1);
  expect(readDigestCursor(key)).toBe(150);
  await establishDigestBaseline(key,10,150);
  expect(readDigestCursor(key)).toBe(10);
});

afterEach(()=>vi.unstubAllGlobals());
it("serializes competing tab updates and never regresses on a late initial response",async()=>{
  const values=new Map<string,string>();
  vi.stubGlobal("localStorage",{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
  const queue: (()=>void)[]=[];
  vi.stubGlobal("navigator",{locks:{request:(_name:string,callback:()=>void)=>new Promise<void>(resolve=>queue.push(()=>{callback();resolve();}))}});
  const key=worldDigestCursorKey("concurrent","country");
  values.set(key,"100");
  const late=rememberDigestCursor(key,150);
  // Another context completes a newer write before this context acquires its lock.
  values.set(key,"200");
  queue.shift()!(); await late;
  expect(values.get(key)).toBe("200");
  const baseline=establishDigestBaseline(key,110,null);
  queue.shift()!(); await baseline;
  expect(values.get(key)).toBe("200");
  const reset=establishDigestBaseline(key,50,200);
  queue.shift()!(); await reset;
  expect(values.get(key)).toBe("50");
});
