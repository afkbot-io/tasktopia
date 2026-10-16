import { useEffect, useRef, useState } from 'react';
import type { ArchiveRecordDto, BootstrapDto, PlanCityDto, PlanCityPageDto, PlanDistrictDto } from '../../shared/contracts';
import type { TaskListItemDto } from '../../shared/task-read-contracts';
import { api } from '../api';
import { TaskCatalog } from './TaskCatalog';

type View='cities'|'districts'|'tasks'|'archive';
const districtStatus:Record<PlanDistrictDto['status'],string>={PLANNED:'Запланирован',ACTIVE:'Активный',COMPLETED:'Завершён',ABANDONED:'Заброшен'};
const kindLabel:Record<ArchiveRecordDto['kind'],string>={PROJECT:'Проект',REPOSITORY:'Репозиторий',ARCHITECTURE:'Архитектура',CONVENTION:'Правило',ENVIRONMENT:'Окружение',TEMPLATE:'Шаблон'};

export function CityDirectory({bootstrap,refreshToken,initialSection,initialFocus,onClose,onCityFocus,onTaskSelect,onTaskNavigate,onArchiveRecordSelect}: {
  bootstrap:BootstrapDto;refreshToken:number;initialSection:'cities'|'archive';initialFocus?:{cityId:string;districtId:string};
  onClose:()=>void;onCityFocus:(city:PlanCityDto)=>void;onTaskSelect:(taskId:string)=>void;
  onTaskNavigate?:(task:TaskListItemDto)=>void;onArchiveRecordSelect:(recordId:string)=>void;
}) {
  const [cityId,setCityId]=useState(initialFocus?.cityId??bootstrap.initialCity?.id??'');
  const [districtId,setDistrictId]=useState(initialFocus?.districtId??'');
  const [view,setView]=useState<View>(initialSection==='archive'?'archive':initialFocus?.districtId?'tasks':initialFocus?'districts':'cities');
  const [cityQuery,setCityQuery]=useState(''),[districtQuery,setDistrictQuery]=useState('');
  const [cityPage,setCityPage]=useState(0),[districtPage,setDistrictPage]=useState(0);
  const [cities,setCities]=useState<PlanCityDto[]>([]),[districts,setDistricts]=useState<PlanDistrictDto[]>([]);
  const [records,setRecords]=useState<ArchiveRecordDto[]>([]);
  const [citiesLoading,setCitiesLoading]=useState(true),[districtsLoading,setDistrictsLoading]=useState(false),[archiveLoading,setArchiveLoading]=useState(false);
  const [error,setError]=useState(''),[reload,setReload]=useState(0);
  const drawerRef=useRef<HTMLElement>(null),headingRef=useRef<HTMLHeadingElement>(null),closeRef=useRef(onClose);
  const city=cities.find(item=>item.id===cityId),district=districts.find(item=>item.id===districtId);
  const countryId=bootstrap.country.id,archiveSelected=view==='archive',showCities=view==='cities';
  const loading=view==='cities'?citiesLoading:view==='archive'?archiveLoading:districtsLoading;
  useEffect(()=>{closeRef.current=onClose;},[onClose]);

  useEffect(()=>{
    setView(initialSection==='archive'?'archive':initialFocus?.districtId?'tasks':initialFocus?'districts':'cities');
    if(initialFocus){setCityId(initialFocus.cityId);setDistrictId(initialFocus.districtId);}
  },[initialSection,initialFocus]);
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    drawerRef.current?.querySelector<HTMLButtonElement>('[aria-label="Закрыть список"]')?.focus({preventScroll:true});
    const outside=(event:PointerEvent)=>{if(event.target instanceof Element&&!event.target.closest('.modal-backdrop')&&!drawerRef.current?.contains(event.target))closeRef.current();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();closeRef.current();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true});};
  },[]);

  useEffect(()=>{
    if(archiveSelected)return;
    const controller=new AbortController();let active=true,expired=false;setError('');
    setCitiesLoading(true);
    const timer=window.setTimeout(()=>{expired=true;controller.abort();if(active){setError('Не удалось загрузить города. Повторите попытку.');setCitiesLoading(false);}},8000);
    void (async()=>{
      const result:PlanCityDto[]=[],ids=new Set<string>(),cursors=new Set<string>();let cursor:string|null=null;
      do {
        const query=new URLSearchParams({limit:'50'});if(cursor)query.set('cursor',cursor);
        const page=await api<PlanCityPageDto>(`/api/plan/cities-page?${query}`,{signal:controller.signal});controller.signal.throwIfAborted();
        for(const item of page.items){if(ids.has(item.id))throw new Error('Повторяющаяся страница городов');ids.add(item.id);result.push(item);}
        cursor=page.nextCursor;if(cursor){if(cursors.has(cursor))throw new Error('Повторяющаяся страница городов');cursors.add(cursor);}
      } while(cursor);
      if(active&&!expired){setCities(result);setCityId(current=>result.some(item=>item.id===current)?current:result[0]?.id??'');}
    })().catch(cause=>{if(active&&!expired)setError(cause instanceof Error?cause.message:'Не удалось загрузить города');}).finally(()=>{window.clearTimeout(timer);if(active&&!expired)setCitiesLoading(false);});
    return()=>{active=false;window.clearTimeout(timer);controller.abort();};
  },[countryId,archiveSelected,refreshToken,reload]);

  useEffect(()=>{
    if(archiveSelected||showCities||!cityId){setDistrictsLoading(false);return;}
    const controller=new AbortController();let active=true,expired=false;setDistricts([]);setDistrictsLoading(true);setError('');
    const timer=window.setTimeout(()=>{expired=true;controller.abort();if(active){setError('Не удалось загрузить районы. Повторите попытку.');setDistrictsLoading(false);}},8000);
    void api<PlanDistrictDto[]>(`/api/plan/cities/${encodeURIComponent(cityId)}/districts`,{signal:controller.signal})
      .then(items=>{if(active&&!expired&&!controller.signal.aborted)setDistricts(items);})
      .catch(cause=>{if(active&&!expired)setError(cause instanceof Error?cause.message:'Не удалось загрузить районы');})
      .finally(()=>{window.clearTimeout(timer);if(active&&!expired)setDistrictsLoading(false);});
    return()=>{active=false;window.clearTimeout(timer);controller.abort();};
  },[countryId,cityId,archiveSelected,showCities,refreshToken,reload]);

  useEffect(()=>{
    if(!archiveSelected)return;const controller=new AbortController();let active=true;setArchiveLoading(true);setError('');
    void api<ArchiveRecordDto[]>('/api/archive/records',{signal:controller.signal}).then(items=>{if(active)setRecords(items);})
      .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Не удалось загрузить архив');}).finally(()=>{if(active)setArchiveLoading(false);});
    return()=>{active=false;controller.abort();};
  },[countryId,archiveSelected,refreshToken,reload]);

  const changeView=(next:View)=>{setView(next);window.requestAnimationFrame(()=>headingRef.current?.focus());};
  const openDistricts=(id:string)=>{setCityId(id);setDistrictId('');setDistrictQuery('');setDistrictPage(0);changeView('districts');};
  const openTasks=(id='')=>{setDistrictId(id);changeView('tasks');};
  const filteredCities=cities.filter(item=>item.name.toLocaleLowerCase().includes(cityQuery.trim().toLocaleLowerCase()));
  const filteredDistricts=districts.filter(item=>item.name.toLocaleLowerCase().includes(districtQuery.trim().toLocaleLowerCase()));
  const visibleCities=filteredCities.slice(cityPage*50,cityPage*50+50),visibleDistricts=filteredDistricts.slice(districtPage*50,districtPage*50+50);
  const title=view==='archive'?'Архив проекта':view==='cities'?'Города':city?.name??'Районы города';
  const chooseTask=(task:TaskListItemDto)=>onTaskNavigate?onTaskNavigate(task):onTaskSelect(task.id);

  return <aside ref={drawerRef} className="city-directory" aria-label={view==='archive'?'Архив проекта':view==='cities'?'Города':'Районы города'}>
    <header className="plan-head"><div><p className="eyebrow">{bootstrap.country.name}</p><strong>{title}</strong></div><button type="button" onClick={onClose} aria-label="Закрыть список">×</button></header>
    {error&&<div className="plan-error" role="alert">{error}<button type="button" onClick={()=>setReload(value=>value+1)}>Повторить</button></div>}
    <div className="directory-content">
      {view==='cities'&&<section>
        <h3 ref={headingRef} tabIndex={-1} className="plan-subheading">Города <span>{bootstrap.stats.cities}</span></h3>
        <input className="directory-search" aria-label="Найти город" placeholder="Найти город…" value={cityQuery} onChange={event=>{setCityQuery(event.target.value);setCityPage(0);}} />
        {citiesLoading&&!error&&<p className="plan-placeholder" role="status">Загружаем города…</p>}
        {!loading&&!error&&!filteredCities.length&&<p className="plan-placeholder" role="status">{cities.length?'Подходящих городов нет':'Нет городов'}</p>}
        {visibleCities.map(item=><div key={item.id} className="plan-row directory-city-row">
          <button type="button" onClick={()=>onCityFocus(item)}><i>▦</i><span><strong>{item.name}</strong>{item.description&&<small>{item.description.slice(0,64)}</small>}<small>{item.taskCount} зданий</small></span></button>
          <button type="button" className="directory-city-districts" aria-label={`Районы города ${item.name}`} onClick={()=>openDistricts(item.id)}>Районы</button>
        </div>)}
        {filteredCities.length>50&&<nav className="task-list-pagination" aria-label="Страницы городов"><button disabled={cityPage===0} onClick={()=>setCityPage(value=>value-1)}>Назад</button><span>Страница {cityPage+1}</span><button disabled={(cityPage+1)*50>=filteredCities.length} onClick={()=>setCityPage(value=>value+1)}>Далее</button></nav>}
      </section>}
      {view==='archive'&&<section className="plan-tasks plan-archive-records"><h3 ref={headingRef} tabIndex={-1}>Записи архива <span>{records.length}</span></h3>
        <p className="plan-section-note">Короткий устойчивый контекст проекта. Текущая работа остаётся в задачах.</p>
        {archiveLoading&&!error&&<p className="plan-placeholder" role="status">Загружаем архив…</p>}
        {!loading&&!records.length&&!error&&<p className="plan-placeholder">Архив пока пуст</p>}
        {records.map(record=><div key={record.id} className="plan-row"><button type="button" onClick={event=>{event.currentTarget.focus();onArchiveRecordSelect(record.id);}}><i className={`reference-kind-dot kind-${record.kind.toLowerCase()}`} /><span><strong>{record.title}</strong><small>{kindLabel[record.kind]}{record.body?` · ${record.body.slice(0,72)}`:''}</small></span></button></div>)}
      </section>}
      {view==='districts'&&<section>
        <button className="directory-back" onClick={()=>changeView('cities')}>← Все города</button>
        <h3 ref={headingRef} tabIndex={-1}>Районы <span>{districts.length}</span></h3>
        <button type="button" className="directory-all-tasks" onClick={()=>openTasks()}>Все задачи города</button>
        <input className="directory-search" aria-label="Найти район" placeholder="Найти район…" value={districtQuery} onChange={event=>{setDistrictQuery(event.target.value);setDistrictPage(0);}} />
        {districtsLoading&&!error&&<p className="plan-placeholder" role="status">Загружаем районы…</p>}
        {!loading&&!error&&!filteredDistricts.length&&<p className="plan-placeholder" role="status">{districts.length?'Подходящих районов нет':'В городе пока нет районов'}</p>}
        {visibleDistricts.map(item=><div key={item.id} className="plan-row"><button type="button" onClick={()=>openTasks(item.id)}><i className={`district-dot district-${item.status.toLowerCase()}`} /><span><strong>{item.name}</strong><small>{districtStatus[item.status]} · {item.taskCount} задач{item.deadline?` · до ${new Date(item.deadline).toLocaleDateString('ru-RU')}`:''}</small></span></button></div>)}
        {filteredDistricts.length>50&&<nav className="task-list-pagination" aria-label="Страницы районов"><button disabled={districtPage===0} onClick={()=>setDistrictPage(value=>value-1)}>Назад</button><span>Страница {districtPage+1}</span><button disabled={(districtPage+1)*50>=filteredDistricts.length} onClick={()=>setDistrictPage(value=>value+1)}>Далее</button></nav>}
      </section>}
      {view==='tasks'&&cityId&&<section className="plan-tasks">
        <button className="directory-back" onClick={()=>changeView('districts')}>← Все районы</button>
        <h3 ref={headingRef} tabIndex={-1}>{districtId?district?.name??'Задачи района':'Все задачи города'}</h3>
        <TaskCatalog key={`${countryId}:${cityId}:${districtId}`} countryId={countryId} cityId={cityId} districtId={districtId||undefined} districtName={district?.name} userId={bootstrap.user.id} revision={refreshToken} districts={districts} onSelectTask={chooseTask} />
      </section>}
    </div>
  </aside>;
}
