import { expect,it,vi } from "vitest";
import { createCityMobility } from "../src/client/city-mobility";
import { createTransportPassengerDirector,type TransportPassengerProvider,type TransportPassengerSample } from "../src/client/transport-passenger-director";
import type { Cell } from "../src/shared/contracts";
function fixture(){
 const key=(p:Cell)=>`${p.x},${p.y}`,cells:Cell[]=[];
 for(let i=0;i<=8;i++)cells.push({x:i,y:0},{x:i,y:6},{x:0,y:Math.min(i,6)},{x:8,y:Math.min(i,6)});
 const mobility=createCityMobility({roads:new Map(),walkGraph:new Map(cells.map(p=>[key(p),p])),crosswalks:new Set(),activityCells:new Set(cells.map(key)),seed:17,carLimit:0,walkerLimit:8});
 const targets=[{x:1,y:0},{x:3,y:0},{x:5,y:0}];
 let state:TransportPassengerSample={visitId:"visit",activity:"OPENING",approaching:false,position:{x:3,y:0},doors:targets.map(p=>({x:p.x+.5,y:p.y+.5}))};
 const provider:TransportPassengerProvider={vehicleId:"fleet:1",routeId:"line",stopId:"stop",boardingCells:targets,sample:()=>state};
 const director=createTransportPassengerDirector(mobility);
 return {mobility,director,provider,setState:(patch:Partial<TransportPassengerSample>)=>{state={...state,...patch};}};
}
it("dispatches real residents, boards during a door phase and alights after the next arrival",()=>{
 const {mobility,director,provider,setState}=fixture();director.compile([provider]);
 const initial=new Set(mobility.agents.map(a=>a.id));
 setState({activity:"BOARDING"});
 for(let t=0;t<20_000;t+=100){director.advance(t);mobility.advance(100);}
 expect(director.metrics.boarded).toBeGreaterThan(0);expect(director.metrics.carried).toBeLessThanOrEqual(3);
 setState({activity:"TRAVELLING",position:{x:50,y:0}});director.advance(20_100);
 expect(director.metrics.alighted).toBe(0);
 setState({activity:"ALIGHTING",position:{x:3,y:0},visitId:"visit2"});director.advance(20_300);
 expect(director.metrics.alighted).toBeGreaterThan(0);
 for(const agent of mobility.agents)expect(initial.has(agent.id)).toBe(true);
 expect(new Set(mobility.agents.map(a=>a.id)).size).toBe(mobility.agents.length);
});
it("keeps a shared queue when another fleet slot disappears, clears it after the final slot, and tolerates a backwards clock",()=>{
 const {mobility,director,provider}=fixture(),clear=vi.spyOn(mobility,"clearVisits");
 const second={...provider,vehicleId:"fleet:2"};director.compile([provider,second]);director.advance(1000);
 director.compile([second]);expect(clear).not.toHaveBeenCalled();
 director.advance(10);expect(director.metrics.providers).toBe(1);
 director.compile([]);expect(clear).toHaveBeenCalledTimes(1);expect(director.metrics.providers).toBe(0);
 director.dispose();expect(clear).toHaveBeenCalledTimes(1);
});
