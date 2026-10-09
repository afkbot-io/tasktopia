import { transportJourney,type TransportSchedule } from "./transport-schedule";
export function airFlightState(schedule:TransportSchedule,sourceId:string,time:number,fleetIndex=0){
 const state=transportJourney(schedule,sourceId,time,fleetIndex),groundMs=11_000;
 const flightProgress=(state.progress*schedule.travelMs-groundMs)/(schedule.travelMs-2*groundMs);
 return {...state,flightProgress,visible:state.phase==="MOVING"&&flightProgress>=0&&flightProgress<=1};
}
