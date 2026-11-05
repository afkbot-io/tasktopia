import { expect, it } from 'vitest';
import { createMobilityRouteSearch } from '../src/client/mobility-route-search';
import { buildMobilityNetwork } from '../src/client/city-mobility-network';
import type { Cell, RoadCellDto } from '../src/shared/contracts';
import realCity from './fixtures/city-mobility-real-city.json';

const key = (cell: Cell) => `${cell.x},${cell.y}`;
it('exposes only compiled valid edges in graph order and distinguishes an empty row from an absent row', () => {
  const start = { x: 0, y: 0 }, east = { x: 1, y: 0 }, far = { x: 100, y: 0 }, absent = { x: 2, y: 0 };
  const graph = new Map([start, east, far, absent].map(cell => [key(cell), cell]));
  const edges = new Map([['100,0', []], ['0,0', [far, east, { x: 9, y: 9 }]]]);
  const search = createMobilityRouteSearch(graph, edges), view = search.adjacency;
  expect([...view]).toEqual([['0,0', [far, east]], ['100,0', []]]);
  expect(view.size).toBe(2);expect(view.has('100,0')).toBe(true);expect(view.get('100,0')).toEqual([]);
  expect(view.has('2,0')).toBe(false);expect(view.get('2,0')).toBeUndefined();expect(view.get('missing')).toBeUndefined();
  expect([...view.keys()]).toEqual(['0,0', '100,0']);expect([...view.values()]).toEqual([[far, east], []]);
  const receiver = { seen: [] as string[] };
  view.forEach(function(this: typeof receiver, value, id, map) { expect(map).toBe(view);expect(value).toEqual(view.get(id));this.seen.push(id); }, receiver);
  expect(receiver.seen).toEqual(['0,0', '100,0']);expect('set' in view).toBe(false);expect('delete' in view).toBe(false);
});
it('keeps snapshot coordinates and independent adjacency reads after input and returned values change', () => {
  const start = { x: 0, y: 0 }, east = { x: 1, y: 0, name: 'authored metadata' };
  const graph = new Map([['0,0', start], ['1,0', east]]), edges = new Map([['0,0', [east]], ['1,0', []]]);
  const search = createMobilityRouteSearch(graph, edges), before = search(start, undefined, { x: 1, y: 0 }, 2);
  const value = search.adjacency.get('0,0')!;expect(value).toEqual([{ x: 1, y: 0 }]);
  value[0]!.x = 500;value.length = 0;east.x = 99;edges.clear();graph.clear();
  expect(search.adjacency.get('0,0')).toEqual([{ x: 1, y: 0 }]);
  expect(before.routeTo({ x: 1, y: 0 })).toEqual([start, { x: 1, y: 0 }]);
  search.setBlocked(new Set(['1,0']));
  expect(search(start, undefined, { x: 1, y: 0 }, 2).routeTo({ x: 1, y: 0 })).toEqual([]);
  expect(search.adjacency.get('0,0')).toEqual([{ x: 1, y: 0 }]);
  expect(search.planning(start, undefined, { x: 1, y: 0 }, 2).routeTo({ x: 1, y: 0 })).toEqual([start, { x: 1, y: 0 }]);
});
it('preserves wide authored fan-out, nonlocal and duplicate edges without borrowing the source rows', () => {
  const start = { x: 0, y: 0 }, targets = [{ x: 0, y: -10 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 10, y: 0 }];
  const authored = [...targets, targets[1]!], graph = new Map([start, ...targets].map(cell => [key(cell), cell]));
  const search = createMobilityRouteSearch(graph, new Map([[key(start), [...authored, { x: 500, y: 500 }]]]));
  expect(search.adjacency.get(key(start))).toEqual(authored);
  expect(search(start, undefined, targets[0], 2).routeTo(targets[0]!)).toEqual([start, targets[0]]);
});
it('matches every native car and walking adjacency row including authored order', () => {
  const network = buildMobilityNetwork({ roads: new Map(realCity.roads.map(cell => [key(cell), cell as RoadCellDto])),
    walkGraph: new Map(realCity.walkGraph.map(cell => [key(cell), cell])),crosswalks: new Set(realCity.crosswalks), activityCells: new Set(realCity.activityCells) });
  for (const [graph, edges] of [[network.cars, network.carEdges], [network.walkers, network.walkerEdges]] as const)
    expect([...createMobilityRouteSearch(graph, edges).adjacency]).toEqual([...edges]);
});
