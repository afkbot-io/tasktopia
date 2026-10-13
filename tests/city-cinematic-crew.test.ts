import { expect, it } from 'vitest';
import { planCinematicCrew } from '../src/client/city-cinematic-crew';
import { createCityMobility } from '../src/client/city-mobility';
const key=(c:{x:number;y:number})=>`${c.x},${c.y}`;
const footprint=Array.from({length:12},(_,i)=>({x:4+i%4,y:4+Math.floor(i/4)}));
const walk=new Map(Array.from({length:144},(_,i)=>({x:i%12,y:Math.floor(i/12)})).filter(c=>!footprint.some(f=>key(f)===key(c))).map(c=>[key(c),c]));
it('routes six workers on separate, walkable cells around the real parcel',()=>{
 const crew=planCinematicCrew({footprint,accessPath:[{x:5,y:8}],siteBounds:undefined},walk,new Set());
 expect(crew).toHaveLength(6);
 const occupied=new Set<string>();
 for(const path of crew){ expect(path.length).toBeGreaterThanOrEqual(2);for(const [i,cell] of path.entries()){
 expect(walk.has(key(cell))).toBe(true);expect(occupied.has(key(cell))).toBe(false);occupied.add(key(cell));
 if(i)expect(Math.abs(cell.x-path[i-1]!.x)+Math.abs(cell.y-path[i-1]!.y)).toBe(1);
 }}
});
it('reserves work paths without teleporting residents, and releases them without rebuilding geography',()=>{
 const city=createCityMobility({roads:new Map(),walkGraph:walk,crosswalks:new Set(),activityCells:new Set(),seed:73,carLimit:0,walkerLimit:8});
 const before=city.agents,occupied=new Set(before.flatMap(a=>[key(a.current),key(a.next)]));
 const routes=planCinematicCrew({footprint,accessPath:[],siteBounds:undefined},walk,new Set(),occupied);
 expect(routes.length).toBeGreaterThan(1);const reserved=new Set(routes.flatMap(route=>route.map(key)));
 city.setWalkClosures(reserved);expect(city.agents).toEqual(before);const builds=city.metrics.networkBuilds;
 for(let i=0;i<100;i++){const previous=city.agents;city.advance(50);for(const actor of city.agents){expect(reserved.has(key(actor.current))).toBe(false);expect(reserved.has(key(actor.next))).toBe(false);const old=previous.find(a=>a.id===actor.id)!;expect(Math.hypot(actor.position.x-old.position.x,actor.position.y-old.position.y)).toBeLessThan(.14);}expect(city.metrics.pedestrianUnsafeTotal).toBe(0);}
 const steps=city.metrics.walkerSteps;city.setWalkClosures(new Set());city.advance(6000);expect(city.metrics.walkerSteps).toBeGreaterThan(steps);expect(city.metrics.networkBuilds).toBe(builds);
});
it('never walks through roads, water, buildings, other crews or outside the loaded graph',()=>{
 const forbidden=new Set([...walk.keys()].filter(k=>k.endsWith(',3')));
 const crew=planCinematicCrew({footprint,accessPath:[],siteBounds:undefined},walk,forbidden,new Set([...walk.keys()].filter(k=>k.startsWith('3,'))),2);
 expect(crew.length).toBeLessThanOrEqual(2);
 for(const path of crew)for(const c of path){expect(forbidden.has(key(c))).toBe(false);expect(c.x).not.toBe(3);expect(walk.has(key(c))).toBe(true);}
 expect(planCinematicCrew({footprint:[],accessPath:[],siteBounds:undefined},walk,new Set())).toEqual([]);
 expect(planCinematicCrew({footprint,accessPath:[],siteBounds:undefined},new Map(),new Set())).toEqual([]);
});
