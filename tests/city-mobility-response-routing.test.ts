import { afterEach, expect, it, vi } from 'vitest';
import { createCityMobility, type CityResponseRole } from '../src/client/city-mobility';
import { buildMobilityNetwork } from '../src/client/city-mobility-network';
import * as routing from '../src/client/mobility-route-search';
import type { Cell, RoadCellDto } from '../src/shared/contracts';
import realCity from './fixtures/city-mobility-real-city.json';

const key = (cell: Cell) => `${cell.x},${cell.y}`;
function consume<T>(steps: Generator<void, T, void>): { result: T; work: number } {
  let work = 0, next = steps.next();
  while (!next.done) { work++; next = steps.next(); }
  return { result: next.value, work };
}

afterEach(() => vi.restoreAllMocks());

it.each<CityResponseRole>(['BUS', 'SCHOOL_BUS', 'FIRE'])('останавливает поиск %s у единственного близкого назначения', role => {
  const original = routing.createMobilityRouteSearchSteps;
  const calls: Array<{ result: routing.MobilityRouteResult; work: number }> = [];
  // Count actual cooperative BFS work; topology, routes and physics stay real.
  vi.spyOn(routing, 'createMobilityRouteSearchSteps').mockImplementation(function* (graph, edges) {
    const real = yield* original(graph, edges);
    const measured: routing.MobilityRouteSearch = (...args) => {
      const call = consume(real.steps(...args)); calls.push(call); return call.result;
    };
    measured.steps = real.steps; measured.setBlocked = real.setBlocked;
    return measured;
  });
  const input = { roads: new Map(realCity.roads.map(cell => [key(cell), cell as RoadCellDto])),
    walkGraph: new Map(realCity.walkGraph.map(cell => [key(cell), cell])), crosswalks: new Set(realCity.crosswalks),
    activityCells: new Set(realCity.activityCells), seed: realCity.seed, carLimit: 1, walkerLimit: 0 };
  const network = buildMobilityNetwork(input), city = createCityMobility(input), before = city.agents[0]!;
  const oracle = routing.createMobilityRouteSearch(network.cars, network.carEdges);
  const limit = role === 'BUS' || role === 'SCHOOL_BUS' ? 64 : 28;
  const full = consume(oracle.steps(before.next, before.current, undefined, limit));
  const target = full.result.cells.find(cell => !network.zoneByCell.has(key(cell))
    && full.result.routeTo(cell).length >= 2 && full.result.routeTo(cell).length <= 4)!;
  expect(target).toBeDefined();
  const expected = full.result.routeTo(target);
  calls.length = 0;
  expect(city.dispatchResponse(role, [target], 2500, before.id)).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.result.routeTo(target)).toEqual(expected);
  expect(city.agents[0]).toMatchObject({ id: before.id, response: role, position: before.position,
    current: before.current, next: before.next });
  expect(calls[0]!.work).toBeLessThan(full.work / 2);
  city.clearResponses(); calls.length = 0;
  const other = full.result.cells.find(cell => key(cell) !== key(target) && !network.zoneByCell.has(key(cell))
    && full.result.routeTo(cell).length >= 2)!;
  expect(city.dispatchResponse(role, [other, target], 2500, before.id)).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.work).toBe(full.work);
  for (const cell of [other, target]) expect(calls[0]!.result.routeTo(cell)).toEqual(full.result.routeTo(cell));
});

it('сохраняет точные конечные маршруты 28/64 с направлениями и перекрытиями', () => {
  const network = buildMobilityNetwork({ roads: new Map(realCity.roads.map(cell => [key(cell), cell as RoadCellDto])),
    walkGraph: new Map(realCity.walkGraph.map(cell => [key(cell), cell])), crosswalks: new Set(realCity.crosswalks),
    activityCells: new Set(realCity.activityCells) });
  const plan = routing.createMobilityRouteSearch(network.cars, network.carEdges), cells = [...network.cars.values()];
  for (const blocked of [new Set<string>(), new Set([key(cells[10]!), key(cells[100]!)])]) {
    plan.setBlocked(blocked);
    for (const start of [cells[0]!, cells[Math.floor(cells.length / 2)]!])
      for (const previous of [undefined, { x: start.x - 1, y: start.y }, { x: start.x, y: start.y + 1 }])
        for (const limit of [28, 64]) {
          const full = plan(start, previous, undefined, limit);
          const targets = [full.cells[1] ?? start, full.cells.at(-1) ?? start, cells[10]!, { x: 9999, y: 9999 }];
          for (const target of targets) expect(plan(start, previous, target, limit).routeTo(target)).toEqual(full.routeTo(target));
        }
  }
});
