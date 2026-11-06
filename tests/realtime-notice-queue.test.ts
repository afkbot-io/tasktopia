import { expect,it } from 'vitest';
import { appendRealtimeNotice } from '../src/shared/realtime-notifications';

const notice=(id:number,groupKey:string)=>({id,groupKey,title:`Event${id}`,compactTitle:`${id}`,location:'City',
  tone:'info' as const,actionLabel:null,target:null});
it('replaces one canonical object including a deleted target without mutating the old queue',()=>{
  const before=Object.freeze([notice(1,'country/task-a'),notice(2,'country/task-b')]);
  const deleted=notice(3,'country/task-a'),next=appendRealtimeNotice(before,deleted);
  expect(next).toEqual([before[1],deleted]);expect(before.map(n=>n.id)).toEqual([1,2]);
});
it('keeps separate objects and countries within three entries, rejecting old or replayed events',()=>{
  let items:ReturnType<typeof appendRealtimeNotice>=[];
  for(const item of [notice(1,'a/same'),notice(2,'a/other'),notice(3,'b/same'),notice(4,'a/third')])items=appendRealtimeNotice(items,item);
  expect(items.map(n=>n.id)).toEqual([2,3,4]);
  expect(appendRealtimeNotice(items,notice(1,'a/other'))).toEqual(items);
  expect(appendRealtimeNotice(items,notice(4,'a/third'))).toEqual(items);
  for(const id of [NaN,Infinity,0,-1,4.5])expect(appendRealtimeNotice(items,notice(id,'a/third'))).toEqual(items);
});
