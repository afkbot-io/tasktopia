import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createCityMovementDependencies} from '../../src/client/city-movement-dependencies';
import {baselineCityMovementDependencies} from '../fixtures/city-movement-dependencies-baseline';
import type {ChunkDto,ChunkTaskDto} from '../../src/shared/contracts';

assert.ok(global.gc,'This owned memory probe requires --expose-gc');
const tasks=Array.from({length:10_000},(_,i)=>({id:`task-${i}`,taskNumber:i,stage:5,status:'COMPLETED',visualKind:'BUILDING',visualAssetKey:'house',workItemType:'TASK',
  footprint:Array.from({length:64},(_,j)=>({x:i%100*12+j%8,y:Math.floor(i/100)*12+Math.floor(j/8)})),accessPath:[{x:i%100*12+4,y:Math.floor(i/100)*12+8}]} as ChunkTaskDto));
const chunk={chunkX:0,chunkY:0,terrain:[],roads:[],surfaces:[],decorations:[],worldFeatures:[],tasks} as unknown as ChunkDto;
const owner:{read?:ReturnType<typeof createCityMovementDependencies>}={};
Object.assign(globalThis,{cityDependencyProbe:{tasks,chunk,owner}});
async function collect(){await setImmediate();for(let i=0;i<4;i++)global.gc!();}
async function sample(label:string,create:typeof createCityMovementDependencies){
  owner.read=undefined;await collect();const before=process.memoryUsage().heapUsed;
  owner.read=create();assert.deepEqual(owner.read([chunk],[]),{geometry:1,life:1});
  await collect();const bytes=process.memoryUsage().heapUsed-before;
  // Keep the measured tracker observably alive, including its WeakMap values.
  assert.deepEqual(owner.read([chunk],[]),{geometry:1,life:1});
  return {label,bytes};
}
const label=process.argv[2];assert.ok(label==='old'||label==='new','Explicit implementation required');
console.log(JSON.stringify({tasks:tasks.length,footprintCells:tasks.length*64,...await sample(label,label==='old'?baselineCityMovementDependencies:createCityMovementDependencies)}));
