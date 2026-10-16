import { useEffect, useRef } from "react";
import type { InspectionSnapshot, WorldInspection } from "../city-world-inspection";
import "./city-world-observation.css";
const activity:Record<string,string>={OPENING:"Прибытие",ALIGHTING:"Высадка пассажиров",BOARDING:"Посадка пассажиров",CLOSING:"Подготовка к отправлению",TRAVELLING:"В пути",WAITING:"Ожидает рейса"};
const phase:Record<string,string>={GATE:"У терминала",TAXI_OUT:"На рулёжной дорожке",TAKEOFF:"Взлёт",FLYING:"Полёт",LANDING:"Посадка",TAXI_IN:"Возвращается к терминалу",AWAY:"В другом городе",moving:"В пути",stopped:"На платформе",waiting:"За пределами города",ARRIVE:"Службы в пути",WORK:"Работы на месте",CLEAR:"Завершение работ",READY:"Готово"};
const transportPhase=(item:Extract<WorldInspection,{kind:"TRANSPORT"}>)=>item.transportKind==="SEA"
 ?item.phase==="STOPPED"?(item.local?"У причала":"В другом порту"):item.phase==="MOVING"?"На водном маршруте":"Ожидает рейса"
 :phase[item.phase]??"В пути";
export function CityWorldObservation({snapshot,tour,onClose,onFollow,onTask,onTourClose,onChoose}:{snapshot?:InspectionSnapshot;tour?:readonly WorldInspection[];
 onClose:()=>void;onFollow:()=>void;onTask:()=>void;onTourClose:()=>void;onChoose:(item:WorldInspection)=>void}){
 const close=useRef<HTMLButtonElement>(null),tourClose=useRef<HTMLButtonElement>(null);
 const tourOpen=tour!==undefined;useEffect(()=>{if(tourOpen)tourClose.current?.focus();},[tourOpen]);
 const identity=snapshot?.item.kind==="TRANSPORT"?snapshot.item.journeyId:snapshot?.item.kind==="ROAD"?snapshot.item.id:snapshot?.item.task.taskId;
 useEffect(()=>{if(identity)close.current?.focus();},[identity,snapshot?.item.kind]);
 const item=snapshot?.item;
 return <>
  {tour&&<aside className="city-world-observation city-world-tour" aria-label="Интересное в городе" onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();onTourClose();}}}><header><h2>Сейчас в городе</h2><button ref={tourClose} type="button" onClick={onTourClose} aria-label="Закрыть интересное в городе">×</button></header>
   {!tour.length?<p>Сейчас поблизости нет активных событий.</p>:<ul>{tour.map((value)=><li key={value.kind==="TRANSPORT"?value.vehicleId:value.kind==="ROAD"?value.id:value.task.taskId}><button type="button" onClick={()=>onChoose(value)}><strong>{value.title}</strong><span>{value.kind==="TRANSPORT"?`${value.fromName}${value.toName?` → ${value.toName}`:""}`:phase[value.phase]??value.phase}</span></button></li>)}</ul>}
   <p className="city-world-hint">Выберите объект, чтобы посмотреть его на карте.</p></aside>}
  {snapshot&&item&&<aside className="city-world-observation" aria-label="Наблюдение за городом" data-world-kind={item.kind} data-world-vehicle={item.kind==="TRANSPORT"?item.vehicleId:undefined} data-closed-cells={item.kind==="ROAD"?item.closedCells:undefined} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();onClose();}}}>
   <header><div><span className="city-world-kicker">{item.kind==="TRANSPORT"?item.transportKind==="AIR"?"Авиарейс":item.transportKind==="RAIL"?"Поезд":"Паром":item.kind==="ROAD"?"На дороге":"Место в городе"}</span><h2>{item.title}</h2></div><button ref={close} type="button" onClick={onClose} aria-label="Закрыть наблюдение">×</button></header>
   {snapshot.ended?<p role="status">Это событие завершилось.</p>:<>
    <p className="city-world-phase">{item.kind==="TRANSPORT"?activity[item.activity]:phase[item.phase]??item.phase}</p>
    {item.kind==="TRANSPORT"&&<><p>{item.fromName}{item.toName&&<> → {item.toName}</>}</p><p className="city-world-hint">{transportPhase(item)}</p><progress aria-label="Путь рейса" max={1} value={Math.max(0,Math.min(1,item.progress))}/><dl><div><dt>На остановке</dt><dd>{item.waiting}</dd></div><div><dt>На борту</dt><dd>{item.aboard}</dd></div><div><dt>Сели / вышли</dt><dd>{item.boarded} / {item.alighted}</dd></div></dl></>}
    {item.kind==="ROAD"&&<><p>{item.closedCells?"Участок дороги закрыт":"Дорога открыта"}</p>{!!item.services.length&&<p>{item.services.join(" · ")}</p>}</>}
   </>}
   <footer>{item.kind==="TRANSPORT"&&snapshot.canFollow&&<button type="button" aria-pressed={snapshot.following} onClick={onFollow}>{snapshot.following?"Прекратить слежение":"Следить за транспортом"}</button>}{item.task&&!snapshot.ended&&<button type="button" onClick={onTask}>Открыть задачу</button>}</footer>
  </aside>}
 </>;
}
