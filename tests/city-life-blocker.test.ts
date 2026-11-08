import { expect,it } from 'vitest';
import { createCityLifeBlocker,cityLifeSites } from '../src/client/city-life';

it('uses membership only and preserves the former blocked union and ordered life sites',()=>{
  const blocked=new Set(['0,0','1,0']),roads=new Map([['2,0',{x:2,y:0}]]),parking=new Set(['3,0','1,0']);
  const previous=new Set([...blocked,...roads.keys(),...parking]);
  for(const source of [blocked,roads,parking])for(const name of [Symbol.iterator,'values','keys','entries'])
    Object.defineProperty(source,name,{value(){throw new Error('Do not materialize a whole-city membership');}});
  const view=createCityLifeBlocker(blocked,roads,parking);
  for(const id of ['0,0','1,0','2,0','3,0','4,0','unknown'])expect(view.has(id)).toBe(previous.has(id));
  const walk=new Map(Array.from({length:100},(_,i)=>({x:i%10,y:Math.floor(i/10)})).map(c=>[`${c.x},${c.y}`,c]));
  const tasks=[{id:'home',status:'COMPLETED' as const,stage:5,accessPath:[{x:0,y:0},{x:4,y:0}],visualKind:'BUILDING' as const,
    serviceRole:undefined,workItemType:'TASK' as const,defectSummary:undefined}];
  expect(cityLifeSites(tasks,walk,view,roads)).toEqual(cityLifeSites(tasks,walk,previous,roads));
  expect(cityLifeSites(tasks,walk,view,roads).length).toBeGreaterThan(0);
});
