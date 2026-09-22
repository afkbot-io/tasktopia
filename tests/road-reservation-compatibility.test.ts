import {expect,it} from 'vitest';
import {cityRailwayReservations} from '../src/server/world/city-railway-store';
import {planIntercityRoads} from '../src/server/world/intercity-road-planner';
import {encodeOrthogonalRoadPath} from '../src/shared/semantic-road';
import type {CityRailway} from '../src/shared/city-railway';
const line:CityRailway={stationId:'station',axis:'vertical',from:{x:160,y:80},to:{x:160,y:160},platform:{x:160,y:123},access:[{x:141,y:123}],stage:5,running:true};
const previous={countryId:'country',seed:1,routes:[{id:'road',fromCityId:'a',toCityId:'b',fromNodeId:'a',toNodeId:'b',widthCells:3 as const,geometry:encodeOrthogonalRoadPath(Array.from({length:17},(_,i)=>({x:128+i,y:120})))}]};
const input={countryId:'country',seed:1,isBuildable:()=>true,validateOnly:true,cities:[{id:'a',nodes:[{id:'a',x:128,y:120}],blocks:[]},{id:'b',nodes:[{id:'b',x:144,y:120}],blocks:[]}],previous};
it('keeps a retained road beside a pedestrian station approach without moving geometry',()=>{
 const plan=planIntercityRoads({...input,protectedSites:cityRailwayReservations(line,'ROAD')});
 expect(plan.routes).toEqual(previous.routes);
 expect(cityRailwayReservations(line)).toHaveLength(2);
});
it('still rejects a road crossing the railway track itself',()=>{
 expect(()=>planIntercityRoads({...input,protectedSites:cityRailwayReservations({...line,from:{x:136,y:80},to:{x:136,y:160}},'ROAD')})).toThrow('obstructed');
});
