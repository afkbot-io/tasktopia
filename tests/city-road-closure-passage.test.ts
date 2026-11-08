import {expect,it} from 'vitest';
import {createCityMobility,type CityMobilityAgent} from '../src/client/city-mobility';
import {buildMobilityNetwork} from '../src/client/city-mobility-network';
import {cityTransitGrid} from './fixtures/city-transit-grid';
import type {Cell} from '../src/shared/contracts';

it('после открытия назначенной дороги автобус завершает ожидающий проход через перекрёсток',()=>{
  const f=cityTransitGrid(0),city=createCityMobility(f.input),network=buildMobilityNetwork(f.input);
  const key=(p:Cell)=>`${p.x},${p.y}`;
  let waiting:CityMobilityAgent|undefined;
  for(let step=0;step<1500&&!waiting;step++){
    city.advance(50);
    waiting=city.agents.find(a=>{
      if(a.fleet!=='BUS'||a.yieldReason!=='RESERVATION')return false;
      const zone=network.zoneByCell.get(key(a.next)),signal=zone&&city.signals.find(s=>s.id===zone.id);
      return !!zone&&!zone.cells.has(key(a.current))&&!!signal
        &&(a.direction==='north'||a.direction==='south'?signal.vertical:signal.horizontal)==='RED';
    });
  }
  expect(waiting,'Нужен настоящий автобус без разрешения на въезд').toBeDefined();
  const id=waiting!.id,origin={...waiting!.position};
  const actorIds=city.agents.map(a=>a.id);
  let destination:Cell|undefined;
  for(const target of f.input.roads.values()){
    if(Math.hypot(target.x+.5-origin.x,target.y+.5-origin.y)<=4||network.zoneByCell.has(key(target)))continue;
    if(city.dispatchResponse('BUS',[target],30000,id,'closure-passage')){destination=target;break;}
  }
  expect(destination,'Нужна настоящая достижимая цель за перекрёстком').toBeDefined();
  city.setRoadClosures(new Set([key(destination!)]));
  expect(city.agents.find(a=>a.id===id)!.position).toEqual(origin);
  for(let step=0;step<40;step++){
    city.advance(50);
    expect(key(city.agents.find(a=>a.id===id)!.current)).not.toBe(key(destination!));
  }
  city.setRoadClosures(new Set());
  let arrived=false;
  for(let step=0;step<1200&&!arrived;step++){
    city.advance(50);const bus=city.agents.find(a=>a.id===id)!;
    arrived=bus.activity==='REST'&&Math.hypot(bus.position.x-destination!.x-.5,bus.position.y-destination!.y-.5)<.1;
  }
  const after=city.agents.find(a=>a.id===id)!;
  expect(arrived,`Автобус ${id} не доехал до цели: ${after.yieldReason}, ожидание ${after.waitMs}мс`).toBe(true);
  expect(Math.hypot(after.position.x-origin.x,after.position.y-origin.y)).toBeGreaterThan(3);
  expect(after).toMatchObject({response:'BUS',responseOwner:'closure-passage'});
  expect(city.agents.map(a=>a.id)).toEqual(actorIds);
  expect([city.metrics.vehicleUnsafeTotal,city.metrics.pedestrianUnsafeTotal,city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0,0,0]);
});
