import { planCityAirServices,sampleCityAirService } from "../shared/city-air-service";
import type { CitySceneDto } from "../shared/city-scene-contract";
import { cityRailwayPassengerPaths } from "../shared/city-railway";
import { planCityRailServices,sampleCityRailService } from "../shared/city-rail-service";
import { planCitySeaServices,sampleCitySeaService } from "../shared/city-sea-service";
import type { TransportPassengerProvider } from "./transport-passenger-director";
export function transportPassengerProviders(scene:CitySceneDto):TransportPassengerProvider[]{
 const railway=scene.railway;
 const rail=railway?planCityRailServices(railway,scene.railConnections??[]).map(plan=>{
  const boardingCells=cityRailwayPassengerPaths(railway,plan.platformLane).boardingCells.slice(0,plan.partCount-1);
  return {vehicleId:plan.vehicleId,routeId:plan.routeId,stopId:railway.stationId,boardingCells,sample:(time:number)=>{
   const state=sampleCityRailService(plan,time);
   return {visitId:state.visitId,activity:state.activity,approaching:state.visible&&state.localDirection<0&&state.progress<.04,
    position:state.cars[0]!,doors:state.cars.slice(1).map(p=>railway.axis==="horizontal"?{x:p.x,y:p.y+(plan.platformLane===0?.5:-.5)}:{x:p.x+(plan.platformLane===0?.5:-.5),y:p.y})};
  }};
 }):[];
 const sea=planCitySeaServices(scene.ports??[],scene.seaConnections??[]).map(plan=>{
  return {vehicleId:plan.vehicleId,routeId:plan.route.id,stopId:plan.port.taskId,boardingCells:plan.boardingCells,sample:(time:number)=>sampleCitySeaService(plan,time)};
 });
 const air=planCityAirServices(scene).map(plan=>({vehicleId:plan.vehicleId,routeId:plan.schedule.id,stopId:plan.airport.taskId,boardingCells:plan.boardingCells,sample:(time:number)=>sampleCityAirService(plan,time)}));
 return [...rail,...sea,...air];
}
