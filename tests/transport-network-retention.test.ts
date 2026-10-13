import { expect,it } from "vitest";
import { retainedTransportNetwork } from "../src/shared/transport-network";
const stops=[{taskId:"a",cityId:"A",point:{x:0,y:0}},{taskId:"b",cityId:"B",point:{x:100,y:0}},{taskId:"c",cityId:"C",point:{x:4,y:0}}];
it("connects canonical nearby cities and preserves every valid old line during growth",()=>{
  const initial=retainedTransportNetwork(stops,[]);
  expect(initial).toHaveLength(2);
  expect(initial.some(edge=>[edge.fromCityId,edge.toCityId].sort().join("")==="AC")).toBe(true);
  const expanded=retainedTransportNetwork([...stops,{taskId:"d",cityId:"D",point:{x:2,y:1}}],initial);
  for(const edge of initial)expect(expanded).toContainEqual(edge);
  expect(expanded).toHaveLength(3);
  expect(retainedTransportNetwork([...stops].reverse(),[])).toEqual(initial);
});
it("recovers from removed cities and refuses cycles, duplicate edges and degree three",()=>{
  const bad=[{fromCityId:"A",toCityId:"B"},{fromCityId:"B",toCityId:"C"},{fromCityId:"C",toCityId:"A"},{fromCityId:"A",toCityId:"missing"}];
  const edges=retainedTransportNetwork(stops,bad);
  expect(edges).toHaveLength(2);
  expect(retainedTransportNetwork(stops.filter(stop=>stop.cityId!=="B"),edges)).toEqual([{fromCityId:"A",toCityId:"C"}]);
});
it("keeps 2000 cities sparse with bounded degree",()=>{
  const large=Array.from({length:2000},(_,i)=>({taskId:`task${i}`,cityId:`city${i}`,point:{x:i%50,y:Math.floor(i/50)}}));
  const edges=retainedTransportNetwork(large,[]),degree=new Map<string,number>();
  expect(edges).toHaveLength(1999);
  for(const edge of edges)for(const id of [edge.fromCityId,edge.toCityId])degree.set(id,(degree.get(id)??0)+1);
  expect(Math.max(...degree.values())).toBe(2);
});

import { railwayTimetable, railwayScheduleOffset } from "../src/shared/transport-network";
import { transportSchedule,transportJourneys,TRANSPORT_EPOCH } from "../src/shared/transport-schedule";
it("assigns non-overlapping platform windows and preserves old times after extending either end",()=>{
  const edges=railwayTimetable([{fromCityId:"A",toCityId:"B"},{fromCityId:"B",toCityId:"C"}],[]);
  const extended=railwayTimetable([...edges,{fromCityId:"C",toCityId:"D"}],edges);
  for(const edge of edges)expect(extended).toContainEqual(edge);
  const ids:Record<string,string>={A:"z",B:"b",C:"x",D:"a"};
  const schedules=extended.map(edge=>({edge,schedule:transportSchedule("RAIL",ids[edge.fromCityId]!,ids[edge.toCityId]!,railwayScheduleOffset(edge,ids[edge.fromCityId]!,ids[edge.toCityId]!))}));
  for(const city of ["B","C"])for(let t=0;t<216_000;t+=500){
    const stopped=schedules.filter(({edge})=>edge.fromCityId===city||edge.toCityId===city).flatMap(({schedule})=>transportJourneys(schedule,ids[city]!,TRANSPORT_EPOCH+t)).filter(j=>j.phase==="STOPPED"&&j.progress===0);
    expect(stopped.length).toBeLessThanOrEqual(1);
  }
});
