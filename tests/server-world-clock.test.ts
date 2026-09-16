import { expect,it } from "vitest";
import { ServerWorldClock } from "../src/client/server-world-clock";
import type { CityRailway } from "../src/shared/city-railway";
import { cityRailService } from "../src/shared/city-rail-service";
import { transportSchedule } from "../src/shared/transport-schedule";
const epoch = Date.UTC(2026,8,15);
it("anchors the server epoch, ignores invalid or stale network samples and advances through suspension",()=>{
  const clock = new ServerWorldClock();
  expect(clock.now(10)).toBeNull();
  expect(clock.synchronize(epoch,100,200)).toBe(true);
  expect(clock.now(200)).toBe(epoch+50);
  expect(clock.now(300_200)).toBe(epoch+300_050);
  expect(clock.synchronize(epoch,0,9000)).toBe(false);
  expect(clock.synchronize(NaN,0,10)).toBe(false);
  expect(clock.now(300_300)).toBe(epoch+300_150);
});
it("corrects network jitter without reversing time or depending on the device wall clock",()=>{
  const clock = new ServerWorldClock(); clock.synchronize(epoch,0,0);
  clock.synchronize(epoch-500,100,100);
  const before = clock.now(100)!;
  const after = clock.now(1100)!;
  expect(after-before).toBeGreaterThanOrEqual(900);
  expect(after-before).toBeLessThanOrEqual(1100);
  clock.synchronize(epoch+10_000,1200,1200);
  expect(clock.now(2200)!-after).toBeLessThanOrEqual(1210);
});
it("keeps train phase across remounts and independently initialized tabs",()=>{
  const line: CityRailway={stationId:"station",axis:"horizontal",from:{x:0,y:0},to:{x:500,y:0},platform:{x:250,y:0},access:[],stage:5,running:true};
  const connection = {id:transportSchedule("RAIL","station","other").id,fromStationId:"station",toStationId:"other",fromCityId:"a",toCityId:"b"};
  const sample=(clock:ServerWorldClock, time:number)=>cityRailService(line,[connection],clock.now(time)!);
  const a=new ServerWorldClock(), b=new ServerWorldClock();
  a.synchronize(epoch,0,100); b.synchronize(epoch,9000,9100);
  expect(sample(a,1100))
    .toEqual(sample(b,10100));
  const resumed = new ServerWorldClock(); resumed.synchronize(epoch+300_000,0,100);
  expect(sample(a,300_100))
    .toEqual(sample(resumed,100));
});
