import { expect, it } from 'vitest';
import { createEverydayController } from '../src/client/city-everyday-controller';
import type { Cell, RoadCellDto } from '../src/shared/contracts';

it('keeps prepared stops and their physical reservations when life is off or mobility is not ready', () => {
  const roads = new Map<string, RoadCellDto>(), walk = new Map<string, Cell>(), ground = new Map<string, Cell>();
  for (let x = 0; x < 50; x++) for (let y = -4; y <= 4; y++) {
    const cell = { x, y }, key = `${x},${y}`;
    if (Math.abs(y) <= 1) roads.set(key, { ...cell, roadClass: 'LOCAL' } as RoadCellDto);
    else { ground.set(key, cell); if (Math.abs(y) === 2) walk.set(key, cell); }
  }
  const controller = createEverydayController('city', () => undefined, () => undefined);
  controller.compile({ tasks: [], roads, walk, ground, blocked: new Set(), decorations: [] });
  const stops = controller.transitStops; expect(stops.length).toBeGreaterThanOrEqual(2);
  const view = { minX: -10, minY: -10, maxX: 70, maxY: 70 };
  for (const enabled of [false, true, false]) {
    const state = controller.update(1000, view, { enabled, economy: true, busy: new Set(), roadBusy: false });
    expect(state.stops).toBe(stops); expect(state.pose).toBeUndefined(); expect(state.transit).toBeUndefined();
    for (const stop of stops) for (const cell of stop.shelter) expect(controller.reservedCells().has(`${cell.x},${cell.y}`)).toBe(true);
  }
  controller.clear();
  expect(controller.transitStops).toBe(stops);
  for (const stop of stops) for (const cell of stop.shelter) expect(controller.reservedCells().has(`${cell.x},${cell.y}`)).toBe(true);
  controller.compile({ tasks: [], roads: new Map(), walk: new Map(), blocked: new Set(), decorations: [] });
  expect(controller.transitStops).toHaveLength(0); expect(controller.reservedCells().size).toBe(0);
});
