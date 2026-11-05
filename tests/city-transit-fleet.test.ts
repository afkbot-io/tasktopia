import { expect, it } from 'vitest';
import { createCityMobility } from '../src/client/city-mobility';
import type { RoadCellDto } from '../src/shared/contracts';

function input() {
  const roads = new Map<string, RoadCellDto>();
  for (const axis of [0, 20, 40]) for (let s = -1; s <= 41; s++) for (const b of [-1, 0, 1])
    for (const c of [{ x: s, y: axis + b }, { x: axis + b, y: s }]) roads.set(`${c.x},${c.y}`, { ...c, roadClass: 'LOCAL' } as RoadCellDto);
  return { roads, walkGraph: new Map(), crosswalks: new Set<string>(), activityCells: new Set<string>(),
    seed: 37, carLimit: 8, walkerLimit: 0, transitFleet: true };
}

it('keeps a bounded bus and school bus fleet through idle periods, jobs and reduced population', () => {
  const source = input(), city = createCityMobility(source);
  const fleet = city.agents.filter(a => a.fleet);
  expect(fleet.map(a => a.fleet)).toEqual(['BUS', 'SCHOOL_BUS']);
  expect(city.agents).toHaveLength(8);
  const bus = fleet[0]!;
  expect(city.dispatchResponse('BUS', [...source.roads.values()], 3000)).toBe(true);
  expect(city.agents.find(a => a.response === 'BUS')?.id).toBe(bus.id);
  city.clearResponses(['BUS']);
  expect(city.agents.find(a => a.id === bus.id)).toMatchObject({ fleet: 'BUS', response: undefined });
  city.updateNetwork({ ...source, carLimit: 3 });
  expect(city.agents.filter(a => a.fleet).map(a => a.id)).toEqual(fleet.map(a => a.id));
  for (let step = 0; step < 200; step++) city.advance(50);
  expect(city.agents.filter(a => a.fleet).map(a => a.id)).toEqual(fleet.map(a => a.id));
  expect(city.metrics.vehicleUnsafeTotal).toBe(0);
});

it('never borrows a dedicated bus for an emergency and does not consume the emergency pool', () => {
  const source = input(), city = createCityMobility(source), targets = [...source.roads.values()];
  expect(city.dispatchResponse('BUS', targets, 30000)).toBe(true);
  expect(city.dispatchResponse('SCHOOL_BUS', targets, 30000)).toBe(true);
  expect(city.dispatchResponse('POLICE', targets, 30000)).toBe(true);
  expect(city.dispatchResponse('FIRE', targets, 30000)).toBe(true);
  expect(city.agents.filter(a => a.response === 'FIRE' || a.response === 'POLICE').every(a => !a.fleet)).toBe(true);
  expect(city.agents.filter(a => a.fleet)).toHaveLength(2);
});

it('replaces a bus retired by a real road edit and retains both fleet roles when quality is reduced afterwards', () => {
  const source = input(), city = createCityMobility(source), oldBus = city.agents.find(a => a.fleet === 'BUS')!;
  const roads = new Map(source.roads); roads.delete(`${oldBus.current.x},${oldBus.current.y}`); roads.delete(`${oldBus.next.x},${oldBus.next.y}`);
  city.updateNetwork({ ...source, roads });
  expect(city.agents.find(a => a.id === oldBus.id)).toBeUndefined();
  expect(city.agents.filter(a => a.fleet).map(a => a.fleet).sort()).toEqual(['BUS', 'SCHOOL_BUS']);
  const ids = city.agents.filter(a => a.fleet).map(a => a.id).sort();
  city.updateNetwork({ ...source, roads, carLimit: 3 });
  expect(city.agents.filter(a => a.fleet).map(a => a.id).sort()).toEqual(ids);
});
