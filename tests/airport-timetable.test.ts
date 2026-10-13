import { expect,it } from "vitest";
import { airportTimetable,airportScheduleOffset } from "../src/shared/transport-network";
import { transportSchedule,transportJourneys,TRANSPORT_EPOCH } from "../src/shared/transport-schedule";
it("preserves terminal slots and separates runway and taxi occupation for four lines",()=>{
 const edges=Array.from({length:4},(_,i)=>({fromCityId:"home",toCityId:`away${i}`}));
 const initial=airportTimetable(edges.slice(0,2),[]),all=airportTimetable(edges,initial);
 for(const edge of initial)expect(all).toContainEqual(edge);
 const schedules=all.map(edge=>transportSchedule("AIR","home",edge.toCityId,airportScheduleOffset(edge,"home",edge.toCityId)));
 for(let t=0;t<200_000;t+=100){
  const moving=schedules.flatMap(schedule=>transportJourneys(schedule,"home",TRANSPORT_EPOCH+t).filter(j=>j.phase==="MOVING"&&(j.progress*schedule.travelMs<11_000)));
  // One departing OR arriving aircraft can use the common taxi/runway zone.
  expect(moving.length).toBeLessThanOrEqual(1);
 }
 expect(()=>airportTimetable([...edges,{fromCityId:"home",toCityId:"fifth"}],all)).toThrow("runway window");
 expect(airportTimetable([...edges,{fromCityId:"home",toCityId:"fifth"}],all,false)).toEqual(all);
});

import { seaTimetable,seaScheduleOffset,railwayTimetable,railwayScheduleOffset } from "../src/shared/transport-network";
import { planCityRailServices,sampleCityRailService } from "../src/shared/city-rail-service";
import type { CityRailway } from "../src/shared/city-railway";
it("uses two train platforms for four lines, with safe clearance on each platform",()=>{
 const edges=Array.from({length:4},(_,i)=>({fromCityId:"home",toCityId:`away${i}`})),timed=railwayTimetable(edges,[]);
 const line:CityRailway={stationId:"home",axis:"horizontal",from:{x:0,y:0},to:{x:500,y:0},platform:{x:250,y:0},access:[],stage:5,running:true};
 const connections=timed.map(edge=>({id:edge.toCityId,fromStationId:"home",toStationId:edge.toCityId,fromCityId:edge.fromCityId,toCityId:edge.toCityId,scheduleOffsetMs:railwayScheduleOffset(edge,"home",edge.toCityId)}));
 const plans=planCityRailServices(line,connections);
 for(let t=0;t<216_000;t+=250){const stopped=plans.map(plan=>({plan,state:sampleCityRailService(plan,TRANSPORT_EPOCH+t)})).filter(({state})=>state.phase==="stopped");
  expect(stopped.length).toBeLessThanOrEqual(2);expect(new Set(stopped.map(({plan})=>plan.platformLane)).size).toBe(stopped.length);
 }
 for(const edge of timed)expect(railwayTimetable([...edges,{fromCityId:"new",toCityId:"away0"}],timed)).toContainEqual(edge);
});
it("keeps only one ferry at the shared berth and leaves time to clear it before another arrives",()=>{
 const edges=Array.from({length:4},(_,i)=>({fromCityId:"home",toCityId:`away${i}`})),timed=seaTimetable(edges,[]);
 const schedules=timed.map(edge=>transportSchedule("SEA","home",edge.toCityId,seaScheduleOffset(edge,"home",edge.toCityId)));
 for(let t=0;t<288_000;t+=100){const near=schedules.flatMap(schedule=>transportJourneys(schedule,"home",TRANSPORT_EPOCH+t).filter(j=>j.progress*schedule.travelMs<6_000));expect(near.length).toBeLessThanOrEqual(1);}
});
it('keeps four lines physically separated through both native station turnouts',()=>{
 const edges=Array.from({length:4},(_,i)=>({fromCityId:'home',toCityId:`away${i}`})),timed=railwayTimetable(edges,[]);
 for(const axis of ['horizontal','vertical'] as const)for(const side of [-1,1]){
  const line:CityRailway={stationId:'home',axis,from:{x:0,y:0},to:axis==='horizontal'?{x:500,y:0}:{x:0,y:500},platform:axis==='horizontal'?{x:250,y:0}:{x:0,y:250},access:[],stage:5,running:true};
  const connections=timed.map(edge=>({id:edge.toCityId,fromStationId:'home',toStationId:edge.toCityId,fromCityId:edge.fromCityId,toCityId:edge.toCityId,scheduleOffsetMs:railwayScheduleOffset(edge,'home',edge.toCityId),exit:side>0?line.to:line.from}));
  const plans=planCityRailServices(line,connections);
  for(let t=0;t<216000;t+=250){
   const bodies=plans.flatMap(plan=>{const state=sampleCityRailService(plan,TRANSPORT_EPOCH+t);return state.visible?state.cars.map(point=>({id:plan.vehicleId,along:Math.round((axis==='horizontal'?point.x:point.y)*8)/8,cross:Math.round((axis==='horizontal'?point.y:point.x)*8)/8})).filter(body=>body.along>=1.5&&body.along<=498.5):[];});
   for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i]!,b=bodies[j]!;if(a.id===b.id)continue;
    expect(Math.abs(a.along-b.along)>=3-1e-8||Math.abs(a.cross-b.cross)>=1-1e-8,`${axis}/${side}/${t}: ${a.id} vs ${b.id}`).toBe(true);
   }
  }
 }
});
