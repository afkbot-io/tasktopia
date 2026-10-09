import { expect,it } from "vitest";
import { createCityMobility } from "../src/client/city-mobility";
import type { Cell } from "../src/shared/contracts";
const key=(p:Cell)=>`${p.x},${p.y}`;
function fixture(){
 const cells:Cell[]=[];for(let i=0;i<=8;i++)cells.push({x:i,y:0},{x:i,y:6},{x:0,y:Math.min(i,6)},{x:8,y:Math.min(i,6)});const walkGraph=new Map(cells.map(p=>[key(p),p]));
 const input={roads:new Map(),walkGraph,crosswalks:new Set<string>(),activityCells:new Set(cells.map(key)),seed:17,carLimit:0,walkerLimit:8};
 const mobility=createCityMobility(input),targets=[{x:1,y:0},{x:3,y:0},{x:5,y:0}];
 mobility.dispatchVisit("queue",targets,3,30_000,false);
 for(let t=0;t<20_000&&!mobility.agents.some(a=>a.visit?.id==="queue"&&a.visit.arrived);t+=100)mobility.advance(100);
 return {mobility,input,targets};
}
it("boards only a stopped open external carrier, respects capacity and keeps person identity",()=>{
 const {mobility,input,targets}=fixture(),id="transport:train:1";
 const carrier={id,position:{x:3,y:0},doors:targets.map(p=>({x:p.x+.5,y:p.y+.5})),boardingCells:targets,doorsOpen:false,capacity:1};
 mobility.updateExternalCarrier(carrier);
 expect(mobility.boardExternalVisit("queue",id)).toBe(0);
 mobility.updateExternalCarrier({...carrier,doorsOpen:true});
 const before=new Set(mobility.agents.map(a=>a.id));
 expect(mobility.boardExternalVisit("queue",id)).toBe(1);
 expect(mobility.boardExternalVisit("queue",id)).toBe(0);
 const rider=mobility.agents.find(a=>a.carrier===id)!;expect(before.has(rider.id)).toBe(true);
 mobility.updateNetwork({...input,activityCells:new Set([...input.activityCells,"changed"])});
 expect(mobility.agents.find(a=>a.id===rider.id)?.carrier).toBe(id);
 expect(mobility.alightExternalCarrier(id)).toBe(1);
 expect(mobility.agents.find(a=>a.id===rider.id)?.carrier).toBeUndefined();
 expect(new Set(mobility.agents.map(a=>a.id)).size).toBe(mobility.agents.length);
});
it("cancellation keeps riders until a safe exit becomes available and never grows the population",()=>{
 const {mobility,targets}=fixture(),id="transport:ferry:1",carrier={id,position:{x:3,y:0},doors:targets.map(p=>({x:p.x+.5,y:p.y+.5})),boardingCells:targets,doorsOpen:true,capacity:3};
 mobility.updateExternalCarrier(carrier);expect(mobility.boardExternalVisit("queue",id)).toBeGreaterThan(0);
 const count=mobility.agents.length,riders=mobility.agents.filter(a=>a.carrier===id).map(a=>a.id);
 mobility.setWalkClosures(new Set(targets.map(key)));mobility.removeExternalCarrier(id);
 expect(mobility.agents.filter(a=>a.carrier===id)).toHaveLength(riders.length);
 mobility.setWalkClosures(new Set());mobility.advance(1000);
 for(const person of riders)expect(mobility.agents.find(a=>a.id===person)?.carrier).toBeUndefined();
 expect(mobility.agents.length).toBeLessThanOrEqual(count);
});

it("retires a cancelled invisible group when its entire terminal is removed instead of teleporting to distant paths",()=>{
 const {mobility,input,targets}=fixture(),id="transport:removed:1";
 mobility.updateExternalCarrier({id,position:{x:3,y:0},doors:targets.map(p=>({x:p.x+.5,y:p.y+.5})),boardingCells:targets,doorsOpen:true,capacity:3});
 expect(mobility.boardExternalVisit("queue",id)).toBeGreaterThan(0);
 const riders=mobility.agents.filter(a=>a.carrier===id).map(a=>a.id);
 const remote=new Map([...input.walkGraph].map(([id,p])=>[id,{x:p.x+100,y:p.y+100}]));
 mobility.updateNetwork({...input,walkGraph:new Map([...remote.values()].map(p=>[key(p),p])),activityCells:new Set()});
 mobility.removeExternalCarrier(id);mobility.advance(1000);
 expect(mobility.agents.filter(a=>riders.includes(a.id))).toEqual([]);
 expect(mobility.metrics.cancelledPassengers).toBe(riders.length);
});
it("seeds a bounded part of the existing population near ready stops without increasing its limit",()=>{
 const cells:Cell[]=[];for(let x=0;x<200;x++)for(let y=0;y<6;y++)cells.push({x,y});
 const m=createCityMobility({roads:new Map(),walkGraph:new Map(cells.map(p=>[key(p),p])),crosswalks:new Set(),activityCells:new Set(),seed:77,carLimit:0,walkerLimit:12,spawnPriorityCells:[{x:2,y:2},{x:198,y:2}]});
 expect(m.agents).toHaveLength(12);
 for(const target of [{x:2,y:2},{x:198,y:2}])expect(m.agents.some(a=>Math.hypot(a.current.x-target.x,a.current.y-target.y)<=5)).toBe(true);
 expect(m.metrics.pedestrianUnsafePairs).toBe(0);
});
