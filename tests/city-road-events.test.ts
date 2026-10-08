import { expect, it } from 'vitest';
import { planRoadEpisode, roadEpisodePose } from '../src/client/city-road-events';
import { createCityMobility } from '../src/client/city-mobility';
import type { Cell, RoadCellDto } from '../src/shared/contracts';
const key=(c:Cell)=>`${c.x},${c.y}`;
const roads=new Map<string,RoadCellDto>();
for(const axis of [0,20,40])for(let s=-1;s<=41;s++)for(const b of [-1,0,1])for(const c of [{x:s,y:axis+b},{x:axis+b,y:s}])roads.set(key(c),{...c,roadClass:'LOCAL'} as RoadCellDto);
const input={roads,walkGraph:new Map<string,Cell>(),crosswalks:new Set<string>(),activityCells:new Set<string>(),seed:73,carLimit:12,walkerLimit:0};
it('plans bounded deterministic road episodes, with no occupied lane, junction or offscreen placement',()=>{
 const city=createCityMobility(input), candidates=city.roadEventSites();
 expect(candidates.length).toBeGreaterThan(0);
 const bounds={minX:0,minY:0,maxX:40,maxY:40};
 const kinds=new Set<string>();
 for(let window=0;window<15;window++){
 const episode=planRoadEpisode('town',candidates,window*90000+1000,bounds)!;
 expect(episode).toBeTruthy();expect(planRoadEpisode('town',candidates,window*90000+1000,bounds)).toEqual(episode);
 kinds.add(episode.kind);expect(episode.end-episode.start).toBe(episode.kind==='BREAKDOWN'?30000:episode.kind==='WATER'?26000:18000);
 expect(roadEpisodePose(episode,episode.start-1)).toBeNull();expect(roadEpisodePose(episode,episode.end)).toBeNull();
 for(const c of episode.cells){expect(roads.has(key(c))).toBe(true);expect(c.x).toBeGreaterThanOrEqual(0);expect(c.y).toBeGreaterThanOrEqual(0);}
 }
 expect(kinds).toEqual(new Set(['ACCIDENT','REPAIR','FIRE','MEDICAL','PATROL','BREAKDOWN','WATER']));
 expect(planRoadEpisode('town',[],0,bounds)).toBeUndefined();
});
it('closes a real lane, reroutes or safely waits, sends two responders and reopens without overlap or teleport',()=>{
 const city=createCityMobility(input), site=city.roadEventSites()[0]!;
 const before=city.agents;city.setRoadClosures(new Set(site.cells.map(key)));
 expect(city.agents).toEqual(before);expect(city.metrics.networkBuilds).toBe(1);
 const targets=site.responseCells;
 expect(city.dispatchResponse('POLICE',targets)).toBe(true);
 expect(city.dispatchResponse('AMBULANCE',targets)).toBe(true);
 expect(city.agents.filter(a=>a.response)).toHaveLength(2);
 for(let i=0;i<240;i++){
 const previous=city.agents;city.advance(50);
 for(const car of city.agents){const old=previous.find(a=>a.id===car.id)!;expect(Math.hypot(car.position.x-old.position.x,car.position.y-old.position.y)).toBeLessThan(.14);expect(site.cells.some(c=>key(c)===key(car.current)||key(c)===key(car.next))).toBe(false);}
 expect(city.metrics.vehicleUnsafeTotal).toBe(0);
 }
 const steps=city.metrics.vehicleSteps;city.setRoadClosures(new Set());city.clearResponses();city.advance(6000);
 expect(city.metrics.vehicleSteps).toBeGreaterThan(steps);expect(city.agents.some(a=>a.response)).toBe(false);
 expect(city.metrics.vehicleUnsafeTotal).toBe(0);expect(city.metrics.networkBuilds).toBe(1);
});

it('does not place a call in a disconnected district whose curb no service can reach',()=>{
 const separated=new Map(roads);
 for(const cell of roads.values()){const moved={...cell,x:cell.x+100};separated.set(key(moved),moved);}
 const city=createCityMobility({...input,roads:separated,carLimit:1});const car=city.agents[0]!;
 const sites=city.roadEventSites();expect(sites.length).toBeGreaterThan(0);
 for(const site of sites)for(const c of site.cells)expect(c.x<60).toBe(car.current.x<60);
});

it('эвакуатор подъезжает сзади к свободной клетке до перекрытия, а не через закрытый участок', () => {
 const city=createCityMobility(input), sites=city.roadEventSites().filter(site=>site.towCell);
 expect(sites.length).toBeGreaterThan(0);
 for(const site of sites) {
  const first=site.cells[0]!,second=site.cells[1]!;
  expect(site.towCell).toEqual({x:first.x-(second.x-first.x),y:first.y-(second.y-first.y)});
 }
 let dispatched=false;
 for(const site of sites) {
  city.setRoadClosures(new Set(site.cells.map(key)));
  if(city.dispatchResponse('TOW',[site.towCell!],20000)) {dispatched=true;break;}
  city.setRoadClosures(new Set());
 }
 expect(dispatched).toBe(true);
});
