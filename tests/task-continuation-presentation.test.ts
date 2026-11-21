import { expect, it } from 'vitest';
import type { ChunkDto, WorldFeatureDto } from '../src/shared/contracts';
import { continuationConstructionContext } from '../src/client/task-continuation-presentation';
import { planConstructionLife } from '../src/client/construction-life';
import { patchChunkTaskStatuses } from '../src/client/chunk-task-patches';
import { taskSprintBadge } from '../src/client/task-focus-presentation';

const site=():WorldFeatureDto=>({id:'phase-2',cityId:'city',districtId:'next',parentFeatureId:null,kind:'TASK_CONTINUATION',
  assetKind:'BUILDING',assetKey:'compact-row-v1',origin:{x:10,y:10},footprint:[{x:10,y:10}],orientation:'S',
  accessPath:[{x:10,y:11},{x:10,y:12},{x:10,y:13}],developmentStage:5,
  continuation:{taskId:'task',taskNumber:7,title:'One task',sequence:2,outcome:'OPEN',status:'IN_PROGRESS',progress:40,
    homeDistrictId:'home',currentDistrictId:'next'}});

it('places one construction crew at the current site and keeps historical sites quiet',()=>{
  const feature=site(),task={id:'task',taskNumber:7,districtId:'home',currentDistrictId:'next',status:'IN_PROGRESS' as const,
    progress:40,footprint:[{x:0,y:0}],accessPath:[{x:0,y:1},{x:0,y:2}]};
  const context=continuationConstructionContext([task],[feature]);
  expect(context.tasks).toHaveLength(1);expect(context.tasks[0]).toMatchObject({id:'task',districtId:'next',footprint:feature.footprint});
  const life=planConstructionLife(context.tasks,new Set(['next']),new Set(),new Set(),{reducedMotion:false,economy:false,features:context.obstacles});
  expect(life).toHaveLength(1);expect(life[0]!.workers.length).toBeGreaterThan(0);
  expect(life[0]!.workers.every(worker=>worker.path.every(cell=>cell.x===10))).toBe(true);
  expect(planConstructionLife(context.tasks,new Set(['home']),new Set(),new Set(),{reducedMotion:false,economy:false})).toEqual([]);
  const historic={...feature,continuation:{...feature.continuation!,outcome:'CARRIED' as const}};
  expect(continuationConstructionContext([task],[historic]).tasks).toEqual([]);
  expect(taskSprintBadge({...task,workItemType:'TASK'},new Set(['next']))?.kind).toBe('WORK');
  expect(taskSprintBadge({...task,workItemType:'TASK'},new Set(['home']))).toBeUndefined();
});

it('patches a visible continuation without loading its offscreen home and preserves frozen progress',()=>{
  const active=site(),historic={...site(),id:'phase-old',continuation:{...site().continuation!,outcome:'CARRIED' as const,progress:25}};
  const chunk:ChunkDto={chunkX:0,chunkY:0,size:64,terrain:[],roads:[],surfaces:[],districts:[],tasks:[],decorations:[],worldFeatures:[active,historic],worldVersion:1};
  const patches=new Map([['task',{status:'COMPLETED' as const,progress:100,stage:5,worldVersion:2}]]);
  const changed=patchChunkTaskStatuses(chunk,patches);
  expect(changed.worldVersion).toBe(2);
  expect(changed.worldFeatures[0]!.continuation).toMatchObject({outcome:'COMPLETED',status:'COMPLETED',progress:100});
  expect(changed.worldFeatures[1]).toBe(historic);
  expect(active.continuation!.progress).toBe(40);
  expect(patchChunkTaskStatuses(changed,patches)).toBe(changed);
});
