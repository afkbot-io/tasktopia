import { expect, it, vi } from 'vitest';
import { cityTransitGrid } from './fixtures/city-transit-grid';
import { canonicalTransitStop } from '../src/shared/city-transit-stops';
import { roadBandRole } from '../src/shared/road-profile';

it('uses the stored manifest, distinguishes ready-empty, and retains an occupied line across a remote neighbourhood refresh', () => {
  const f = cityTransitGrid();
  const canonical = f.controller.transitStops.map(stop => {
    const role = roadBandRole(f.lifeInput.roads,stop.lane);
    if (role.kind!=='TRAVEL') throw new Error('Fixture must use real travel lanes');
    return canonicalTransitStop('block',stop.lane,role.dx ? role.dx>0?'E':'W' : role.dy>0?'S':'N');
  });
  f.controller.compile({ ...f.lifeInput,transitStops: [] });expect(f.controller.transitStops).toEqual([]);
  f.controller.compile({ ...f.lifeInput,transitStops: canonical,transitView: f.view });
  expect(f.controller.transitStops.length).toBe(canonical.length);
  let now = 42_000;const state = f.controller.update(now,f.view,f.options);
  const bus = state.transit!;expect(bus.role).toBe('BUS');
  // A distant viewport has no local line. The real bus already on its route
  // keeps its own stops and passengers until that route completes.
  f.controller.compile({ ...f.lifeInput,transitStops: canonical,transitView: { minX: 1000,minY: 1000,maxX: 1100,maxY: 1100 } });
  expect(f.controller.transitLines).toEqual([]);
  expect(f.controller.transit?.vehicleId).toBe(bus.vehicleId);
  for (let step=0; step<4800 && !f.controller.metrics.regularCycles; step++) {
    now+=50;f.city.advance(50);f.controller.update(now,{ minX:1000,minY:1000,maxX:1100,maxY:1100 },f.options);
    expect(f.city.metrics.vehicleUnsafeTotal+f.city.metrics.pedestrianUnsafeTotal+f.city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
  }
  expect(f.controller.metrics.regularCycles).toBeGreaterThan(0);
  expect(f.controller.metrics.boarded).toBeGreaterThan(0);expect(f.controller.metrics.alighted).toBeGreaterThan(0);
  f.controller.clear();
});

it('admits a real regular line when the city first opens halfway through a minute', () => {
  const f = cityTransitGrid(), state = f.controller.update(42_000, f.view, f.options);
  expect(state.transit).toMatchObject({ role: 'BUS', lineId: expect.any(String), phase: 'ARRIVE' });
  expect(f.city.agents.find(a => a.id === state.transit!.vehicleId)?.fleet).toBe('BUS');
  expect(f.controller.metrics.regularBuses).toBe(1);
  f.controller.update(42_001, f.view, f.options); expect(f.controller.metrics.regularBuses).toBe(1);
});

it('retries temporary road admission without waiting for a minute boundary', () => {
  const f = cityTransitGrid();
  expect(f.controller.update(42_000, f.view, { ...f.options, roadBusy: true }).transit).toBeUndefined();
  expect(f.controller.update(45_000, f.view, f.options).transit?.role).toBe('BUS');
});

it('bounds route retries while the next curb is closed instead of searching on every fixed step', () => {
  const f = cityTransitGrid(0); let now = 42_000, state = f.controller.update(now, f.view, f.options);
  for (let step = 0; step < 1600 && state.transit?.phase !== 'BOARD'; step++) {
    now += 50; f.city.advance(50); state = f.controller.update(now, f.view, f.options);
  }
  expect(state.transit?.phase).toBe('BOARD');
  const busId = state.transit!.vehicleId, destination = state.transit!.destination!.lane;
  f.city.setRoadClosures(new Set([`${destination.x},${destination.y}`]));
  const search = vi.spyOn(f.city, 'dispatchResponse');
  for (let step = 0; step < 200; step++) { now += 50; f.city.advance(50); state = f.controller.update(now, f.view, f.options); }
  expect(state.transit).toMatchObject({ vehicleId: busId, phase: 'BOARD' });
  const departures = search.mock.calls.filter(([role,,,id]) => role === 'BUS' && id === busId);
  expect(departures.length).toBeGreaterThan(0); expect(departures.length).toBeLessThanOrEqual(7);
});

it('runs physical boarding and successive stops, waits for a closed destination and safely releases passengers', () => {
  const f = cityTransitGrid(), phases = new Set<string>();
  let now = 42_000, state = f.controller.update(now, f.view, f.options), closureAt = 0, recompiled = false, reopened = false, visited = 0;
  const busId = state.transit!.vehicleId, ids = f.city.agents.map(a => a.id);
  for (let step = 0; step < 4800 && (!reopened || !f.controller.metrics.alighted || !f.controller.metrics.regularCycles); step++) {
    now += 50; f.city.advance(50); state = f.controller.update(now, f.view, f.options);
    if (state.transit) {
      phases.add(state.transit.phase); visited = Math.max(visited, state.transit.stopsVisited);
      expect(state.transit.vehicleId).toBe(busId);
      if (!closureAt && state.transit.phase === 'TRAVEL') {
        closureAt = now; const cell = state.transit.destination!.lane; f.city.setRoadClosures(new Set([`${cell.x},${cell.y}`]));
      }
      if (closureAt && !reopened) {
        expect(state.transit.phase).toBe('TRAVEL');
        if (!recompiled && now - closureAt >= 1000) {
          const line = state.transit.lineId; f.controller.compile(f.lifeInput); recompiled = true;
          expect(f.controller.transit?.lineId, 'A temporary repair must not erase the canonical line during task refresh').toBe(line);
        }
        if (now - closureAt >= 5000) { f.city.setRoadClosures(new Set()); reopened = true; }
      }
    }
    expect(f.city.metrics.vehicleUnsafeTotal + f.city.metrics.pedestrianUnsafeTotal + f.city.metrics.vehiclePedestrianUnsafeTotal).toBe(0);
  }
  expect(reopened).toBe(true); expect(visited).toBeGreaterThanOrEqual(2);
  expect(f.controller.metrics.regularCycles).toBeGreaterThan(0);
  expect(f.controller.metrics.boarded).toBeGreaterThan(0); expect(f.controller.metrics.alighted).toBeGreaterThan(0);
  expect([...phases]).toEqual(expect.arrayContaining(['ARRIVE', 'BOARD', 'TRAVEL', 'ALIGHT']));
  f.controller.update(now + 1, f.view, { ...f.options, enabled: false });
  for (let step = 0; step < 1200 && f.city.agents.some(a => a.carrier); step++) f.city.advance(50);
  expect(f.city.agents.some(a => a.carrier)).toBe(false);
  expect(f.city.agents.map(a => a.id)).toEqual(ids);
  expect(f.city.agents.find(a => a.id === busId)?.fleet).toBe('BUS');
});
