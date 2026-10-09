import type { CitySceneDto } from "./city-scene-contract";
import { railPolyline,sampleTransportPolyline,type RailPolyline } from "./rail-convoy";
import { transportJourney,transportSchedule,transportStopActivity } from "./transport-schedule";
import { transportOffmapPoint } from "./transport-offmap-point";
import { atlasFlightPolyline } from "./atlas-flight-path";
import { buildAtlasFlightGeometry } from "./atlas-scene";
import type { Cell } from "./contracts";
export const AIR_TAXI_MS=8_000,AIR_RUNWAY_MS=3_000,AIR_GROUND_LEG_MS=AIR_TAXI_MS+AIR_RUNWAY_MS;
export type AirServicePhase="GATE"|"TAXI_OUT"|"TAKEOFF"|"FLYING"|"LANDING"|"TAXI_IN"|"AWAY";
const center=(p:Cell)=>({x:p.x+.5,y:p.y+.5});
export function planCityAirServices(scene:Pick<CitySceneDto,"city"|"airports"|"airportConnections">){
 const result=[];
 for(const airport of scene.airports??[]){
  if(airport.stage!==5||!airport.plan)continue;const site=airport.plan;
  const incident=scene.airportConnections.filter(route=>route.from.taskId===airport.taskId||route.to.taskId===airport.taskId);
  const unique=[...new Map(incident.map(route=>[transportSchedule("AIR",route.from.taskId,route.to.taskId,route.scheduleOffsetMs).id,route])).values()].sort((a,b)=>a.id.localeCompare(b.id)).slice(0,site.stands.length);
  for(const [index,route] of unique.entries()){
   const stand=center(site.stands[index]!),runway=railPolyline(site.runway.map(center));
   const taxiOut=railPolyline([stand,{x:stand.x,y:site.airfield.minY+7.5},{x:runway.points[0]!.x,y:site.airfield.minY+7.5},runway.points[0]!]);
   const taxiIn=railPolyline([runway.points.at(-1)!,{x:runway.points.at(-1)!.x,y:site.airfield.minY+5.5},{x:stand.x,y:site.airfield.minY+5.5},stand]);
   const localFrom=route.from.taskId===airport.taskId,local=localFrom?route.from:route.to,remote=localFrom?route.to:route.from;
   const exit=transportOffmapPoint(runway.points.at(-1)!,local.point,remote.point,scene.city.bounds);
   const curve=(from:Cell,to:Cell)=>{const g=buildAtlasFlightGeometry(from,to,route.id,12);return atlasFlightPolyline(g.from,g.control,g.to);};
   const outbound=curve(runway.points.at(-1)!,exit),inbound=curve(exit,runway.points[0]!);
   const schedule=transportSchedule("AIR",route.from.taskId,route.to.taskId,route.scheduleOffsetMs);
   for(let fleetIndex=0;fleetIndex<schedule.fleetSize;fleetIndex++)result.push({airport,route,schedule,fleetIndex,vehicleId:`${schedule.id}:vehicle:${fleetIndex}`,stand,runway,taxiOut,taxiIn,outbound,inbound,boardingCells:[{x:Math.floor(stand.x),y:Math.floor(stand.y)+1}],localFlightMs:25_000});
  }
 }
 return result;
}
export type CityAirServicePlan=ReturnType<typeof planCityAirServices>[number];
const along=(line:RailPolyline,fraction:number)=>sampleTransportPolyline(line,Math.max(0,Math.min(1,fraction))*line.length,1);
export function sampleCityAirService(plan:CityAirServicePlan,time:number){
 const state=transportJourney(plan.schedule,plan.airport.taskId,time,plan.fleetIndex),ms=state.progress*plan.schedule.travelMs;
 let phase:AirServicePhase="AWAY",point={...plan.stand,angle:0,heading:"east" as "east"|"west"|"north"|"south"},altitude=0;
 if(state.phase==="STOPPED"&&state.progress===0)phase="GATE";
 else if(state.phase==="MOVING"&&ms<=plan.localFlightMs){
  if(state.direction>0){
   if(ms<AIR_TAXI_MS){phase="TAXI_OUT";point=along(plan.taxiOut,ms/AIR_TAXI_MS);}
   else if(ms<AIR_GROUND_LEG_MS){phase="TAKEOFF";const fraction=(ms-AIR_TAXI_MS)/AIR_RUNWAY_MS;point=along(plan.runway,fraction);altitude=2*fraction;}
   else {phase="FLYING";const fraction=(ms-AIR_GROUND_LEG_MS)/(plan.localFlightMs-AIR_GROUND_LEG_MS);point=along(plan.outbound,fraction);altitude=2+6*Math.min(1,fraction*3);}
  }else{
   if(ms>AIR_GROUND_LEG_MS){phase="FLYING";const fraction=(plan.localFlightMs-ms)/(plan.localFlightMs-AIR_GROUND_LEG_MS);point=along(plan.inbound,fraction);altitude=2+6*Math.min(1,(1-fraction)*3);}
   else if(ms>AIR_TAXI_MS){phase="LANDING";const fraction=(AIR_GROUND_LEG_MS-ms)/AIR_RUNWAY_MS;point=along(plan.runway,fraction);altitude=2*(1-fraction);}
   else {phase="TAXI_IN";point=along(plan.taxiIn,1-ms/AIR_TAXI_MS);}
  }
 }
 return {...state,phase,point,altitude,visible:phase!=="AWAY",activity:transportStopActivity(plan.schedule,state),
  approaching:state.direction<0&&ms<=plan.localFlightMs,position:point,doors:[{x:plan.stand.x,y:plan.stand.y+.75}]};
}
