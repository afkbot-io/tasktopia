import type { Cell } from './contracts';
import { localTransportLegMs } from "./transport-local-leg";
import { CITY_TRAIN_PARTS, CITY_TRAIN_SPACING, cityRailwayPlatformSpan, type CityRailway } from "./city-railway";
import type { CityRailConnectionDto } from "./city-scene-contract";
import { transportJourney, transportSchedule, transportStopActivity, type TransportSchedule } from "./transport-schedule";

export type CityRailServicePlan = {
  line: CityRailway; routeId: string; schedule: TransportSchedule; fleetIndex: number;
  vehicleId: string; side: 1 | -1; platform: number; length: number; partCount: number; localTravelMs:number;platformLane:0|-1;
};

/** Compile route identities and platform capacity once when the scene changes.
 * Fleet slots never compete for the identity of a single renderer object. */
export function planCityRailServices(line: CityRailway, connections: readonly CityRailConnectionDto[]): CityRailServicePlan[] {
  if (!line.running) return [];
  const length = Math.abs(line.to.x - line.from.x) + Math.abs(line.to.y - line.from.y);
  const platform = line.axis === "horizontal" ? line.platform.x - line.from.x : line.platform.y - line.from.y;
  const span = cityRailwayPlatformSpan(line);
  const partCount = Math.min(CITY_TRAIN_PARTS, Math.max(2, Math.floor((span.end - span.start - 3) / CITY_TRAIN_SPACING) + 1));
  const seen = new Set<string>();
  return connections.filter(route => route.fromStationId === line.stationId || route.toStationId === line.stationId)
    .sort((a, b) => a.id.localeCompare(b.id)).flatMap(route => {
      const schedule = transportSchedule("RAIL", route.fromStationId, route.toStationId, route.scheduleOffsetMs);
      if (seen.has(schedule.id)) return [];
      seen.add(schedule.id);
      const side=(route.exit?(line.axis==="horizontal"?route.exit.x-line.platform.x:route.exit.y-line.platform.y)>=0:line.stationId===schedule.fromId)?1:-1;
      const distance=side===1?length-platform:platform;
      const localTravelMs=route.localTravelMs??localTransportLegMs("RAIL",distance,schedule.travelMs);
      const arrivalPhase=(((line.stationId===schedule.fromId?0:108_000)-schedule.offsetMs)%72_000+72_000)%72_000;
      const platformLane:0|-1=arrivalPhase%36_000>=18_000?-1:0;
      return Array.from({ length: schedule.fleetSize }, (_, fleetIndex) => ({
        line, routeId: route.id, schedule, fleetIndex, vehicleId: `${schedule.id}:vehicle:${fleetIndex}`,
        side:side as 1 | -1, platform, length, partCount,localTravelMs,platformLane,
      }));
    });
}

export function sampleCityRailService(plan: CityRailServicePlan, time: number,carPositions?:Cell[]) {
  const { line, schedule, fleetIndex, platform, side, length, partCount } = plan;
  const state = transportJourney(schedule, line.stationId, time, fleetIndex);
  const fraction = Math.min(1, state.progress * schedule.travelMs / plan.localTravelMs), eased = fraction * fraction * (3 - 2 * fraction);
  const distance = side === 1 ? length - platform + 4 + (partCount - 1) * CITY_TRAIN_SPACING : platform + 4;
  const lead = platform + side * distance * eased;
  const travelLane=side*state.direction>0?0:-1;
  const passingOffset=(along:number)=>{
    // Complete the turnout before any native car body reaches the occupied
    // platform envelope. A centre-only switch lets an incoming head clip the
    // stopped train on the neighbouring platform.
    const margin=CITY_TRAIN_SPACING;
    const blend=Math.max(0,Math.min(1,Math.max(along-platform-margin,platform-partCount*CITY_TRAIN_SPACING-along)/8));
    return plan.platformLane+(travelLane-plan.platformLane)*blend;
  };
  const visible = state.phase !== "WAITING" && state.progress * schedule.travelMs < plan.localTravelMs;
  const cars=carPositions??[];
  cars.length=partCount;
  for(let i=0;i<partCount;i++){
    const point=cars[i]??(cars[i]={x:0,y:0}),along=lead-i*CITY_TRAIN_SPACING;
    point.x=line.axis==='horizontal'?line.from.x+along:line.from.x+.5+passingOffset(along);
    point.y=line.axis==='horizontal'?line.from.y+.5+passingOffset(along):line.from.y+along;
  }
  return { ...state, routeId: plan.routeId, progress: state.progress, routePhase: state.phase, length,
    activity: transportStopActivity(schedule, state),localDirection:state.direction,
    phase: !visible ? "waiting" as const : state.phase === "STOPPED" ? "stopped" as const : "moving" as const,
    direction: side * state.direction, visible,
    cars,
  };
}

/** Single-slot compatibility seam for legacy callers and focused geometry tests. */
export function cityRailService(line: CityRailway, connections: readonly CityRailConnectionDto[], time: number) {
  const plan = planCityRailServices(line, connections)[0];
  return plan ? sampleCityRailService(plan, time) : null;
}
