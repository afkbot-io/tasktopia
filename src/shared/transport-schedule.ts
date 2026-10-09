export type TransportKind = "AIR" | "RAIL" | "SEA";
export type TransportSchedule = {
  id: string; kind: TransportKind; fromId: string; toId: string;
  travelMs: number; dwellMs: number; gapMs: number; offsetMs: number;
  fleetSize: number;
};
export const TRANSPORT_EPOCH = Date.UTC(2026,0,1);
const settings = { AIR:{travelMs:75_000,dwellMs:25_000,gapMs:0,fleetSize:2}, RAIL:{travelMs:90_000,dwellMs:18_000,gapMs:0,fleetSize:3}, SEA:{travelMs:120_000,dwellMs:24_000,gapMs:0,fleetSize:2} };
/** Identity and timing never depend on projection scale, endpoint order, array
 * index, viewport or device clock. One vehicle makes a round trip. */
export function transportSchedule(kind: TransportKind, a: string, b: string, timingOffsetMs?: number): TransportSchedule {
  if (!a || !b || a===b) throw new Error("Transport needs two distinct stops");
  if(timingOffsetMs!==undefined&&!Number.isFinite(timingOffsetMs))throw new Error("Invalid transport timetable offset");
  const [fromId,toId]=[a,b].sort() as [string,string];
  const id=`${kind.toLowerCase()}:${encodeURIComponent(fromId)}:${encodeURIComponent(toId)}`;
  let hash=2166136261;for(const char of id)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  const timing=settings[kind],cycle=2*(timing.travelMs+timing.dwellMs)+timing.gapMs;
  return {id,kind,fromId,toId,...timing,offsetMs:timingOffsetMs===undefined?hash%cycle:((timingOffsetMs%cycle)+cycle)%cycle};
}
export function sampleTransportSchedule(schedule: TransportSchedule, serverTimeMs: number) {
  const {travelMs,dwellMs,gapMs}=schedule;
  const cycleMs=2*(travelMs+dwellMs)+gapMs;
  const time=Number.isFinite(serverTimeMs)?serverTimeMs:TRANSPORT_EPOCH;
  const elapsed=((time-TRANSPORT_EPOCH+schedule.offsetMs)%cycleMs+cycleMs)%cycleMs;
  if(elapsed<dwellMs)return {phase:"STOPPED" as const,progress:0,direction:1 as const,elapsed,cycleMs};
  if(elapsed<dwellMs+travelMs)return {phase:"MOVING" as const,progress:(elapsed-dwellMs)/travelMs,direction:1 as const,elapsed,cycleMs};
  if(elapsed<2*dwellMs+travelMs)return {phase:"STOPPED" as const,progress:1,direction:-1 as const,elapsed,cycleMs};
  if(elapsed<2*(dwellMs+travelMs))return {phase:"MOVING" as const,progress:1-(elapsed-2*dwellMs-travelMs)/travelMs,direction:-1 as const,elapsed,cycleMs};
  return {phase:"WAITING" as const,progress:0,direction:1 as const,elapsed,cycleMs};
}
/** Progress along an explicitly oriented drawing of the canonical route. */
export function transportProgress(schedule: TransportSchedule, sourceId: string, serverTimeMs: number) {
  const state=sampleTransportSchedule(schedule,serverTimeMs);
  return {...state,progress:sourceId===schedule.fromId?state.progress:1-state.progress,
    direction:(sourceId===schedule.fromId?state.direction:-state.direction) as 1|-1};
}

/** Fixed fleet slots are shared by every projection. A view may omit a vehicle
 * outside its aperture, but must never substitute another vehicle's identity. */
export function transportJourney(schedule: TransportSchedule, sourceId: string, serverTimeMs: number, fleetIndex = 0) {
  if(sourceId!==schedule.fromId&&sourceId!==schedule.toId)throw new Error("Unknown transport stop");
  if (!Number.isInteger(fleetIndex) || fleetIndex < 0 || fleetIndex >= schedule.fleetSize) throw new Error("Invalid transport fleet slot");
  const cycleMs = 2 * (schedule.travelMs + schedule.dwellMs) + schedule.gapMs;
  const offsetMs = schedule.offsetMs + fleetIndex * cycleMs / schedule.fleetSize;
  const time = Number.isFinite(serverTimeMs) ? serverTimeMs : TRANSPORT_EPOCH;
  const state = transportProgress({ ...schedule, offsetMs }, sourceId, time);
  const cycleIndex = Math.floor((time - TRANSPORT_EPOCH + offsetMs) / cycleMs);
  const vehicleId = `${schedule.id}:vehicle:${fleetIndex}`;
  const canonicalDirection = sourceId === schedule.fromId ? state.direction : -state.direction;
  const dwellElapsedMs = state.elapsed < schedule.dwellMs ? state.elapsed : state.elapsed - schedule.dwellMs - schedule.travelMs;
  return { ...state, fleetIndex, vehicleId, journeyId: `${vehicleId}:${cycleIndex}:${canonicalDirection}`,
    visitId: `${vehicleId}:stop:${cycleIndex}:${sourceId}`, dwellElapsedMs };
}
export type TransportJourney = ReturnType<typeof transportJourney>;
export function transportJourneys(schedule: TransportSchedule, sourceId: string, serverTimeMs: number): TransportJourney[] {
  return Array.from({ length: schedule.fleetSize }, (_, index) => transportJourney(schedule, sourceId, serverTimeMs, index));
}
export type TransportStopActivity = "OPENING" | "ALIGHTING" | "BOARDING" | "CLOSING" | "TRAVELLING" | "WAITING";
export function transportStopActivity(schedule: TransportSchedule, state: TransportJourney): TransportStopActivity {
  if (state.phase === "WAITING") return "WAITING";
  if (state.phase !== "STOPPED" || state.progress !== 0) return "TRAVELLING";
  const fraction = state.dwellElapsedMs / schedule.dwellMs;
  return fraction < .1 ? "OPENING" : fraction < .4 ? "ALIGHTING" : fraction < .9 ? "BOARDING" : "CLOSING";
}

/** Absolute departure, never a countdown restarted by opening a card. */
export function nextTransportDeparture(schedule: TransportSchedule, sourceId: string, serverTimeMs: number): number {
  if(sourceId!==schedule.fromId&&sourceId!==schedule.toId)throw new Error("Unknown transport stop");
  const time=Number.isFinite(serverTimeMs)?serverTimeMs:TRANSPORT_EPOCH;
  const cycleMs = 2 * (schedule.travelMs + schedule.dwellMs) + schedule.gapMs;
  const phase = sourceId === schedule.fromId ? schedule.dwellMs : 2 * schedule.dwellMs + schedule.travelMs;
  let next = Infinity;
  for (let index = 0; index < schedule.fleetSize; index++) {
    const offset = schedule.offsetMs + index * cycleMs / schedule.fleetSize;
    const elapsed = time - TRANSPORT_EPOCH + offset;
    const cycles = Math.ceil((elapsed - phase) / cycleMs);
    next = Math.min(next, TRANSPORT_EPOCH - offset + cycles * cycleMs + phase);
  }
  return next;
}
