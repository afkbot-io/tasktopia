import {expect,it} from "vitest";
import type {ChunkDto,ChunkTaskDto} from "../src/shared/contracts";
import {CanonicalCityData} from "../src/client/canonical-city-data";

it("keeps the last whole physical snapshot until all replacement worker pages are ready",()=>{
  const coordinates=[{chunkX:0,chunkY:0},{chunkX:1,chunkY:0}];
  const old=coordinates.map(coordinate=>({...coordinate,tasks:[],worldVersion:1})) as unknown as ChunkDto[];
  const cache=new Map(old.map(chunk=>[chunk.chunkX,chunk]));
  const completed=[{id:"completed",stage:5}] as ChunkTaskDto[];
  const data=new CanonicalCityData(),read=(x:number)=>cache.get(x);
  const first=data.resolve(coordinates,read,completed);
  cache.delete(1);
  const held=data.resolve(coordinates,read,[]);
  expect(data.pending).toBe(true);expect(held).toBe(first);
  expect(held.chunks).toHaveLength(2);expect(held.completed).toBe(completed);
  const next={...old[1]!,worldVersion:2};cache.set(1,next);
  const ready=data.resolve(coordinates,read,[]);
  expect(data.pending).toBe(false);expect(ready.chunks).toEqual([old[0],next]);expect(ready.completed).toEqual([]);
});

it("does not publish an incomplete initial snapshot and allows a complete city removal",()=>{
  const data=new CanonicalCityData();
  expect(data.resolve([{chunkX:0,chunkY:0}],()=>undefined,[]).chunks).toEqual([]);
  expect(data.pending).toBe(true);
  const chunk={chunkX:0,chunkY:0} as ChunkDto;
  expect(data.resolve([{chunkX:0,chunkY:0}],()=>chunk,[]).chunks).toEqual([chunk]);
  expect(data.resolve([],()=>undefined,[]).chunks).toEqual([]);expect(data.pending).toBe(false);
});
