import { describe, expect, it } from "vitest";
import { createCityCinematics, cinematicMarkerMatches } from "../src/client/city-cinematics";
import type { WorldFeatureDto } from '../src/shared/contracts';

describe("городские кинематические переходы", () => {
  it("сохраняет прежнее здание во время работы даже если новая стадия уже загружена", () => {
    const timeline = createCityCinematics();
    expect(timeline.begin({ eventId: 1, version: 2, taskId: "home", kind: "CONSTRUCT", fromStage: 2, toStage: 3 }, 0)).toBe(true);
    timeline.ready("home", 2);
    expect(timeline.sample(1200)[0]).toMatchObject({ phase: "WORK", oldVisible: true, revealTarget: false, done: false });
    expect(timeline.sample(2850)[0]).toMatchObject({ phase: "REVEAL", oldVisible: false, revealTarget: true });
    expect(timeline.sample(3200)[0]).toMatchObject({ done: true, revealTarget: true });
    expect(timeline.size).toBe(0);
  });
  it("держит пыль при задержке ресурса, но не удерживает старое здание навсегда", () => {
    const timeline = createCityCinematics();
    timeline.begin({ eventId: 1, version: 2, taskId: "home", kind: "CONSTRUCT", fromStage: 2, toStage: 3 }, 0);
    expect(timeline.sample(2900)[0]).toMatchObject({ phase: "COVER", revealTarget: false, done: false });
    expect(timeline.sample(5200)[0]).toMatchObject({ done: true, oldVisible: false, revealTarget: false });
    expect(timeline.size).toBe(0);
  });
  it("снос скрывает исчезновение хлопком до появления руин", () => {
    const timeline = createCityCinematics();
    timeline.begin({ eventId: 1, version: 2, taskId: "home", kind: "DEMOLISH", fromStage: 5 }, 0);
    timeline.ready("home", 2);
    expect(timeline.sample(1800)[0]).toMatchObject({ phase: "COVER", oldVisible: true, revealTarget: false });
    expect(timeline.sample(2600)[0]).toMatchObject({ phase: "REVEAL", oldVisible: false, revealTarget: true });
    expect(timeline.sample(3000)[0]).toMatchObject({ done: true });
  });
  it("перенос удерживает груз до посадки и показывает новый участок после неё", () => {
    const timeline = createCityCinematics();
    timeline.begin({ eventId: 1, version: 2, taskId: "home", kind: "TRANSFER", fromStage: 5 }, 0);
    timeline.ready("home", 2);
    expect(timeline.sample(1200)[0]).toMatchObject({ phase: "LIFT", oldVisible: true, revealTarget: false });
    expect(timeline.sample(3000)[0]).toMatchObject({ phase: "CARRY", oldVisible: true, revealTarget: false });
    expect(timeline.sample(4700)[0]).toMatchObject({ phase: "LOWER", oldVisible: true, revealTarget: false });
    expect(timeline.sample(5300)[0]).toMatchObject({ phase: "DEPART", oldVisible: false, revealTarget: true });
    expect(timeline.sample(5800)[0]).toMatchObject({ done: true });
  });
  it("быстрые стадии сходятся к последней без перезапуска бригады и без раннего reveal", () => {
    const timeline = createCityCinematics();
    timeline.begin({ eventId: 1, version: 2, taskId: "home", kind: "CONSTRUCT", fromStage: 1, toStage: 2 }, 0);
    timeline.ready("home", 2);
    timeline.begin({ eventId: 2, version: 3, taskId: "home", kind: "CONSTRUCT", fromStage: 2, toStage: 5 }, 1000);
    expect(timeline.sample(2800)[0]).toMatchObject({ fromStage: 1, toStage: 5, startedAtMs: 0, revealTarget: false });
    timeline.ready("home", 3);
    expect(timeline.sample(3200)[0]).toMatchObject({ done: true, revealTarget: true });
  });
  it("удаление отменяет ожидаемую стройку и не допускает её воскрешения", () => {
    const timeline = createCityCinematics();
    timeline.begin({ eventId: 1, version: 2, taskId: "home", kind: "CONSTRUCT", fromStage: 2, toStage: 3 }, 0);
    expect(timeline.begin({ eventId: 2, version: 3, taskId: "home", kind: "DEMOLISH", fromStage: 3 }, 1000)).toBe(true);
    expect(timeline.begin({ eventId: 3, version: 4, taskId: "home", kind: "CONSTRUCT", fromStage: 3, toStage: 4 }, 1100)).toBe(false);
    expect(timeline.sample(1200)[0]).toMatchObject({ kind: "DEMOLISH", fromStage: 2, startedAtMs: 1000 });
  });
  it("дубликат и запоздавшая версия не запускают повторный эффект", () => {
    const timeline = createCityCinematics();
    const event = { eventId: 4, version: 5, taskId: "home", kind: "CONSTRUCT" as const, fromStage: 2, toStage: 3 };
    expect(timeline.begin(event, 0)).toBe(true);
    expect(timeline.begin(event, 100)).toBe(false);
    expect(timeline.begin({ ...event, eventId: 3, version: 4 }, 200)).toBe(false);
    timeline.clear();
    expect(timeline.begin(event, 300)).toBe(false);
  });
  it("историческая стадия, прогресс без смены вида и превышение лимита обходятся без спектакля", () => {
    const timeline = createCityCinematics(1);
    const event = { eventId: 4, version: 5, taskId: "home", kind: "CONSTRUCT" as const, fromStage: 2, toStage: 3 };
    expect(timeline.begin({ ...event, occurredAtMs: 0 }, 20_000)).toBe(false);
    expect(timeline.begin({ ...event, taskId: "same", toStage: 2 }, 20_000)).toBe(false);
    expect(timeline.begin({ ...event, taskId: "fresh" }, 20_000)).toBe(true);
    expect(timeline.begin({ ...event, taskId: "overflow" }, 20_000)).toBe(false);
    expect(timeline.size).toBe(1);
  });
});

it("перенос поглощает следующую стадию, ждёт ресурсы и имеет конечный предел истории", () => {
 const t=createCityCinematics(),move={eventId:1,version:1,taskId:"home",kind:"TRANSFER" as const,fromStage:5};
 t.begin(move,0);
 expect(t.sample(3000)[0]).toMatchObject({phase:"LIFT",revealTarget:false});
 t.begin({...move,eventId:2,version:2,kind:"CONSTRUCT",toStage:3},1000);
 t.ready("home",1);expect(t.sample(5100)[0]).toMatchObject({kind:"TRANSFER",toStage:3,revealTarget:false});
 t.ready("home",2);expect(t.sample(5200)[0]).toMatchObject({kind:"TRANSFER",revealTarget:true});
 for(let i=0;i<600;i++)t.begin({...move,taskId:`skipped-${i}`,occurredAtMs:0},20000);
 expect(t.historySize).toBe(512);expect(t.begin({...move,eventId:3,version:2},20000)).toBe(false);
 expect(t.sample(NaN)).toEqual([]);expect(t.sample(20000)[0]).toMatchObject({done:true});
});
it('rejects a malformed timestamp and does not expire on a nonfinite sample',()=>{
 const timeline=createCityCinematics();const request={eventId:1,version:1,taskId:'one',kind:'CONSTRUCT' as const,fromStage:1,toStage:2};
 expect(timeline.begin({...request,occurredAtMs:NaN},100)).toBe(false);
 expect(timeline.begin({...request,version:2},100)).toBe(true);
 expect(timeline.sample(Infinity)).toEqual([]);expect(timeline.size).toBe(1);
});
it('keeps historical sites visible and gates only the current parcel of the relevant marker kind',()=>{
 const task={taskNumber:7,footprint:[{x:4,y:4},{x:5,y:5}]};
 const marker={footprint:task.footprint,siteMarker:{kind:'RUINED',snapshot:{taskNumber:7}}} as WorldFeatureDto;
 expect(cinematicMarkerMatches('DEMOLISH',task,marker)).toBe(true);expect(cinematicMarkerMatches('CONSTRUCT',task,marker)).toBe(false);
 expect(cinematicMarkerMatches('TRANSFER',task,marker)).toBe(false);expect(cinematicMarkerMatches('DEMOLISH',task,{...marker,footprint:[{x:9,y:9}]})).toBe(false);
 expect(cinematicMarkerMatches('DEMOLISH',task,{...marker,siteMarker:{...marker.siteMarker!,kind:'RELOCATED'}})).toBe(false);
});
it('cancels only one flight and permits its newer demolition without forgetting deduplication',()=>{
 const t=createCityCinematics(),r={eventId:1,version:1,taskId:'one',kind:'TRANSFER' as const,fromStage:4};t.begin(r,0);t.begin({...r,taskId:'two'},0);t.cancel('one');
 expect(t.size).toBe(1);expect(t.begin(r,10)).toBe(false);expect(t.begin({...r,eventId:2,version:2,kind:'DEMOLISH'},10)).toBe(true);expect(t.sample(20).map(f=>f.kind)).toEqual(['TRANSFER','DEMOLISH']);
});
