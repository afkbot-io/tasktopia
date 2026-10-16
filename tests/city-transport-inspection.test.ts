import {expect,it} from "vitest";
import {transportInspection} from "../src/client/city-transport-inspection";
import {TRANSPORT_EPOCH,transportSchedule,transportJourney} from "../src/shared/transport-schedule";
it("labels the current oriented journey with real city names and complete trip progress, including reverse arrival",()=>{
 const schedule=transportSchedule("SEA","a","b",0),input={schedule,localStopId:"a",localName:"Лесной",remoteName:"Приморск",routeId:"real-route",fleetIndex:0,
  title:"Паром",phase:"MOVING",position:{x:1,y:2},visible:true,task:{countryId:"real-country",taskId:"a"},passengers:{waiting:2,aboard:3,boarded:1,alighted:0}};
 const outward=transportInspection({...input,time:TRANSPORT_EPOCH+schedule.dwellMs+schedule.travelMs/2});
 expect(outward).toMatchObject({fromName:"Лесной",toName:"Приморск",progress:.5,transportKind:"SEA",waiting:2,aboard:3});
 const time=TRANSPORT_EPOCH+2*schedule.dwellMs+schedule.travelMs+schedule.travelMs*.25;
 const inward=transportInspection({...input,time});
 expect(inward).toMatchObject({fromName:"Приморск",toName:"Лесной",progress:.25});
 expect(inward.journeyId).toBe(transportJourney(schedule,"a",time).journeyId);
 expect(inward.vehicleId).toBe(transportJourney(schedule,"a",time).vehicleId);
 const absent=transportInspection({...input,time,visible:false,remoteName:undefined});
 expect(absent.local).toBe(false);expect(absent.position).toBeUndefined();expect(absent.fromName).toBe("Другой город");
});
