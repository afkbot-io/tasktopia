import type { CityRailway } from "./city-railway";
import { CITY_TRAIN_SPACING } from "./city-railway";
import type { CityRailConnectionDto } from "./city-scene-contract";
import { transportProgress, transportSchedule } from "./transport-schedule";

/** The city shows only the first/last quarter of the shared inter-city trip.
 * The terminal dwell is exactly the atlas dwell; the vehicle is absent while
 * travelling outside this city. A push-pull consist keeps its physical order. */
export function cityRailService(line: CityRailway, connections: readonly CityRailConnectionDto[], time: number) {
  if (!line.running) return null;
  const length = Math.abs(line.to.x-line.from.x)+Math.abs(line.to.y-line.from.y);
  const platform = line.axis === "horizontal" ? line.platform.x-line.from.x : line.platform.y-line.from.y;
  const candidates = connections.filter(route=>route.fromStationId===line.stationId || route.toStationId===line.stationId)
    .sort((a,b)=>a.id.localeCompare(b.id)).map(route=>{
      const schedule=transportSchedule("RAIL",route.fromStationId,route.toStationId);
      const state=transportProgress(schedule,line.stationId,time);
      const side=line.stationId===schedule.fromId?1:-1;
      const fraction=Math.min(1,state.progress/.25),eased=fraction*fraction*(3-2*fraction);
      const distance=side===1?length-platform+4+3*CITY_TRAIN_SPACING:platform+4;
      const lead=platform+side*distance*eased;
      const visible=state.phase!=="WAITING" && state.progress<.25;
      return {routeId:route.id,progress:state.progress,routePhase:state.phase,length,
        phase:!visible?"waiting" as const:state.phase==="STOPPED"?"stopped" as const:"moving" as const,
        direction:side*state.direction,visible,
        cars:Array.from({length:4},(_,i)=>line.axis==="horizontal"
          ? {x:line.from.x+lead-i*CITY_TRAIN_SPACING,y:line.from.y+.5}
          : {x:line.from.x+.5,y:line.from.y+lead-i*CITY_TRAIN_SPACING})};
    });
  return candidates.find(candidate=>candidate.visible) ?? candidates[0] ?? null;
}
