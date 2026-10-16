import { expect,it } from "vitest";
import { citySceneChanges, sameCitySceneContent } from "../src/client/city-scene-content";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
it("retains local render data for transport-only revisions but detects changed terrain or snapshots",()=>{
  const before={city:{id:"city",bounds:{minX:0,minY:0,maxX:20,maxY:20}},chunks:[{chunkX:0,chunkY:0,contentHash:"one",publishedVersion:1}],completedDistrictSnapshots:[{districtId:"d",revision:"done"}],intercityRoads:[],railway:null,airportConnections:[],railConnections:[],sceneRevision:"old"} as unknown as CitySceneDto;
  const next={...before,sceneRevision:"new",airportConnections:[{id:"flight"}]} as CitySceneDto;
  expect(sameCitySceneContent(before,next)).toBe(true);
  expect(sameCitySceneContent(before,{...next,chunks:[{...before.chunks[0]!,publishedVersion:10}]}),
    "An unrelated publication version does not change resident pixels").toBe(true);
  expect(sameCitySceneContent(before,{...next,chunks:[{...before.chunks[0]!,contentHash:"new"}]})).toBe(false);
  expect(sameCitySceneContent(before,{...next,completedDistrictSnapshots:[]})).toBe(false);
  expect(sameCitySceneContent(before,{...next,roadContext:{schemaVersion:1,nodes:[],segments:[]}})).toBe(false);
  expect(sameCitySceneContent(before,{...next,city:{...before.city,bounds:{...before.city.bounds,maxX:50}}})).toBe(false);
});

it("distinguishes entity, infrastructure and removed pages without treating versions as geometry", () => {
  const page = (x:number, hash:string, version=1) => ({chunkX:x,chunkY:0,contentHash:hash,publishedVersion:version,terrainSeed:1,roadRuns:[],surfaceRuns:[]});
  const before = {city:{id:"c",bounds:{}},schemaVersion:5,lod:"DETAIL",chunkSize:64,chunks:[page(0,"a"),page(1,"b"),page(2,"c")],completedDistrictSnapshots:[]} as unknown as CitySceneDto;
  const next = {...before,chunks:[page(0,"a",10),page(1,"title",10),{...page(2,"roads",10),roadRuns:[{start:{x:128,y:0},end:{x:129,y:0}}]}]} as unknown as CitySceneDto;
  const change = citySceneChanges(before,next);
  expect([...change.changedChunks]).toEqual(["1,0","2,0"]);
  expect([...change.groundChunks]).toEqual(["2,0"]);
  expect([...change.terrainChunks]).toEqual([]);
  expect(change.paddingChanged).toBe(true);
  expect(citySceneChanges(before,{...before,chunks:[{...before.chunks[0]!,contentHash:"rename"},...before.chunks.slice(1)]}).paddingChanged).toBe(false);
  expect([...citySceneChanges(before,{...next,chunks:next.chunks.slice(0,2)}).removedChunks]).toEqual(["2,0"]);
  expect([...citySceneChanges(before,{...next,chunks:[{...next.chunks[0]!,terrainSeed:2}]}).terrainChunks]).toEqual(["0,0"]);
});
