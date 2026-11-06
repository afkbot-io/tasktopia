import {setImmediate} from 'node:timers/promises';
import type {CitySceneDto} from '../../src/shared/city-scene-contract';
import {packCitySceneTransfer,hydrateCitySceneTransfer} from '../../src/client/city-scene-transfer';
const mode=process.argv[2];if(!['eager','packed'].includes(mode)||typeof globalThis.gc!=='function')throw Error('Explicit isolated GC mode required');
const options=mode==='packed'?{runStorage:'PACKED_IMMUTABLE' as const}:{};
const fixture=(count:number)=>{
  const runs=Array.from({length:count},(_,i)=>({start:{x:-i,y:i},end:{x:-i,y:i+1},orientation:'vertical'}));
  return {schemaVersion:5,sceneRevision:'retained-runs',city:{id:'city'},chunks:[{roadRuns:runs,surfaceRuns:runs,districts:[{id:'d',cellRuns:runs}],
    tasks:[],decorationContext:{surfaceHaloRuns:runs,blockedCellRuns:runs,districts:[],tasks:[]}}],completedDistrictSnapshots:[]} as unknown as CitySceneDto;
};
const gc=async()=>{for(let i=0;i<3;i++){await setImmediate();globalThis.gc!();}};
await hydrateCitySceneTransfer(packCitySceneTransfer(fixture(8)),options);await gc();
const packed=packCitySceneTransfer(fixture(50000));await gc();
const usage=()=>{const m=process.memoryUsage();return {heap:m.heapUsed,buffers:m.arrayBuffers,total:m.heapUsed+m.arrayBuffers};};
const before=usage(),scene=await hydrateCitySceneTransfer(packed,options);await gc();const after=usage();
// Read only after measuring: the source has to remain live and a real consumer
// must still be able to obtain every decoded run from the retained scene.
const count=scene.chunks[0]!.roadRuns.length;
if(count!==50000||packed.coordinates.length!==200000)throw Error('Incomplete retained geometry');
console.log(JSON.stringify({mode,count,before,after,retainedBytes:after.total-before.total,heapBytes:after.heap-before.heap,bufferBytes:after.buffers-before.buffers}));
