import { expect,it } from "vitest";
import { cityRailService, planCityRailServices, sampleCityRailService } from "../src/shared/city-rail-service";
import { cityRailwayPlatformSpan } from "../src/shared/city-railway";
import { transportSchedule,TRANSPORT_EPOCH } from "../src/shared/transport-schedule";
import type { CityRailway } from "../src/shared/city-railway";
import type { Cell } from '../src/shared/contracts';
const schedule=transportSchedule("RAIL","a","b"),base=TRANSPORT_EPOCH-schedule.offsetMs;
const connection={id:schedule.id,fromStationId:"a",toStationId:"b",fromCityId:"A",toCityId:"B"};
const line:CityRailway={stationId:"a",axis:"horizontal",from:{x:0,y:0},to:{x:500,y:0},platform:{x:250,y:1},access:[],stage:5,running:true};
it('reuses native renderer car positions without changing the sampled journey',()=>{
 const plan=planCityRailServices(line,[connection])[0]!,positions:Cell[]=[];
 const first=sampleCityRailService(plan,base,positions),head=first.cars[0];
 expect(first.cars).toBe(positions);
 const next=sampleCityRailService(plan,base+schedule.dwellMs+1000,positions);
 expect(next.cars).toBe(positions);expect(next.cars[0]).toBe(head);
 expect(next).toEqual(sampleCityRailService(plan,base+schedule.dwellMs+1000));
});
it("requires two ready endpoints and shows the whole shared station dwell without a remount reset",()=>{
  expect(cityRailService(line,[],base)).toBeNull();
  expect(cityRailService({...line,running:false},[connection],base)).toBeNull();
  expect(cityRailService({...line,stationId:"unknown"},[connection],base)).toBeNull();
  const first=cityRailService(line,[connection],base)!;
  expect(first.phase).toBe("stopped");expect(first.cars).toHaveLength(6);
  expect(cityRailService({...line},[connection],base+schedule.dwellMs-1)!.cars).toEqual(first.cars);
  expect(cityRailService(line,[connection],base+schedule.dwellMs+schedule.travelMs/2)!.visible).toBe(false);
  expect(cityRailService(line,[connection],base+2*(schedule.dwellMs+schedule.travelMs))!.phase).toBe("stopped");
});

it("owns three fleet slots per route and fits all five wagons beside the platform",()=>{
  const plans=planCityRailServices(line,[connection]);
  expect(plans).toHaveLength(3);
  const span=cityRailwayPlatformSpan(line);
  for(const time of [0,72_000,144_000]) {
    const views=plans.map(plan=>sampleCityRailService(plan,base+time));
    const stopped=views.filter(view=>view.phase==="stopped");
    expect(stopped).toHaveLength(1);
    for(const point of stopped[0]!.cars) {expect(point.x).toBeGreaterThan(span.start);expect(point.x).toBeLessThan(span.end);}
    expect(new Set(views.map(view=>view.vehicleId)).size).toBe(3);
  }
  expect(planCityRailServices({...line,running:false},[connection])).toEqual([]);
});
it("arrives at the other station at the same atlas epoch, pauses and reverses without moving wagons",()=>{
  const other={...line,stationId:"b"},arrival=schedule.dwellMs+schedule.travelMs;
  expect(cityRailService(other,[connection],base)!.visible).toBe(false);
  const at=(time:number)=>cityRailService(other,[connection],base+time)!;
  expect(at(arrival).phase).toBe("stopped");expect(at(arrival).progress).toBe(0);
  expect(at(arrival).cars).toEqual(at(arrival+schedule.dwellMs-1).cars);
  for(const boundary of [arrival,arrival+schedule.dwellMs])at(boundary).cars.forEach((car,i)=>expect(Math.abs(car.x-at(boundary-1).cars[i]!.x)).toBeLessThan(.001));
  for(const time of [arrival-5000,arrival+5000,arrival+schedule.dwellMs+5000]){
    const value=at(time);expect(value.visible).toBe(true);
    expect(value.cars[0]!.x-value.cars[1]!.x).toBe(3.125);
  }
});

it("uses the same spacing and smooth stop for a vertical corridor",()=>{
  const vertical:CityRailway={...line,axis:"vertical",from:{x:4,y:0},to:{x:4,y:500},platform:{x:4,y:250}};
  const at=(t:number)=>cityRailService(vertical,[connection],base+t)!;
  const depart=schedule.dwellMs;
  expect(at(depart+10).cars[0]!.y-at(depart).cars[0]!.y).toBeGreaterThanOrEqual(0);
  expect(at(depart+10).cars[0]!.y-at(depart).cars[0]!.y).toBeLessThan(.001);
  for(const t of [0,depart-1,depart+1000,2*depart+2*schedule.travelMs-1]){
    const cars=at(t).cars;
    for(const car of cars){expect(car.x).toBeGreaterThanOrEqual(3.5);expect(car.x).toBeLessThanOrEqual(4.5);}
    for(let i=1;i<cars.length;i++)expect(cars[i-1]!.y-cars[i]!.y).toBeCloseTo(3.125);
  }
});
