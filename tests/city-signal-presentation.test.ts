import { expect, it } from "vitest";
import { createCitySignalPresentation } from "../src/client/city-signal-presentation";
import type { CityMobilitySignal } from "../src/client/city-mobility";

const signal = (id:string,x:number,y:number):CityMobilitySignal => ({id,bounds:{minX:x,minY:y,maxX:x,maxY:y},
  signalPosts:[{origin:{x,y},axis:"H",approach:"N"}],horizontal:"RED",vertical:"GREEN",pedestrians:"RED"});
const artwork={width:1,height:2};

it("keeps canonical physics whole while residency contains only current and still-presented streets",()=>{
  const signals=Array.from({length:1000},(_,i)=>signal(`junction-${i}`,i*10,0));
  const origins=new Map(signals.map(s=>[`${s.id}:N`,s.signalPosts[0]!.origin]));
  const plan=createCitySignalPresentation(signals,origins,new Map(),artwork);
  const bounds={minX:0,minY:0,maxX:20,maxY:20},old={minX:100,minY:0,maxX:110,maxY:20};
  const resident=plan.resident(bounds,old);
  expect(resident.map(p=>p.id)).toEqual(["junction-0:N","junction-1:N","junction-2:N","junction-10:N","junction-11:N"]);
  expect(plan.resident(bounds,old)).toBe(resident);
  expect(plan.resident(bounds,bounds).map(p=>p.id)).toEqual(["junction-0:N","junction-1:N","junction-2:N"]);
  expect(signals).toHaveLength(1000);expect(plan.total).toBe(1000);
});

it("uses actual sprite overhang at all four resident edges without moving its physical support",()=>{
  const signals=[signal("below",1,3),signal("top",1,-.5),signal("left",-.6,1),signal("right",2.2,1),signal("far",10,10)];
  const origins=new Map(signals.map(s=>[`${s.id}:N`,s.signalPosts[0]!.origin]));
  const plan=createCitySignalPresentation(signals,origins,new Map(),artwork);
  expect(plan.resident({minX:0,minY:0,maxX:2,maxY:2}).map(p=>p.id)).toEqual(["below:N","top:N","left:N","right:N"]);
  expect(plan.resident()[0]).toMatchObject({x:1.2,y:3.8,signalIndex:0,axis:"H"});
});

it("compiles immutable origins and road-side offsets once, and reads changing states through canonical indices",()=>{
  let originReads=0,roadReads=0;
  class Origins extends Map<string,{x:number;y:number}>{override get(id:string){originReads++;return super.get(id);}}
  class Roads extends Map<string,{x:number;y:number}>{override has(id:string){roadReads++;return super.has(id);}}
  const signals=[signal("a",0,0),signal("unsafe",4,0)],origins=new Origins([["a:N",{x:0,y:0}]]);
  const roads=new Roads([["1,0",{x:1,y:0}]]),plan=createCitySignalPresentation(signals,origins,roads,artwork);
  const initial=[originReads,roadReads],bounds={minX:0,minY:0,maxX:10,maxY:10};
  const resident=plan.resident(bounds);
  for(let i=0;i<100;i++)expect(plan.resident(bounds)).toBe(resident);
  expect([originReads,roadReads]).toEqual(initial);
  expect(resident).toEqual([expect.objectContaining({id:"a:N",x:.8,y:.8,signalIndex:0,axis:"H"})]);
  const next=signals.map(s=>({...s,horizontal:"GREEN" as const}));
  expect(next[resident[0]!.signalIndex]![resident[0]!.axis==="H"?"horizontal":"vertical"]).toBe("GREEN");
});
