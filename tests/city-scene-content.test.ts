import { expect,it } from "vitest";
import { sameCitySceneContent } from "../src/client/city-scene-content";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
it("retains local render data for transport-only revisions but detects changed terrain or snapshots",()=>{
  const before={city:{id:"city",bounds:{minX:0,minY:0,maxX:20,maxY:20}},chunks:[{chunkX:0,chunkY:0,contentHash:"one",publishedVersion:1}],completedDistrictSnapshots:[{districtId:"d",revision:"done"}],intercityRoads:[],railway:null,airportConnections:[],railConnections:[],sceneRevision:"old"} as unknown as CitySceneDto;
  const next={...before,sceneRevision:"new",airportConnections:[{id:"flight"}]} as CitySceneDto;
  expect(sameCitySceneContent(before,next)).toBe(true);
  expect(sameCitySceneContent(before,{...next,chunks:[{...before.chunks[0]!,contentHash:"new"}]})).toBe(false);
  expect(sameCitySceneContent(before,{...next,completedDistrictSnapshots:[]})).toBe(false);
  expect(sameCitySceneContent(before,{...next,city:{...before.city,bounds:{...before.city.bounds,maxX:50}}})).toBe(false);
});
