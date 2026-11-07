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
it.each([NaN,Infinity,-Infinity,2**40,.125])('preserves custom source keys and snapshot endpoints for x=%s',x=>{
  const start={x:1,y:2},target={x,y:0},targetKey=key(target);
  const graph=new Map([['start-alias',start],['target-alias',target]]),edges=new Map([[key(start),[target]],[targetKey,[]]]);
  const search=createMobilityRouteSearch(graph,edges);
  expect([...search.adjacency.keys()]).toEqual([key(start),targetKey]);
  expect(search.adjacency.has(targetKey)).toBe(true);
  expect(search.adjacency.get(key(start))).toEqual([{x:x||0,y:0}]);
  expect(search(start,undefined,target,2).routeTo(target)).toEqual([start,{x:x||0,y:0}]);
  search.setBlocked(new Set([targetKey]));
  expect(search(start,undefined,target,2).routeTo(target)).toEqual([]);
});
it('distinguishes canonical keys, opposite int32 extremes and duplicate source coordinates',()=>{
  const first={x:-2147483648,y:2147483647},second={x:2147483647,y:-2147483648};
  const search=createMobilityRouteSearch(new Map([['a',first],['b',second]]),new Map([[key(first),[second]],[key(second),[]]]));
  expect([...search.adjacency.keys()]).toEqual([key(first),key(second)]);
  for(const id of ['-02147483648,2147483647',' 2147483647,-2147483648','2147483647,-2147483648.0','2147483647,','2147483647,-2147483648,'])
    expect(search.adjacency.has(id)).toBe(false);
  expect(search(first,undefined,second,2).routeTo(second)).toEqual([first,second]);
  const a={x:0,y:0,name:'first'},b={x:1,y:0},duplicate={x:0,y:0,name:'last'};
  const duplicates=createMobilityRouteSearch(new Map([['a',a],['b',b],['c',duplicate]]),new Map([[key(a),[b]],[key(b),[a]]]));
  expect([...duplicates.adjacency.keys()]).toEqual(['0,0','1,0']);
  expect(duplicates(a,undefined,b,2).cells).toEqual([duplicate,b]);
  expect(duplicates(a,undefined,b,2).cells[0]).toBe(duplicate);
});
it('preserves all rows on a frozen adversarial collision chain without inventing a route',()=>{
  // Captured coordinates sharing one bucket in the typed128/256-slot index.
  // Expectations use only the authored directed chain, never the hash code.
  const xs=[0,237,565,1454,1466,1811,2411,2816,3111,3313,3639,3921,5062,5298,5368,5520,5522,5585,5614,5718,5854,6767,7392,7598,7677,7687,7704,8080,8365,8412,8557,8566,9496,10008,10279,10642,10909,10941,11062,11668,11748,11889,12233,12477,12558,13447,14029,14234,15408,15569,15718,15864,16001,17209,17665,17930,18013,18039,18242,19057,19669,19852,20321,20399,20683];
  const cells=xs.map(x=>({x,y:0})),graph=new Map(cells.map(c=>[key(c),c]));
  const edges=new Map(cells.map((c,i)=>[key(c),cells[i+1]?[cells[i+1]!]:[]]));
  const search=createMobilityRouteSearch(graph,edges);
  expect([...search.adjacency]).toEqual([...edges]);
  expect(search(cells[0]!,undefined,cells.at(-1),65).routeTo(cells.at(-1)!)).toEqual(cells);
  expect(search(cells.at(-1)!).routeTo(cells[0]!)).toEqual([]);
});
