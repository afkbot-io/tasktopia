import type { Cell } from "../shared/contracts";
import type { TransportStopActivity } from "../shared/transport-schedule";
import type { CityMobility } from "./city-mobility";
export type TransportPassengerSample={visitId:string;activity:TransportStopActivity;approaching:boolean;position:Cell;doors:readonly Cell[]};
export type TransportPassengerProvider={vehicleId:string;routeId:string;stopId:string;boardingCells:readonly Cell[];sample:(time:number)=>TransportPassengerSample};
type Entry={provider:TransportPassengerProvider;carrierId:string;queueId:string;geometry:string;nextQueueAt:number};
/** Local bounded representatives use the resident pool. No persistent person
 * records, catch-up playback, renderer timers or frame-by-frame WebSockets. */
export function createTransportPassengerDirector(mobility:CityMobility,passengerLimit:()=>number=()=>16){
 const entries=new Map<string,Entry>(),releasedUntil=new Map<string,number>();let nextUpdate=0,boarded=0,alighted=0;
 const flows={AIR:{boarded:0,alighted:0,queued:0},RAIL:{boarded:0,alighted:0,queued:0},SEA:{boarded:0,alighted:0,queued:0}};
 const flow=(provider:TransportPassengerProvider)=>provider.routeId.startsWith('air:')?flows.AIR:provider.routeId.startsWith('rail:')?flows.RAIL:provider.routeId.startsWith('sea:')?flows.SEA:undefined;
 const geometry=(provider:TransportPassengerProvider)=>`${provider.stopId}:${provider.boardingCells.map(p=>`${p.x},${p.y}`).join(";")}`;
 const cancel=(entry:Entry)=>{mobility.removeExternalCarrier(entry.carrierId);};
 return {
  compile(providers:readonly TransportPassengerProvider[]){
   const oldQueues=new Set([...entries.values()].map(entry=>entry.queueId));
   const alive=new Set(providers.map(provider=>provider.vehicleId));
   for(const [id,entry] of entries)if(!alive.has(id)){cancel(entry);entries.delete(id);}
   for(const provider of providers){
    const signature=geometry(provider),old=entries.get(provider.vehicleId);
    if(old&&old.geometry===signature){old.provider=provider;continue;}
    if(old)cancel(old);
    const carrierId=`transport:${provider.vehicleId}:${signature}`;
    entries.set(provider.vehicleId,{provider,geometry:signature,carrierId,queueId:`transport:queue:${provider.routeId}:${signature}`,nextQueueAt:0});
   }
   const aliveQueues=new Set([...entries.values()].map(entry=>entry.queueId));
   for(const queue of oldQueues)if(!aliveQueues.has(queue))mobility.clearVisits(queue);
  },
  advance(time:number){
   if(!Number.isFinite(time))return;
   if(time<nextUpdate&&nextUpdate-time<1000)return;
   nextUpdate=time+100;
   for(const [id,until] of releasedUntil)if(time>=until)releasedUntil.delete(id);
   const limit=Math.max(1,Math.min(16,Math.floor(passengerLimit())||1)),carriedLimit=Math.min(8,limit);
   const queueLimit=Math.min(3,Math.max(1,Math.floor(limit/Math.max(1,new Set([...entries.values()].map(entry=>entry.provider.stopId)).size))));
   let carried=mobility.agents.filter(agent=>agent.carrier?.startsWith("transport:")).length;
   for(const entry of entries.values()){
    const {provider,carrierId,queueId}=entry,state=provider.sample(time);
    const cells=provider.boardingCells.filter(cell=>mobility.walkingCells.has(`${cell.x},${cell.y}`));
    const open=state.activity==="ALIGHTING"||state.activity==="BOARDING";
    mobility.updateExternalCarrier({id:carrierId,position:state.position,doors:state.doors,boardingCells:cells,doorsOpen:open,capacity:Math.min(3,Math.max(0,carriedLimit-carried)+mobility.agents.filter(agent=>agent.carrier===carrierId).length)});
    if(!cells.length)continue;
    if(state.activity==="ALIGHTING"){
     const incoming=mobility.agents.filter(agent=>agent.carrier===carrierId).map(agent=>agent.id);
     const count=mobility.alightExternalCarrier(carrierId);alighted+=count;carried-=count;const f=flow(provider);if(f)f.alighted+=count;
     for(const id of incoming)if(!mobility.agents.some(agent=>agent.id===id&&agent.carrier===carrierId))releasedUntil.set(id,time+10_000);
    }
    const arrivingPassengers=mobility.agents.some(agent=>agent.carrier===carrierId);
    if((state.approaching||state.activity==="OPENING"||state.activity==='ALIGHTING'&&!arrivingPassengers||state.activity==="BOARDING")&&time>=entry.nextQueueAt&&carried<carriedLimit){
     entry.nextQueueAt=time+10_000;
     // One queue per line, shared by its fleet. Re-dispatch only missing seats.
     const waiting=mobility.agents.filter(agent=>agent.visit?.id===queueId&&!agent.carrier).length;
     const totalWaiting=mobility.agents.filter(agent=>agent.visit?.id.startsWith('transport:queue:')&&!agent.carrier).length;
     const targets=cells;
     if(waiting<queueLimit&&totalWaiting+carried<limit){const candidates=mobility.agents.filter(agent=>!releasedUntil.has(agent.id)).map(agent=>agent.id);const queued=mobility.dispatchVisit(queueId,targets,Math.min(queueLimit-waiting,carriedLimit-carried,limit-totalWaiting-carried),30_000,false,candidates).length;const f=flow(provider);if(f)f.queued+=queued;}
    }
    if(state.activity==="BOARDING"&&carried<carriedLimit){
     const count=mobility.boardExternalVisit(queueId,carrierId);boarded+=count;carried+=count;const f=flow(provider);if(f)f.boarded+=count;
    }
   }
  },
  dispose(){for(const queue of new Set([...entries.values()].map(entry=>entry.queueId)))mobility.clearVisits(queue);for(const entry of entries.values())cancel(entry);entries.clear();releasedUntil.clear();},
  get metrics(){const waiting=mobility.agents.filter(agent=>agent.visit?.id.startsWith('transport:queue:')&&!agent.carrier);
   return {flows:Object.fromEntries(Object.entries(flows).map(([kind,counts])=>{const queue=waiting.filter(a=>a.visit?.id.startsWith(`transport:queue:${kind.toLowerCase()}:`));return [kind,{...counts,waiting:queue.length,ready:queue.filter(a=>a.visit?.arrived).length}];})),cancelled:mobility.metrics.cancelledPassengers,providers:entries.size,boarded,alighted,carried:mobility.agents.filter(agent=>agent.carrier?.startsWith("transport:")).length,waiting:waiting.length};}
 };
}
