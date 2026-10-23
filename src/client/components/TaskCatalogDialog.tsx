import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlanDistrictDto } from '../../shared/contracts';
import type { TaskListItemDto } from '../../shared/task-read-contracts';
import { api } from '../api';
import { useDialogFocus } from '../use-dialog-focus';
import { TaskCatalog } from './TaskCatalog';
import { Button } from './ui';

export function TaskCatalogDialog({countryId,cityId,userId,revision,onSelectTask,onClose}: {
  countryId:string;cityId:string;userId:string;revision:number;onSelectTask:(task:TaskListItemDto)=>void;onClose:()=>void;
}) {
  const ref=useRef<HTMLElement>(null);useDialogFocus(ref,{onClose});
  const [districts,setDistricts]=useState<PlanDistrictDto[]>(),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let active=true;setError(false);setDistricts(undefined);
    const timer=window.setTimeout(()=>{controller.abort();if(active)setError(true);},8000);
    void api<PlanDistrictDto[]>(`/api/plan/cities/${encodeURIComponent(cityId)}/districts`,{signal:controller.signal})
      .then(items=>{if(active&&!controller.signal.aborted)setDistricts(items);}).catch(()=>{if(active)setError(true);}).finally(()=>window.clearTimeout(timer));
    return()=>{active=false;window.clearTimeout(timer);controller.abort();};
  },[countryId,cityId,revision,retry]);
  return createPortal(<div className="modal-backdrop task-catalog-backdrop" data-map-catalog="true" onPointerDown={event=>{event.stopPropagation();if(event.target===event.currentTarget)onClose();}}>
    <section ref={ref} className="task-catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="task-catalog-heading">
      <header><h2 id="task-catalog-heading">Задачи города</h2><Button aria-label="Закрыть каталог задач" onClick={onClose}>×</Button></header>
      <div className="task-catalog-body">
        {error&&<div className="plan-error" role="alert">Не удалось загрузить районы. Список задач доступен.<Button onClick={()=>setRetry(value=>value+1)}>Повторить загрузку районов</Button></div>}
        <TaskCatalog key={`${countryId}:${cityId}`} countryId={countryId} cityId={cityId} userId={userId} revision={revision} districts={districts} onSelectTask={task=>{onClose();onSelectTask(task);}} />
      </div>
    </section>
  </div>,document.body);
}
