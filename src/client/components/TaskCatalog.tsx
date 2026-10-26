import { useRef, useState } from 'react';
import type { PlanDistrictDto, TaskPriority, TaskStatus, WorkItemType } from '../../shared/contracts';
import type { TaskListItemDto } from '../../shared/task-read-contracts';
import { useTaskListPage } from '../use-task-list-page';
import { districtDevelopmentSummary } from '../district-development';
import { Button, Field } from './ui';

export const CATALOG_STATUS:Record<TaskStatus,string>={PLANNING:'В плане',STARTED:'Начато',IN_PROGRESS:'В работе',TESTING:'Приёмка',COMPLETED:'Завершено'};
const TYPES:Record<WorkItemType,string>={TASK:'Строительство',BUG:'Ремонт',RELEASE:'Открытие',HOTFIX:'Срочный ремонт'};
const PRIORITIES:Record<TaskPriority,string>={LOW:'Низкий',NORMAL:'Обычный',HIGH:'Высокий',CRITICAL:'Критический'};

/** Read-only catalog: filters and cursor pages never mutate work or geometry. */
export function TaskCatalog({countryId,cityId,districtId,districtName,userId,revision,onSelectTask,districts}: {
  countryId:string;cityId:string;districtId?:string;userId:string;revision:number;
  onSelectTask:(task:TaskListItemDto)=>void;districts?:readonly PlanDistrictDto[];districtName?:string;
}) {
  const [q,setQuery]=useState(''),[status,setStatus]=useState<TaskStatus|''>(''),[type,setType]=useState<WorkItemType|''>('');
  const [priority,setPriority]=useState<TaskPriority|''>(''),[mine,setMine]=useState(false),[district,setDistrict]=useState('');
  const rows=useRef<HTMLDivElement>(null),conditions=useRef<HTMLDivElement>(null);
  const page=useTaskListPage({countryId,revision,filters:{cityId,districtId:districtId||district||undefined,q,status:status||undefined,
    workItemType:type||undefined,priority:priority||undefined,assigneeUserId:mine?userId:undefined},debounceMs:180});
  const reset=()=>{setQuery('');setStatus('');setType('');setPriority('');setMine(false);setDistrict('');if(conditions.current)conditions.current.scrollTop=0;};
  const completeDistrict=Boolean(districtId&&!q&&!status&&!type&&!priority&&!mine&&page.pageNumber===1&&!page.hasNext&&!page.pending&&!page.error&&page.items.length);
  const summary=completeDistrict?districtDevelopmentSummary(districtName??'',page.items):undefined;
  const move=(direction:'previous'|'next')=>{page[direction]();window.requestAnimationFrame(()=>rows.current?.focus());};
  return <section className="task-catalog" aria-label="Каталог задач">
    <div ref={conditions} className="task-catalog-filters">
      <Field label="Найти задачу" placeholder="Номер или название" value={q} maxLength={160} onChange={event=>setQuery(event.target.value)} />
      {!districtId&&districts&&<label>Район<select value={district} onChange={event=>setDistrict(event.target.value)}><option value="">Все районы</option>{districts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label>Статус<select value={status} onChange={event=>setStatus(event.target.value as TaskStatus|'')}><option value="">Все статусы</option>{Object.entries(CATALOG_STATUS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Тип задачи<select value={type} onChange={event=>setType(event.target.value as WorkItemType|'')}><option value="">Все типы</option>{Object.entries(TYPES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Приоритет<select value={priority} onChange={event=>setPriority(event.target.value as TaskPriority|'')}><option value="">Все приоритеты</option>{Object.entries(PRIORITIES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="task-catalog-mine"><input type="checkbox" checked={mine} onChange={event=>setMine(event.target.checked)} />Мои задачи</label>
    </div>
    {(q||status||type||priority||mine||district)&&<Button variant="quiet" onClick={reset}>Сбросить условия</Button>}
    {summary&&<div className="directory-district-summary" role="group" aria-label="Сводка района"><p>{summary.line}</p><p>{summary.detail}</p></div>}
    <div ref={rows} className="task-catalog-page" tabIndex={-1} aria-busy={page.pending}>
      {page.pending&&<p className="plan-placeholder" role="status">Загружаем задачи…</p>}
      {page.error&&<div className="plan-error" role="alert"><p>{page.error}</p><Button onClick={page.retry}>Повторить загрузку задач</Button></div>}
      {!page.pending&&!page.error&&!page.items.length&&<p className="plan-placeholder" role="status">Подходящих задач нет</p>}
      <ul className="task-catalog-rows" aria-label="Задачи города">
        {page.items.map(task=><li key={task.id} className="plan-row"><button type="button" data-task-id={task.id} onClick={event=>{event.currentTarget.focus();onSelectTask(task);}}>
          <i className={`task-stage-dot stage-${task.stage}`}>{task.stage}</i><span><strong>#{task.taskNumber} · {task.title}</strong><small>{task.districtName} · {TYPES[task.workItemType]} · {CATALOG_STATUS[task.status]} · {task.progress}%</small><small>{PRIORITIES[task.priority]} приоритет · Объём: {task.estimate} SP</small></span>
        </button></li>)}
      </ul>
    </div>
    <nav className="task-list-pagination" aria-label="Страницы задач">
      <Button disabled={page.pending||!page.hasPrevious} onClick={()=>move('previous')}>Назад</Button>
      <span role="status">Страница {page.pageNumber}{!page.pending&&!page.error?` · На странице: ${page.items.length}`:''}</span>
      <Button disabled={page.pending||!page.hasNext} onClick={()=>move('next')}>Далее</Button>
    </nav>
  </section>;
}
