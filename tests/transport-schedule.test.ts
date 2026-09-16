import { expect,it } from "vitest";
import { transportSchedule,sampleTransportSchedule,transportProgress,TRANSPORT_EPOCH } from "../src/shared/transport-schedule";
it.each(["AIR","RAIL","SEA"] as const)("shares a round trip across projections and preserves stop intervals (%s)",kind=>{
  const route=transportSchedule(kind,"a","b"),base=TRANSPORT_EPOCH-route.offsetMs;
  expect(transportSchedule(kind,"b","a")).toEqual(route);
  expect(sampleTransportSchedule(route,base)).toMatchObject({phase:"STOPPED",progress:0});
  const midpoint=base+route.dwellMs+route.travelMs/2;
  expect(sampleTransportSchedule(route,midpoint)).toMatchObject({phase:"MOVING",progress:.5,direction:1});
  expect(transportProgress(route,"b",midpoint).direction).toBe(-1);
  expect(sampleTransportSchedule(route,base+route.dwellMs+route.travelMs)).toMatchObject({phase:"STOPPED",progress:1});
  expect(sampleTransportSchedule(route,base+2*route.dwellMs+1.5*route.travelMs)).toMatchObject({phase:"MOVING",progress:.5,direction:-1});
  expect(sampleTransportSchedule(route,base+2*(route.dwellMs+route.travelMs))).toMatchObject({phase:"WAITING",progress:0});
  const state=sampleTransportSchedule(route,midpoint);
  expect(sampleTransportSchedule(route,midpoint+state.cycleMs*100)).toEqual(state);
});
it("uses unambiguous stop identity and requires a real pair",()=>{
  expect(transportSchedule("AIR","a:b","c").id).not.toBe(transportSchedule("AIR","a","b:c").id);
  expect(()=>transportSchedule("AIR","a","a")).toThrow();
});
