import { afterEach, expect, it, vi } from "vitest";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import { encodeCitySceneWire } from "../src/shared/city-scene-wire";
import { hydrateCitySceneTransfer } from "../src/client/city-scene-transfer";
import type { SceneResponseMessage, SceneResponseRequest } from "../src/client/city-scene-response";

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it.each(["full","compact"])("the actual response worker transfers two detached buffers after %s decode and weighing",async mode=>{
  const scene={schemaVersion:5,sceneRevision:"test",city:{id:"city"},lod:"DETAIL",completedDistrictSnapshots:[],chunks:[{
    tasks:[],roadRuns:[{start:{x:-3,y:1},end:{x:2,y:1},mask:3}],surfaceRuns:[],districts:[],
    decorationContext:{surfaceHaloRuns:[],blockedCellRuns:[],districts:[],tasks:[]},
  }]} as unknown as CitySceneDto;
  let received:SceneResponseMessage|undefined,detached=false,count=0;
  const scope={onmessage:undefined as ((event:MessageEvent<SceneResponseRequest>)=>void)|undefined,
    postMessage(value:SceneResponseMessage,transfer:Transferable[]=[]){
      count=transfer.length;received=structuredClone(value,{transfer});
      detached=value.transfer?.coordinates.byteLength===0&&value.transfer.metadataIndices.byteLength===0;
    }};
  vi.stubGlobal("self",scope);await import("../src/client/city-scene-response-worker");
  const body=new TextEncoder().encode(JSON.stringify(mode==="compact"?encodeCitySceneWire(scene):scene)).buffer;
  scope.onmessage!(new MessageEvent<SceneResponseRequest>("message",{data:{body,status:200,headers:[],startedEpoch:performance.timeOrigin,headersAtEpoch:performance.timeOrigin}}));
  await vi.waitFor(()=>expect(received).toBeDefined());
  expect(received!.error).toBeUndefined();expect(received!.scene).toBeUndefined();expect(count).toBe(2);expect(detached).toBe(true);
  expect(received!.metrics!.packMs).toBeGreaterThanOrEqual(0);expect(received!.metrics!.retainedWeight).toBeGreaterThan(0);
  expect(await hydrateCitySceneTransfer(received!.transfer!)).toEqual(scene);
});
