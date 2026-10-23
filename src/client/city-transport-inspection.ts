import type {Cell} from "../shared/contracts";
import {transportJourney,transportStopActivity,type TransportSchedule} from "../shared/transport-schedule";
import type {InspectionTask,TransportInspection} from "./city-world-inspection";
type TransportInspectionInput={schedule:TransportSchedule;localStopId:string;localName:string;remoteName?:string;routeId:string;fleetIndex:number;
 title:string;phase:string;position:Cell;visible:boolean;task:InspectionTask;time:number;passengers?:{waiting:number;aboard:number;boarded:number;alighted:number}};
export function transportInspection(input:TransportInspectionInput):TransportInspection {
 const journey=transportJourney(input.schedule,input.localStopId,input.time,input.fleetIndex);
 const local=input.localName,remote=input.remoteName||"Другой город";
 return {kind:"TRANSPORT",title:input.title,transportKind:input.schedule.kind,routeId:input.routeId,vehicleId:journey.vehicleId,journeyId:journey.journeyId,
  phase:input.phase,activity:transportStopActivity(input.schedule,journey),fromName:journey.direction>0?local:remote,
  toName:journey.direction>0?remote:local,progress:journey.direction>0?journey.progress:1-journey.progress,
  local:input.visible,position:input.visible?input.position:undefined,task:input.task,
  waiting:input.passengers?.waiting??0,aboard:input.passengers?.aboard??0,boarded:input.passengers?.boarded??0,alighted:input.passengers?.alighted??0};
}
