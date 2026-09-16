import { expect,it } from "vitest";
import { railPolyline,railConvoy } from "../src/shared/rail-convoy";
import { transportSchedule,TRANSPORT_EPOCH } from "../src/shared/transport-schedule";
const schedule=transportSchedule("RAIL","a","b"),base=TRANSPORT_EPOCH-schedule.offsetMs;
it("keeps wagons on the route through bends and holds still during the full station dwell",()=>{
  const line=railPolyline([{x:0,y:0},{x:0,y:0},{x:100,y:0},{x:100,y:100}]);
  const at=(t:number)=>railConvoy(line,schedule,"a",base+t,5);
  expect(at(0).phase).toBe("STOPPED");expect(at(0).cars).toEqual(at(schedule.dwellMs-1).cars);
  for(let t=0;t<2*(schedule.travelMs+schedule.dwellMs);t+=1000){
    const value=at(t);expect(value.cars).toHaveLength(4);
    for(const p of value.cars){expect(p.y===0||p.x===100).toBe(true);expect(p.x).toBeGreaterThanOrEqual(0);expect(p.y).toBeLessThanOrEqual(100);}
  }
  const arrival=schedule.dwellMs+schedule.travelMs;
  expect(at(arrival).cars).toEqual(at(arrival+schedule.dwellMs-1).cars);
  for(const boundary of [arrival,arrival+schedule.dwellMs]){
    at(boundary).cars.forEach((car,i)=>{const previous=at(boundary-1).cars[i]!;expect(Math.hypot(car.x-previous.x,car.y-previous.y)).toBeLessThan(.001);});
  }
  expect(at(2*(schedule.travelMs+schedule.dwellMs)).visible).toBe(false);
  const start=at(schedule.dwellMs).cars[0]!,next=at(schedule.dwellMs+1).cars[0]!;
  expect(Math.hypot(next.x-start.x,next.y-start.y)).toBeLessThan(.001);
});
it("preserves the same physical consist on a reversed drawing and rejects an empty route",()=>{
  const points=[{x:0,y:0},{x:100,y:0}];
  for(const t of [0,30000,110000,140000]){
    const forward=railConvoy(railPolyline(points),schedule,"a",base+t,5);
    const reverse=railConvoy(railPolyline([...points].reverse()),schedule,"b",base+t,5);
    forward.cars.forEach((car,i)=>{expect(car.x).toBeCloseTo(reverse.cars[i]!.x);expect(car.heading).toBe(reverse.cars[i]!.heading);});
  }
  expect(railConvoy(railPolyline([]),schedule,"a",base,5).visible).toBe(false);
});
it("clips the shared voyage to a country segment without showing a remote station dwell",()=>{
  const line=railPolyline([{x:0,y:0},{x:100,y:0}]);
  const at=(fraction:number)=>railConvoy(line,schedule,"a",base+schedule.dwellMs+schedule.travelMs*fraction,5,[0,.4]);
  expect(at(.1).visible).toBe(true);
  expect(at(.5).visible).toBe(false);
  expect(at(1).visible).toBe(false);
  expect(railConvoy(line,schedule,"a",base,5,[0,.4]).phase).toBe("STOPPED");
  expect(railConvoy(line,schedule,"a",base,5,[.6,1]).visible).toBe(false);
});
