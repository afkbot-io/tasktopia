import { expect, it } from 'vitest';
import { airportFacilityTaskAt } from '../src/client/airport-site-view';
import type { AirportSitePlan } from '../src/shared/airport-site';

const plan: AirportSitePlan = { schemaVersion: 1, airfield: { minX: -20, minY: 10, maxX: 17, maxY: 23 },
  gate: { x: 0, y: 23 }, access: [{ x: 0, y: 24 }, { x: 0, y: 25 }],
  runway: [{ x: -17, y: 12 }, { x: 14, y: 12 }], taxiPath: [], stands: [{ x: 0, y: 20 }] };
const sites = [{ taskId: 'terminal', stage: 5, plan }], tasks = new Map([['terminal', { stage: 5 }]]);

it('selects the real terminal across its runway, apron and access, including negative coordinates', () => {
  for (const point of [{ x: -16.5, y: 12.5 }, { x: 17.99, y: 23.99 }, { x: 0.5, y: 25.5 }])
    expect(airportFacilityTaskAt(sites, tasks, point)).toBe('terminal');
  for (const point of [{ x: -20.01, y: 12 }, { x: 18, y: 12 }, { x: 1, y: 25 }, { x: 0, y: 26 }])
    expect(airportFacilityTaskAt(sites, tasks, point)).toBeUndefined();
});

it('does not leave an invisible selection after task removal, stage zero or missing geometry', () => {
  const point = { x: 0.5, y: 12.5 };
  expect(airportFacilityTaskAt(sites, new Map(), point)).toBeUndefined();
  expect(airportFacilityTaskAt(sites, new Map([['terminal', { stage: 0 }]]), point)).toBeUndefined();
  expect(airportFacilityTaskAt([{ ...sites[0]!, stage: 0 }], tasks, point)).toBeUndefined();
  expect(airportFacilityTaskAt([{ ...sites[0]!, plan: null }], tasks, point)).toBeUndefined();
  expect(airportFacilityTaskAt(sites, tasks, { x: NaN, y: 12 })).toBeUndefined();
});
