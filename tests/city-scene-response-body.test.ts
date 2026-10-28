import {expect,it} from "vitest";
import type {CitySceneDto} from "../src/shared/city-scene-contract";
import {encodeCitySceneWire} from "../src/shared/city-scene-wire";
import {decodeCitySceneResponse,readCitySceneText} from "../src/client/city-scene-response-body";

it("reads split UTF8 bytes without replacing characters or counting compressed headers as the body budget",async()=>{
  const bytes=new TextEncoder().encode("Город🌲");
  const response=new Response(new ReadableStream({start(controller){
    controller.enqueue(bytes.subarray(0,1));controller.enqueue(bytes.subarray(1,7));controller.enqueue(bytes.subarray(7));controller.close();
  }}),{headers:{"content-length":"1"}});
  expect(await readCitySceneText(response)).toEqual({text:"Город🌲",bytes:bytes.length});
  expect(response.body!.locked).toBe(false);
});

it("cancels and unlocks an oversized decompressed stream before parsing it",async()=>{
  let cancelled=0;
  const response=new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(5));},cancel(){cancelled++;}}));
  await expect(readCitySceneText(response,8)).rejects.toThrow("слишком велика");
  expect(cancelled).toBe(1);expect(response.body!.locked).toBe(false);
});

it("decodes compact and rollback full scenes in the response owner with real parse/decode metrics",async()=>{
  const scene={schemaVersion:5,sceneRevision:"one",city:{id:"a"},lod:"DETAIL",chunks:[],completedDistrictSnapshots:[]} as unknown as CitySceneDto;
  for(const input of [scene,encodeCitySceneWire(scene)]){
    const text=JSON.stringify(input),response=new Response(text,{headers:{"cache-control":"no-store","x-tasktopia-server-time":"1793167200000"}});
    const result=await decodeCitySceneResponse(response,performance.now(),performance.timeOrigin+performance.now());
    expect(result.scene).toEqual(scene);expect(result.error).toBeUndefined();
    expect(result.metrics!.decodedBytes).toBe(new TextEncoder().encode(text).length);
    expect(result.metrics!.parseMs).toBeGreaterThanOrEqual(0);expect(result.metrics!.decodeMs).toBeGreaterThanOrEqual(0);
    expect(result.headers).toContainEqual(["cache-control","no-store"]);
  }
});

it("preserves HTTP status errors and rejects malformed successful scene JSON",async()=>{
  expect((await decodeCitySceneResponse(new Response('{"message":"Сессия завершена"}',{status:401}),0,0)).error)
    .toEqual({status:401,message:"Сессия завершена"});
  expect((await decodeCitySceneResponse(new Response("x".repeat(70000),{status:503}),0,0)).error!.status).toBe(503);
  await expect(decodeCitySceneResponse(new Response("not-json"),0,0)).rejects.toThrow("повреждённую сцену");
  await expect(decodeCitySceneResponse(new Response('{"kind":"city.scene.compact","version":100}'),0,0)).rejects.toThrow();
});
