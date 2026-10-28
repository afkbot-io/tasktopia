import {expect,it} from "vitest";
import {readCitySceneBytes} from "../src/client/city-scene-response-bytes";

it("copies exact binary chunks without performing UTF8 decoding on the page",async()=>{
  const response=new Response(new ReadableStream({start(controller){
    controller.enqueue(Uint8Array.of(255,0,194));controller.enqueue(Uint8Array.of(169,1));controller.close();
  }}));
  const body=await readCitySceneBytes(response,new AbortController().signal);
  expect([...new Uint8Array(body)]).toEqual([255,0,194,169,1]);expect(response.body!.locked).toBe(false);
});

it("bounds actual decompressed bytes before concatenation and cancels an oversized stream",async()=>{
  let cancelled=0;
  const response=new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(5));},cancel(){cancelled++;}}),{headers:{"content-length":"1"}});
  await expect(readCitySceneBytes(response,new AbortController().signal,8)).rejects.toThrow("слишком велика");
  expect(cancelled).toBe(1);expect(response.body!.locked).toBe(false);
});

it("cancels a pending native body read and releases its stream lock on abort",async()=>{
  let cancelled=0;
  const response=new Response(new ReadableStream({cancel(){cancelled++;}})),controller=new AbortController();
  const outcome=readCitySceneBytes(response,controller.signal).catch(error=>error as Error);
  controller.abort();expect((await outcome as Error).name).toBe("AbortError");
  expect(cancelled).toBe(1);expect(response.body!.locked).toBe(false);
});
