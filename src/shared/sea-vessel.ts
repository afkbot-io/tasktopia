import { sampleTransportPolyline, type RailPolyline } from "./rail-convoy";
import { transportProgress, type TransportSchedule } from "./transport-schedule";

/** The local view shows a slice of the same voyage, never a new departure. */
export function seaVessel(line: RailPolyline, schedule: TransportSchedule, sourceId: string, time: number, range: readonly [number, number] = [0, 1]) {
  const state = transportProgress(schedule, sourceId, time);
  const fraction = (state.progress - range[0]) / (range[1] - range[0]);
  if (line.points.length < 2 || line.length <= 0 || range[1] <= range[0] || fraction < 0 || fraction > 1 || state.phase === "WAITING")
    return {...state, visible: false, point: null};
  return {...state, visible: true, point: sampleTransportPolyline(line, fraction * line.length, state.direction)};
}
