export type TransportKind = "AIR" | "RAIL" | "SEA";
export type TransportSchedule = {
  id: string; kind: TransportKind; fromId: string; toId: string;
  travelMs: number; dwellMs: number; gapMs: number; offsetMs: number;
};
export const TRANSPORT_EPOCH = Date.UTC(2026,0,1);
const settings = { AIR:{travelMs:30_000,dwellMs:20_000,gapMs:60_000}, RAIL:{travelMs:90_000,dwellMs:12_000,gapMs:60_000}, SEA:{travelMs:120_000,dwellMs:24_000,gapMs:60_000} };
/** Identity and timing never depend on projection scale, endpoint order, array
 * index, viewport or device clock. One vehicle makes a round trip. */
export function transportSchedule(kind: TransportKind, a: string, b: string): TransportSchedule {
  if (!a || !b || a===b) throw new Error("Transport needs two distinct stops");
  const [fromId,toId]=[a,b].sort() as [string,string];
  const id=`${kind.toLowerCase()}:${encodeURIComponent(fromId)}:${encodeURIComponent(toId)}`;
  let hash=2166136261;for(const char of id)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  const timing=settings[kind],cycle=2*(timing.travelMs+timing.dwellMs)+timing.gapMs;
  return {id,kind,fromId,toId,...timing,offsetMs:hash%cycle};
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
