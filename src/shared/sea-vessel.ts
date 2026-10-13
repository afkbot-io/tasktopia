import { sampleTransportPolyline, type RailPolyline } from "./rail-convoy";
import { transportJourney, type TransportSchedule } from "./transport-schedule";

/** The local view shows a slice of the same voyage, never a new departure. */
export function seaVessel(line: RailPolyline, schedule: TransportSchedule, sourceId: string, time: number, range: readonly [number, number] = [0, 1],fleetIndex=0,laneOffsetCells=0) {
  const state = transportJourney(schedule, sourceId, time,fleetIndex);
  const fraction = (state.progress - range[0]) / (range[1] - range[0]);
  if (line.points.length < 2 || line.length <= 0 || range[1] <= range[0] || fraction < 0 || fraction > 1 || state.phase === "WAITING")
    return {...state, visible: false, point: null};
  const distance=fraction*line.length,point=sampleTransportPolyline(line,distance,state.direction);
  // Merge at real berths only; a viewport edge is never a docking point. The
  // authored hull plus half-cell passing lane fits the validated 3x3 water band.
  const taper=Math.min(1,range[0]===0?distance/3:1,range[1]===1?(line.length-distance)/3:1);
  const offset=Math.max(0,Math.min(.5,laneOffsetCells))*taper;
  point.x-=Math.sin(point.angle)*offset;point.y+=Math.cos(point.angle)*offset;
  return {...state, visible: true, point};
}
