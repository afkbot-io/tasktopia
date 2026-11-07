import {expect,it} from 'vitest';
import {cityTransitGrid} from './fixtures/city-transit-grid';

it('начинает текущую линию с ближайшей доступной остановки без лишнего пустого круга',()=>{
  const f=cityTransitGrid();
  for(let step=0;step<60;step++)f.city.advance(50);
  const before=f.city.agents.find(a=>a.fleet==='BUS')!,ids=f.city.agents.map(a=>a.id);
  // Автобус физически подходит к южному повороту. Начало по ID осталось
  // позади; до остановки (3,19) есть настоящий направленный поворот впереди.
  expect(before.current).toMatchObject({x:-1,y:17});
  expect(f.city.canDrive(before.next,{x:3,y:19})).toBe(true);
  let now=42_000,state=f.controller.update(now,f.view,f.options);
  expect(state.transit?.lineId).toBe(f.controller.transitLines[0]!.id);
  expect(state.transit?.stop.lane).toMatchObject({x:3,y:19});
  expect(f.city.agents.find(a=>a.id===before.id)!.position).toEqual(before.position);
  for(let step=0;step<1600&&state.transit?.phase!=='BOARD';step++){
    now+=50;f.city.advance(50);state=f.controller.update(now,f.view,f.options);
  }
  expect(state.transit).toMatchObject({vehicleId:before.id,phase:'BOARD'});
  expect(f.city.agents.map(a=>a.id)).toEqual(ids);
  expect([f.city.metrics.vehicleUnsafeTotal,f.city.metrics.pedestrianUnsafeTotal,f.city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0,0,0]);
});
