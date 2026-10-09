import type { CityPortDto,SeaConnectionDto } from "./city-scene-contract";
import { railPolyline } from "./rail-convoy";
import { seaVessel } from "./sea-vessel";
import { transportJourney,transportSchedule,transportStopActivity } from "./transport-schedule";

export function planCitySeaServices(ports:readonly CityPortDto[],routes:readonly SeaConnectionDto[]){
 const seen=new Set<string>();
 return [...routes].sort((a,b)=>a.id.localeCompare(b.id)).flatMap(route=>{
  const port=ports.find(p=>p.stage===5&&(p.taskId===route.fromPortId||p.taskId===route.toPortId));
  if(!port||route.points.length<2)return [];
  const schedule=transportSchedule("SEA",route.fromPortId,route.toPortId,route.scheduleOffsetMs);
  if(seen.has(schedule.id))return [];seen.add(schedule.id);
  const path=railPolyline(route.points),boardingCells=port.plan.pier.slice(-3);
  return Array.from({length:schedule.fleetSize},(_,fleetIndex)=>({route,port,path,schedule,fleetIndex,vehicleId:`${schedule.id}:vehicle:${fleetIndex}`,boardingCells}));
 });
}
export type CitySeaServicePlan=ReturnType<typeof planCitySeaServices>[number];
export function sampleCitySeaService(plan:CitySeaServicePlan,time:number){
 const vessel=seaVessel(plan.path,plan.schedule,plan.route.fromPortId,time,plan.route.progressRange,plan.fleetIndex,.5);
 const stop=transportJourney(plan.schedule,plan.port.taskId,time,plan.fleetIndex);
 const localFraction=(vessel.progress-plan.route.progressRange[0])/(plan.route.progressRange[1]-plan.route.progressRange[0]);
 const distanceToBerth=(plan.port.taskId===plan.route.fromPortId?localFraction:1-localFraction)*plan.path.length;
 return {...vessel,activity:transportStopActivity(plan.schedule,stop),visitId:stop.visitId,
  approaching:stop.direction<0&&vessel.visible&&distanceToBerth<16,
  position:vessel.point??{x:plan.port.plan.berth.x+.5,y:plan.port.plan.berth.y+.5},
  doors:plan.boardingCells.map(p=>({x:p.x+.5,y:p.y+.5}))};
}
