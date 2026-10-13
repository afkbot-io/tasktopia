import { nextTransportDeparture,transportJourneys,transportStopActivity } from "../../shared/transport-schedule";
import { readServerWorldTime } from "../server-world-clock";
import { useEffect, useRef, useState } from "react";
import type { InfrastructureMilestone } from "../../shared/city-development-policy";
import type { CityDevelopmentDto } from "../../shared/city-development";
import { INFRASTRUCTURE_LABELS } from "../../shared/city-development-policy";
import { api } from "../api";
const STATE = { PLANNED: "Запланировано", BUILDING: "Строится", TESTING: "На проверке", READY: "Готово", HISTORICAL: "Историческое место", UNDISCOVERED: "Ещё не построено" };
const UNIT = { BUILDINGS: "зданий района", DISTRICT_BLOCKS: "кварталов района", CITY_BLOCKS: "кварталов города", CITY_DISTRICTS: "застроенных районов" };
export function CityDevelopmentPanel({ countryId, cityId, revision, onClose, onTask,onCity,onRoute,selectedRoute }: {
  countryId: string; cityId: string; revision: number; onClose: () => void; onTask: (id: string) => void;onCity?:(countryId:string,cityId:string,name:string)=>void;onRoute?:(routeId?:string)=>void;selectedRoute?:string;
}) {
  const [clockTime,setClockTime]=useState(()=>readServerWorldTime()??Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>{if(!document.hidden)setClockTime(readServerWorldTime()??Date.now());},1000);return()=>window.clearInterval(timer);},[]);
  const [data,setData]=useState<CityDevelopmentDto>();
  const [error,setError]=useState(false), [retry,setRetry]=useState(0);
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{ close.current?.focus(); const key=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();}; window.addEventListener("keydown",key); return()=>window.removeEventListener("keydown",key); },[onClose]);
  useEffect(()=>{
    const controller=new AbortController(); setError(false);setData(undefined);
    void api<CityDevelopmentDto>(`/api/city-development?${new URLSearchParams({countryId,cityId})}`,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setData(data);}).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[countryId,cityId,revision,retry]);
  const triggers=new Set(data?.services.map(s=>s.trigger));
  const cityMilestones = [...new Map(data?.districts.flatMap(d => d.milestones)
    .filter(m => m.unit === "CITY_BLOCKS" || m.unit === "CITY_DISTRICTS").map(m => [m.id, m])).values()];
  const milestone = (m: InfrastructureMilestone) => <li key={m.id}><strong>{INFRASTRUCTURE_LABELS[m.role]}</strong><span>{Math.min(m.count,m.required)} / {m.required} {UNIT[m.unit]}{m.eligible?(m.role==="PORT"?" · порог застройки достигнут":" · условие достигнуто"):""}{m.role==="PORT"?" · нужен свободный участок у открытой воды":""}</span></li>;
  const districtName = (id?: string) => data?.districts.find(d => d.id === id)?.name || "Район без названия";
  return <aside className="city-development-panel" aria-label="Развитие города">
    <header><h2>Развитие города</h2><button ref={close} onClick={onClose} aria-label="Закрыть развитие города">×</button></header>
    {error ? <p role="alert">Не удалось загрузить развитие. <button onClick={()=>setRetry(n=>n+1)}>Повторить</button></p> : !data ? <p role="status">Загрузка…</p> : <>
      <p>Службы появляются по мере застройки. Достигнутое условие ставит службу в очередь на подходящий участок при добавлении задач.</p>
      <h3>Службы</h3>
      {!data.services.length && <p>Службы пока не запланированы.</p>}
      <ul>{data.services.map((s,i)=><li key={`${s.trigger}:${i}`}><strong>{INFRASTRUCTURE_LABELS[s.role]}</strong><span>{STATE[s.state]}{s.districtId && ` · ${districtName(s.districtId)}`}</span>{s.taskId&&<button onClick={()=>onTask(s.taskId!)}>Открыть задачу</button>}</li>)}</ul>
      {data.transport && <section aria-label="Транспортные направления"><h3>Транспортные направления</h3>
        <ul>{data.transport.map(network => <li key={network.kind}>
          <strong>{network.kind === "AIR" ? "Авиарейсы" : network.kind === "SEA" ? "Морские рейсы" : "Железная дорога"}</strong>
          {network.state === "NOT_READY" && <span>{network.reason==="NO_AIRFIELD"?"Терминал готов, но для полосы и подхода пока нет свободного сухого участка.":network.kind === "SEA" ? "Завершите строительство порта, чтобы открыть навигацию." : network.kind === "AIR" ? "Завершите строительство аэропорта, чтобы открыть рейсы." : "Завершите строительство вокзала, чтобы открыть движение."}</span>}
          {network.state === "NO_CONNECTION" && <span>{network.reason==='NO_CORRIDOR'?(network.kind==='SEA'?"Порты готовы, но между ними нет свободного морского прохода.":network.kind==='RAIL'?"Вокзалы готовы, но между ними нет доступного сухого коридора.":"Аэропорты готовы. Направление пока недоступно."):network.kind === "SEA" ? "Порт готов. Нужен ещё один готовый порт в доступной части мира." : network.kind === "AIR" ? "Аэропорт готов. Нужен ещё один готовый аэропорт в доступной части мира." : "Вокзал готов. Нужен готовый вокзал в другом городе."}</span>}
          {network.routes.map(route => {
            const local=route.schedule&&route.stopId?transportJourneys(route.schedule,route.stopId,clockTime).find(state=>state.phase==="STOPPED"&&state.progress===0):undefined;
            const activity=local&&route.schedule?transportStopActivity(route.schedule,local):undefined;
            const departure=route.schedule&&route.stopId?Math.max(0,Math.ceil((nextTransportDeparture(route.schedule,route.stopId,clockTime)-clockTime)/1000)):undefined;
            return <div key={route.id} data-transport-route={route.id}>
            <strong>↔ {route.destinationName}</strong><br />
            <span>{network.kind === "AIR" ? "Перелёт" : "В пути"} · {route.travelMs / 1000} с · стоянка {route.dwellMs / 1000} с</span>
            {departure!==undefined&&<span data-departure-seconds={departure}>{activity==="ALIGHTING"?"Высадка пассажиров":activity==="BOARDING"?"Посадка пассажиров":activity==="CLOSING"?"Закрываются двери":activity==="OPENING"?"Прибытие":"Рейс в пути"} · отправление через {departure} с</span>}
            {route.schedule&&<span>{route.schedule.fleetSize} {network.kind==="RAIL"?"состава":network.kind==="SEA"?"парома":"самолёта"} на линии</span>}
            {onRoute&&<button aria-pressed={selectedRoute===route.id} onClick={()=>onRoute(selectedRoute===route.id?undefined:route.id)}>{selectedRoute===route.id?'Скрыть направление':'Показать направление'}</button>}
            {onCity&&route.destinationCountryId&&<button onClick={()=>onCity(route.destinationCountryId!,route.destinationCityId,route.destinationName)}>Открыть город {route.destinationName}</button>}
          </div>;})}
        </li>)}</ul>
        <p>Время игровое. Рейсы ходят по общему расписанию на всех масштабах карты.</p>
      </section>}
      <h3>Что откроется дальше</h3>
      {cityMilestones.length > 0 && <section><h4>Весь город</h4><ul>{cityMilestones.filter(m => !triggers.has(m.id)).map(milestone)}</ul>
        {cityMilestones.every(m => triggers.has(m.id)) && <p>Все городские службы уже запланированы.</p>}
      </section>}
      {data.districts.map(d=><section key={d.id}><h4>{districtName(d.id)}</h4><ul>{d.milestones
        .filter(m=>m.unit!=="CITY_BLOCKS" && m.unit!=="CITY_DISTRICTS" && !triggers.has(m.id))
        .filter(m=>m.role!=="SHOP"||m.required===d.milestones.find(n=>n.role==="SHOP"&&!triggers.has(n.id))?.required)
        .map(milestone)}</ul></section>)}
      <h3>Достопримечательности · {data.landmarks.filter(l=>l.state!=="UNDISCOVERED").length} / {data.landmarks.length}</h3>
      <p>Каждое уникальное здание появляется в городе один раз. История сохраняется после переноса или удаления.</p>
      <ul>{data.landmarks.map(l=><li key={l.family}><strong>{l.label}</strong><span>{STATE[l.state]}</span>{l.taskId&&<button onClick={()=>onTask(l.taskId!)}>Открыть задачу</button>}</li>)}</ul>
    </>}
  </aside>;
}
