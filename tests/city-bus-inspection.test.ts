import { expect, it } from 'vitest';
import { cityBusInspection } from '../src/client/city-bus-inspection';
import { cityTransitGrid } from './fixtures/city-transit-grid';

it('inspects the actual bus, its current line and physical passengers without inventing a task', () => {
  const f = cityTransitGrid(), run = f.controller.update(42_000, f.view, f.options).transit!;
  const bus = f.city.agents.find(a => a.id === run.vehicleId)!;
  const item = cityBusInspection('Город', bus, run, f.controller.transitLines, f.city.agents, true);
  expect(item).toMatchObject({ kind: 'TRANSPORT', transportKind: 'BUS', title: 'Автобус', vehicleId: bus.id,
    journeyId: run.id, routeId: run.lineId, position: bus.position, activity: 'TRAVELLING', aboard: 0, task: undefined });
  expect(cityBusInspection('Город', bus, undefined, f.controller.transitLines, f.city.agents, false)).toMatchObject({ phase: 'WAITING', local: false, position: undefined });
});
