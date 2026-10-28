import { expect, it } from "vitest";
import { planCityResidency, taskIntersectsResidentBounds } from "../src/client/city-residency";

it("keeps canonical coordinates untouched but renders the viewport and one-page halo", () => {
  const city = Array.from({length:100},(_,index)=>({chunkX:index%10,chunkY:Math.floor(index/10)}));
  const plan = planCityResidency(city,{minChunkX:3,maxChunkX:4,minChunkY:3,maxChunkY:3},64);
  expect([...plan.visibleKeys].sort()).toEqual(["3,3","4,3"]);
  expect(plan.wanted).toHaveLength(12);
  expect(plan.bounds).toEqual({minX:128,minY:128,maxX:383,maxY:319});
  expect(plan.wanted.slice(0,2)).toEqual([[3,3],[4,3]]);
  expect(city).toHaveLength(100);
  expect(planCityResidency(city,{minChunkX:0,maxChunkX:0,minChunkY:0,maxChunkY:0},64).wanted).toHaveLength(4);
});

it("keeps buildings crossing a page boundary and excludes distant completed snapshot tasks", () => {
  const bounds={minX:64,minY:64,maxX:127,maxY:127};
  expect(taskIntersectsResidentBounds({footprint:[{x:63,y:75},{x:64,y:75}]},bounds)).toBe(true);
  expect(taskIntersectsResidentBounds({footprint:[{x:130,y:100}]},bounds)).toBe(true);
  expect(taskIntersectsResidentBounds({footprint:[{x:300,y:75}]},bounds)).toBe(false);
});

it("reuses the immutable coordinate index rather than rescanning a whole city on each pan", () => {
  let reads=0;
  const city=Array.from({length:10000},(_,i)=>({get chunkX(){reads++;return i%100;},get chunkY(){reads++;return Math.floor(i/100);}}));
  planCityResidency(city,{minChunkX:0,maxChunkX:1,minChunkY:0,maxChunkY:1},64);
  reads=0;
  const plan=planCityResidency(city,{minChunkX:50,maxChunkX:51,minChunkY:50,maxChunkY:51},64);
  expect(plan.wanted).toHaveLength(16);
  expect(reads).toBeLessThan(100);
});
