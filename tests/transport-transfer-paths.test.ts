import {expect,it} from 'vitest';
import {createCityMobility} from '../src/client/city-mobility';
import type {Cell} from '../src/shared/contracts';

it('retains a real outdoor transfer spur, admits a visitor and lets it leave after waiting',()=>{
 const cells:Cell[]=[];
 for(let i=0;i<=6;i++)cells.push({x:i,y:0},{x:i,y:6},{x:0,y:i},{x:6,y:i});
 for(let i=1;i<=5;i++)cells.push({x:3,y:-i});
 const target={x:3,y:-5},key=(p:Cell)=>`${p.x},${p.y}`;
 const mobility=createCityMobility({roads:new Map(),walkGraph:new Map(cells.map(p=>[key(p),p])),crosswalks:new Set(),activityCells:new Set([key(target)]),transferCells:new Set([key(target)]),seed:37,carLimit:0,walkerLimit:1,spawnPriorityCells:[target]});
 expect(mobility.walkingCells.has(key(target))).toBe(true);
 const selected=mobility.dispatchVisit('transfer',[target],1,1000,false);
 expect(selected).toHaveLength(1);
 let arrived=false,left=false;
 for(let t=0;t<60000;t+=50){mobility.advance(50);const a=mobility.agents.find(a=>a.id===selected[0])!;arrived ||=!!a.visit?.arrived;if(arrived&&!a.visit&&a.current.y>=0)left=true;}
 expect(arrived).toBe(true);expect(left).toBe(true);
 expect(mobility.metrics.pedestrianUnsafeTotal).toBe(0);
});

it('sends the bounded stop population towards its door before the first scheduled departure',()=>{
 const cells:Cell[]=[];for(let i=0;i<=100;i++)cells.push({x:i,y:0},{x:i,y:10});for(let y=1;y<10;y++)cells.push({x:0,y},{x:100,y});for(let y=-8;y<0;y++)cells.push({x:50,y});
 const key=(p:Cell)=>`${p.x},${p.y}`,target={x:50,y:-8};
 const mobility=createCityMobility({roads:new Map(),walkGraph:new Map(cells.map(p=>[key(p),p])),crosswalks:new Set(),activityCells:new Set([key(target)]),transferCells:new Set([key(target)]),seed:31,walkerLimit:12,carLimit:0,spawnPriorityCells:[target]});
 expect(mobility.dispatchVisit('first-flight',[target],3,30000,false).length).toBeGreaterThan(0);
 for(let t=0;t<10000;t+=50)mobility.advance(50);
 expect(mobility.agents.some(a=>a.visit?.id==='first-flight'&&a.visit.arrived)).toBe(true);
});
