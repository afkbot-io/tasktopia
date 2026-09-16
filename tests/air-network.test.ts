import { expect,it } from "vitest";
import { countryAirNetwork } from "../src/shared/air-network";
it("uses the same primary airport pairs regardless of order or secondary airports",()=>{
  const stops=[{taskId:"a2",cityId:"a"},{taskId:"a1",cityId:"a"},{taskId:"c1",cityId:"c"},{taskId:"b1",cityId:"b"}];
  const routes=countryAirNetwork(stops);
  expect(routes.map(r=>[r.from.taskId,r.to.taskId])).toEqual([["a1","b1"],["b1","c1"]]);
  expect(countryAirNetwork([...stops].reverse())).toEqual(routes);
  expect(countryAirNetwork([...stops,{taskId:"b2",cityId:"b"}])).toEqual(routes);
  expect(countryAirNetwork(stops.filter(s=>s.cityId!=="b")).map(r=>[r.from.taskId,r.to.taskId])).toEqual([["a1","c1"]]);
  expect(countryAirNetwork(stops.filter(s=>s.cityId==="a"))).toEqual([]);
});
it("bounds the network linearly and each city to two neighbours at scale",()=>{
  const stops=Array.from({length:2000},(_,i)=>({taskId:`airport-${i}`,cityId:`city-${i}`}));
  const routes=countryAirNetwork(stops), degree=new Map<string,number>();
  for(const {from,to} of routes)for(const stop of [from,to])degree.set(stop.cityId,(degree.get(stop.cityId)??0)+1);
  expect(routes).toHaveLength(1999);expect(degree.size).toBe(2000);
  expect(Math.max(...degree.values())).toBe(2);
});
