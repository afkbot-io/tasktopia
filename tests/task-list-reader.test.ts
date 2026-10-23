import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTaskListPage, taskListPagePath } from '../src/client/task-list-reader';
import type { TaskListPageDto } from '../src/shared/task-read-contracts';
const page=(overrides:Partial<TaskListPageDto>={}):TaskListPageDto=>({kind:'task.list-page',version:1,countryId:'country-a',items:[],nextCursor:null,...overrides});
afterEach(()=>vi.useRealTimers());
describe('explicit bounded task catalog read',()=>{
  it('sends country, combined filters and exactly fifty items per page',()=>{
    const url=new URL(taskListPagePath('country-a',{q:' #42 ',cityId:'city',districtId:'district',status:'TESTING',workItemType:'BUG',priority:'HIGH',assigneeUserId:'user'},'opaque'),'http://localhost');
    expect(url.pathname).toBe('/api/tasks/list-page');
    expect(Object.fromEntries(url.searchParams)).toEqual({countryId:'country-a',limit:'50',q:'#42',cityId:'city',districtId:'district',status:'TESTING',workItemType:'BUG',priority:'HIGH',assigneeUserId:'user',cursor:'opaque'});
  });
  it('rejects a foreign page and cursor that cannot advance',async()=>{
    await expect(readTaskListPage('country-a',{},null,new AbortController().signal,async()=>page({countryId:'country-b'}))).rejects.toThrow('страницу');
    await expect(readTaskListPage('country-a',{},'same',new AbortController().signal,async()=>page({nextCursor:'same'}))).rejects.toThrow('страницу');
  });
});

it('bounds a hung transport and cancels its own request without aborting the caller',async()=>{
  vi.useFakeTimers();const caller=new AbortController();let requestSignal:AbortSignal|undefined;
  const settled=vi.fn();void readTaskListPage('country-a',{},null,caller.signal,async(_path,signal)=>{requestSignal=signal;return new Promise(()=>undefined);}).then(settled,settled);
  await vi.advanceTimersByTimeAsync(8001);
  expect(settled).toHaveBeenCalledTimes(1);expect(settled.mock.calls[0]?.[0]).toMatchObject({message:'Не удалось загрузить список задач. Повторите попытку.'});
  expect(requestSignal?.aborted).toBe(true);expect(caller.signal.aborted).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
