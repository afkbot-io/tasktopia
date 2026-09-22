import { expect, it } from 'vitest';
import type { Cell, RoadCellDto } from '../src/shared/contracts';
import { planCityParking } from '../src/client/city-parking';
import { buildMobilityNetwork } from '../src/client/city-mobility-network';
import { createCityMobility } from '../src/client/city-mobility';
const key=(c:Cell)=>`${c.x},${c.y}`;
function fixture() {
  const roads=new Map<string,RoadCellDto>();
  for(const axis of [0,20])for(let p=-1;p<=21;p++)for(const band of [-1,0,1])for(const c of [{x:p,y:axis+band},{x:axis+band,y:p}])roads.set(key(c),{...c,roadClass:'LOCAL'} as RoadCellDto);
  const footprint=Array.from({length:24},(_,i)=>({x:6+i%6,y:3+Math.floor(i/6)}));
  const surfaces=[...footprint.map(c=>({...c,kind:'DRIVEWAY' as const})),...Array.from({length:12},(_,i)=>({x:4+i,y:2,kind:'SIDEWALK' as const}))];
  const task={id:'parking',visualAssetKey:'urban-parking',status:'COMPLETED' as const,stage:5,footprint};
  return {roads,task,surfaces,blocked:new Set<string>()};
}
it('создаёт замкнутый заезд только по мощению в завершённую парковку',()=>{
  const f=fixture(),plans=planCityParking([f.task],f.roads,f.surfaces,f.blocked);
  expect(plans.length).toBeGreaterThan(0);
  for(const plan of plans) {
    expect(f.roads.has(key(plan.route[0]!))).toBe(true);expect(f.roads.has(key(plan.route.at(-1)!))).toBe(true);
    expect(plan.route.slice(1,-1).every(c=>f.surfaces.some(s=>key(c)===key(s)))).toBe(true);
    expect(plan.route.every((c,i)=>!i||Math.abs(c.x-plan.route[i-1]!.x)+Math.abs(c.y-plan.route[i-1]!.y)===1)).toBe(true);
    expect(f.task.footprint.some(c=>key(c)===key(plan.bay))).toBe(true);
  }
  expect(planCityParking([{...f.task,status:'IN_PROGRESS'}],f.roads,f.surfaces,f.blocked)).toEqual([]);
  expect(planCityParking([f.task],f.roads,[],f.blocked)).toEqual([]);
  expect(planCityParking([f.task],f.roads,f.surfaces,new Set(f.task.footprint.map(key)))).toEqual([]);
});
it('общая сеть сохраняет заезд, остановку и выезд без разворота на месте',()=>{
  const f=fixture(),parking=planCityParking([f.task],f.roads,f.surfaces,f.blocked);
  const input={roads:f.roads,parking,walkGraph:new Map<string,Cell>(),activityCells:new Set<string>(),crosswalks:new Set<string>(),carLimit:4,walkerLimit:0,seed:17};
  const network=buildMobilityNetwork(input);
  expect(network.parkingBays.size).toBe(parking.length);
  const city=createCityMobility(input),parked=new Set<string>(),left=new Set<string>();
  for(let i=0;i<1800;i++) {
    city.advance(50);
    for(const actor of city.agents) {
      expect(network.cars.has(key(actor.current))).toBe(true);
      if(actor.activity==='PARKED')parked.add(actor.id);
      if(parked.has(actor.id)&&f.roads.has(key(actor.current)))left.add(actor.id);
    }
  }
  expect(parked.size).toBeGreaterThan(0);expect(left.size).toBeGreaterThan(0);
  expect(city.metrics.vehicleUnsafeTotal).toBe(0);
});
