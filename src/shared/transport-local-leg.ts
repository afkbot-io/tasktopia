import type { TransportKind } from "./transport-schedule";
/** Native local speed owns the aperture time. A long dock or rail approach gets
 * more travel time than a short one; it is never a fixed fraction of a voyage. */
export function localTransportLegMs(kind:TransportKind,distanceCells:number,travelMs:number):number{
 if(!Number.isFinite(distanceCells)||distanceCells<=0||!Number.isFinite(travelMs)||travelMs<=0)return 0;
 const speed=kind==="RAIL"?16:kind==="SEA"?2:4;
 return Math.min(travelMs/3,distanceCells/speed*1000);
}
