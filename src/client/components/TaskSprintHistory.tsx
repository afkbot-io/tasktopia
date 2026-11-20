import { useEffect, useState } from 'react';
import type { TaskSprintPageDto } from '../../shared/task-sprints';
import { ApiError } from '../api';
import { loadTaskSprints } from '../task-read-cache';
import { readTaskWithInvalidationRetry } from '../owned-read-cache';
import './task-pagination.css';

const labels={OPEN:'Текущий этап',CARRIED:'Продолжена в следующем спринте',COMPLETED:'Завершена'};

/** Read-only navigation. Mutations are exclusively MCP commands. */
export function TaskSprintHistory({countryId,taskId,revision,onAuthenticationRequired}:{
  countryId:string;taskId:string;revision:number;onAuthenticationRequired?:()=>void;
}){
  const [cursors,setCursors]=useState<(string|null)[]>([null]);
  const cursor=cursors.at(-1)!;
  const [page,setPage]=useState<TaskSprintPageDto|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');
    void readTaskWithInvalidationRetry(controller.signal,()=>loadTaskSprints(countryId,taskId,cursor,controller.signal))
      .then(value=>{if(!controller.signal.aborted)setPage(value);})
      .catch(reason=>{
        if(controller.signal.aborted)return;
        if(reason instanceof ApiError&&[401,403,404].includes(reason.status))setPage(null);
        if(reason instanceof ApiError&&[401,403].includes(reason.status))onAuthenticationRequired?.();
        setError(reason instanceof Error?reason.message:'Не удалось открыть историю спринтов');
      }).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[countryId,taskId,cursor,revision,retry,onAuthenticationRequired]);
  return <section className="task-sprint-history" aria-label="Спринты задачи" aria-busy={busy}>
    {page&&<dl className="task-sprint-locations"><div><dt>Основное здание</dt><dd>{page.homeDistrictName}</dd></div><div><dt>Рабочий спринт</dt><dd>{page.currentDistrictName}</dd></div></dl>}
    {error&&<p role="alert" className="task-refresh-error">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Повторить</button></p>}
    {busy&&<p role="status" className="muted">Загружаем этапы…</p>}
    {page?.items.length?<ol className="task-sprint-chain">{page.items.map(phase=><li key={phase.id} data-sprint-outcome={phase.outcome}>
      <span className="task-sprint-sequence" aria-label={`Этап ${phase.sequence}`}>{phase.sequence}</span><div>
        <strong>{phase.districtName}</strong><p>{phase.outcome==='OPEN'&&phase.districtStatus==='PLANNED'?'Ожидает активации спринта':labels[phase.outcome]}</p>
        <p className="muted">{phase.exitProgress===null?`Принята с готовностью ${phase.entryProgress}%`:phase.outcome==='COMPLETED'?`Готовность при завершении: ${phase.exitProgress}%`:`Зафиксировано при передаче: ${phase.exitProgress}%`}</p>
        {phase.comment&&<p className="task-sprint-comment">{phase.comment}</p>}
      </div></li>)}</ol>:!busy&&!error?<p className="muted">Задача выполняется в одном спринте.</p>:null}
    {(cursors.length>1||page?.nextCursor)&&<nav className="task-page-navigation" aria-label="Страницы истории спринтов">
      <button type="button" disabled={busy||cursors.length===1} onClick={()=>{setBusy(true);setPage(null);setCursors(a=>a.slice(0,-1));}}>← Назад</button>
      <span>Страница {cursors.length}</span>
      <button type="button" disabled={busy||!page?.nextCursor} onClick={()=>{const next=page?.nextCursor;if(next){setBusy(true);setPage(null);setCursors(a=>[...a,next]);}}}>Далее →</button>
    </nav>}
  </section>;
}
