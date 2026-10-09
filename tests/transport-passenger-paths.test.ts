import {expect,it} from 'vitest';
import {planAirportSite} from '../src/shared/airport-site';
import {cityRailwayPassengerPaths,type CityRailway} from '../src/shared/city-railway';
import {portPassengerDeck} from '../src/shared/transport-passenger-paths';
import {addTransportWalkways} from '../src/client/transport-walkways';
import {transportPassengerProviders} from '../src/client/transport-passenger-providers';
import {createTransportPassengerDirector} from '../src/client/transport-passenger-director';
import {createCityMobility} from '../src/client/city-mobility';
import {TRANSPORT_EPOCH} from '../src/shared/transport-schedule';
import type {Cell} from '../src/shared/contracts';
import type {CitySceneDto} from '../src/shared/city-scene-contract';
const key=(p:Cell)=>`${p.x},${p.y}`;
function sceneFixture(){
 const bounds={minX:0,minY:20,maxX:40,maxY:60};
 const airport=planAirportSite({bounds,entrance:{x:20,y:20},occupied:[],isDry:()=>true})!;
 const railway:CityRailway={stationId:'rail-a',axis:'horizontal',from:{x:0,y:100},to:{x:400,y:100},platform:{x:200,y:100},access:[],stage:5,running:true};
 const port={taskId:'sea-a',stage:5 as const,plan:{terminal:{minX:90,minY:150,maxX:95,maxY:153},approach:[{x:96,y:151},{x:97,y:151}],pier:[{x:98,y:151},{x:99,y:151},{x:100,y:151},{x:101,y:151}],berth:{x:101,y:153},waterPath:[{x:101,y:153},{x:160,y:153}]}};
 return {schemaVersion:5,sceneRevision:'test',city:{id:'home',name:'Город',center:{x:20,y:40},bounds},lod:'DETAIL',chunkSize:64,chunks:[],completedDistrictSnapshots:[],intercityRoads:[],railway,ports:[port],airports:[{taskId:'air-a',stage:5,plan:airport,reason:null}],
  railConnections:[{id:'rail:rail-a:rail-b',fromStationId:'rail-a',toStationId:'rail-b',fromCityId:'home',toCityId:'away',scheduleOffsetMs:0}],
  airportConnections:[{id:'air:air-a:air-b',from:{taskId:'air-a',cityId:'home',point:{x:20,y:40}},to:{taskId:'air-b',cityId:'away',point:{x:500,y:20}},scheduleOffsetMs:0}],
  seaConnections:[{id:'sea:sea-a:sea-b',fromPortId:'sea-a',toPortId:'sea-b',fromCityId:'home',toCityId:'away',points:[{x:101.5,y:153.5},{x:180,y:153.5}],progressRange:[0,.2],scheduleOffsetMs:0}]} satisfies CitySceneDto;
}
for(const walkerLimit of [12,32])for(const offset of [0,2500])it(`all authored terminal loops preserve safe boarding and alighting with ${walkerLimit} residents and ${offset}ms first-frame offset`,()=>{
 const scene=sceneFixture(),walkGraph=new Map<string,Cell>(),activityCells=new Set<string>(),crosswalks=new Set<string>();
 addTransportWalkways(scene,new Map(),walkGraph,crosswalks,activityCells,new Set());
 const providers=transportPassengerProviders(scene),transferCells=new Set(providers.flatMap(p=>p.boardingCells.map(key)));
 const mobility=createCityMobility({roads:new Map(),walkGraph,activityCells,crosswalks,transferCells,carLimit:0,walkerLimit,seed:37,spawnPriorityCells:[...new Map(providers.map(p=>[p.stopId,p.boardingCells[0]!])).values()]});
 for(const cell of transferCells)expect(mobility.visitTargets.has(cell),cell).toBe(true);
 const passengerLimit=walkerLimit===12?4:16;
 const director=createTransportPassengerDirector(mobility,()=>passengerLimit);director.compile(providers);
 const initial=new Set(mobility.agents.map(a=>a.id));
 for(let t=0;t<=320000;t+=100){director.advance(TRANSPORT_EPOCH+offset+t);mobility.advance(100);if(t===18000)expect(director.metrics.flows.RAIL!.boarded,'first train').toBeGreaterThan(0);if(t%10000===0)expect(director.metrics.carried+director.metrics.waiting).toBeLessThanOrEqual(passengerLimit);}
 for(const kind of ['AIR','RAIL','SEA']){expect(director.metrics.flows[kind]!.boarded,kind).toBeGreaterThan(0);expect(director.metrics.flows[kind]!.alighted,kind).toBeGreaterThan(0);}
 expect(mobility.metrics.pedestrianUnsafeTotal).toBe(0);
 expect(new Set(mobility.agents.map(a=>a.id)).size).toBe(mobility.agents.length);
 for(const agent of mobility.agents)expect(initial.has(agent.id)).toBe(true);
});
it('widens the pier on the side opposite the berth and keeps platform passengers off both rails',()=>{
 const scene=sceneFixture(),port=scene.ports[0]!;
 for(const cell of portPassengerDeck(port.plan))expect(cell.y).toBeLessThanOrEqual(151);
 for(const lane of [0,-1] as const)for(const cell of cityRailwayPassengerPaths(scene.railway,lane).platform)expect([99,100]).not.toContain(cell.y);
});
it('finishes existing rides safely after lowering quality and admits only the smaller resident budget',()=>{
 const scene=sceneFixture(),walkGraph=new Map<string,Cell>(),activityCells=new Set<string>(),crosswalks=new Set<string>();
 addTransportWalkways(scene,new Map(),walkGraph,crosswalks,activityCells,new Set());
 const providers=transportPassengerProviders(scene),transferCells=new Set(providers.flatMap(p=>p.boardingCells.map(key)));
 const mobility=createCityMobility({roads:new Map(),walkGraph,activityCells,crosswalks,transferCells,carLimit:0,walkerLimit:32,seed:37,spawnPriorityCells:[...new Map(providers.map(p=>[p.stopId,p.boardingCells[0]!])).values()]});
 let limit=16;const director=createTransportPassengerDirector(mobility,()=>limit);director.compile(providers);
 const initial=new Set(mobility.agents.map(agent=>agent.id));
 for(let t=0;t<=400000;t+=100){
  if(t===80000)limit=4;
  director.advance(TRANSPORT_EPOCH+t);mobility.advance(100);
  if(t%10000===0)expect(director.metrics.carried+director.metrics.waiting).toBeLessThanOrEqual(t>368000?4:16);
 }
 for(const kind of ['AIR','RAIL','SEA'])expect(director.metrics.flows[kind]!.alighted,kind).toBeGreaterThan(0);
 expect(mobility.metrics.cancelledPassengers).toBe(0);expect(mobility.metrics.pedestrianUnsafeTotal).toBe(0);
 for(const agent of mobility.agents)expect(initial.has(agent.id)).toBe(true);
});
