import type { TaskListItemDto, TaskListPageDto } from '../shared/task-read-contracts';
import { api } from './api';
export type TaskCatalogFilters = Partial<Pick<TaskListItemDto,'cityId'|'districtId'|'status'|'workItemType'|'priority'>> & {q?:string;assigneeUserId?:string};
export type TaskListRead = (path:string,signal:AbortSignal)=>Promise<TaskListPageDto>;
export function taskListPagePath(countryId:string,filters:TaskCatalogFilters={},cursor:string|null=null):string {
  if(!countryId)throw new Error('Страна не выбрана');
  const query=new URLSearchParams({countryId,limit:'50'});
  const q=filters.q?.trim();if(q)query.set('q',q);
  for(const name of ['cityId','districtId','status','workItemType','priority','assigneeUserId'] as const)if(filters[name])query.set(name,filters[name]);
  if(cursor)query.set('cursor',cursor);
  return `/api/tasks/list-page?${query}`;
}
export async function readTaskListPage(countryId:string,filters:TaskCatalogFilters,cursor:string|null,signal:AbortSignal,
  read:TaskListRead=(path,signal)=>api(path,{signal})):Promise<TaskListPageDto>{
  signal.throwIfAborted();
  const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',cancel,{once:true});
  let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  let page:TaskListPageDto;
  try {
    page=await Promise.race([
      Promise.resolve().then(()=>{controller.signal.throwIfAborted();return read(taskListPagePath(countryId,filters,cursor),controller.signal);}),
      new Promise<never>((_resolve,reject)=>{
        abort=()=>reject(new DOMException('Task list cancelled','AbortError'));
        controller.signal.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>{reject(new Error('Не удалось загрузить список задач. Повторите попытку.'));controller.abort();},8000);
      }),
    ]);
  } finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);if(abort)controller.signal.removeEventListener('abort',abort);}
  signal.throwIfAborted();
  if(page.kind!=='task.list-page'||page.version!==1||page.countryId!==countryId||!Array.isArray(page.items)||page.items.length>50
    ||new Set(page.items.map(task=>task.id)).size!==page.items.length
    ||(page.nextCursor!==null&&(typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor===cursor)))
    throw new Error('Сервер вернул несовместимую страницу задач');
  return page;
}
