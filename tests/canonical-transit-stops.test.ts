import { expect, it } from 'vitest';
import * as transit from '../src/shared/city-transit-stops';
import type { CardinalOrientation } from '../src/shared/contracts';
import { prepareCooperatively } from '../src/shared/cooperative-preparation';
it('gives a permanent stop a real paved turnaround behind its shelter without a branch at its waiting cells', () => {
  const stop = transit.canonicalTransitStop('b',{x:10,y:20},'E');
  const paving = transit.canonicalTransitStopPublicWalkway(stop), ids = new Set(paving.map(p=>`${p.x},${p.y}`));
  expect(paving).toHaveLength(26);expect(ids.size).toBe(26);
  for (const p of paving) expect([[0,-1],[1,0],[0,1],[-1,0]].filter(([x,y])=>ids.has(`${p.x+x!},${p.y+y!}`))).toHaveLength(2);
  for (const p of stop.shelter) expect(ids.has(`${p.x},${p.y}`)).toBe(false);
  expect(transit.cityTransitStopReservations({schemaVersion:1,layoutId:'l',processedBlockIds:['b'],stops:[stop]}))
    .toEqual([{minX:2,minY:21,maxX:12,maxY:24}]);
});

it.each([
  ['E', [[10,22],[11,22],[10,23],[11,23]], [[10,21],[11,21],[9,21]], [3,21], [9,21]],
  ['W', [[10,18],[9,18],[10,17],[9,17]], [[10,19],[9,19],[11,19]], [17,19], [11,19]],
  ['N', [[12,20],[12,19],[13,20],[13,19]], [[11,20],[11,19],[11,21]], [11,27], [11,21]],
  ['S', [[8,20],[8,21],[7,20],[7,21]], [[9,20],[9,21],[9,19]], [9,13], [9,19]],
] as const)('keeps the authored right-curb geometry and continuous approach for heading%s', (heading, shelter, queue, first, last) => {
  const lane = { x: 10, y: 20, mask: 15 }, stop = transit.canonicalTransitStop('block-A', lane, heading);
  const points = (values: readonly (readonly number[])[]) => values.map(([x,y]) => ({ x, y }));
  expect(stop).toMatchObject({ id: 'stop:10,20', blockId: 'block-A', lane: { x: 10, y: 20 }, heading });
  expect(Object.keys(stop.lane).sort()).toEqual(['x','y']);
  expect(stop.shelter).toEqual(points(shelter));expect(stop.queue).toEqual(points(queue));
  expect(stop.accessPath).toHaveLength(7);expect(stop.accessPath[0]).toEqual(points([first])[0]);expect(stop.accessPath.at(-1)).toEqual(points([last])[0]);
  for (let i = 1; i < stop.accessPath.length; i++) {
    const a = stop.accessPath[i-1]!, b = stop.accessPath[i]!;expect(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)).toBe(1);
  }
  expect(lane).toEqual({ x: 10, y: 20, mask: 15 });expect(stop.lane).not.toBe(lane);
  for (const value of [stop, stop.lane, stop.shelter, stop.queue, stop.accessPath, ...stop.shelter, ...stop.queue, ...stop.accessPath]) expect(Object.isFrozen(value)).toBe(true);
});
it.each([
  ['', { x: 1, y: 2 }, 'E'], ['block', { x: NaN, y: 2 }, 'E'], ['block', { x: 1.5, y: 2 }, 'S'],
  ['block', { x: 1, y: Infinity }, 'N'], ['block', { x: Number.MAX_SAFE_INTEGER, y: 0 }, 'N'], ['block', { x: 0, y: 0 }, 'NE'],
])('rejects invalid stop identity, coordinates or direction', (id, lane, heading) => {
  expect(() => transit.canonicalTransitStop(id as string, lane as { x: number; y: number }, heading as CardinalOrientation)).toThrow(RangeError);
});

it('appends only new block candidates and keeps every published stop through reordered or changed task metadata', () => {
  const a = transit.canonicalTransitStop('A', { x: 0, y: 0 }, 'E'), b = transit.canonicalTransitStop('B', { x: 80, y: 80 }, 'N');
  const first = transit.extendCityTransitStopPlan({ layoutId: 'layout', blocks: [{ id: 'A', sequence: 0 }], candidates: () => [a] });
  const before = structuredClone(first), called: string[] = [];
  const changedBlocks = [{ id: 'B', sequence: 1 }, { id: 'A', sequence: 0, status: 'COMPLETED' }];
  const next = transit.extendCityTransitStopPlan({ layoutId: 'layout', previous: first,
    blocks: changedBlocks,
    candidates: block => { called.push(block.id);return [b]; } });
  expect(called).toEqual(['B']);expect(next.stops).toEqual([a,b]);expect(next.processedBlockIds).toEqual(['A','B']);expect(first).toEqual(before);
  const unchanged = transit.extendCityTransitStopPlan({ layoutId: 'layout', previous: next,
    blocks: [{ id: 'A', sequence: 0 }, { id: 'B', sequence: 1 }], candidates: () => { throw new Error('Old blocks must not replan'); } });
  expect(unchanged).toEqual(next);
});
it('keeps stop admission deterministic and records an empty block without moving an older nearby stop', () => {
  const candidates = (block: { id: string }) => [transit.canonicalTransitStop(block.id, { x: block.id === 'A' ? -1 : 1, y: 0 }, 'E')];
  const blocks = [{ id: 'B', sequence: 1 }, { id: 'A', sequence: 0 }];
  const plan = transit.extendCityTransitStopPlan({ layoutId: 'layout', blocks, candidates });
  expect(plan.stops.map(stop => stop.blockId)).toEqual(['A']);expect(plan.processedBlockIds).toEqual(['A','B']);
  expect(transit.extendCityTransitStopPlan({ layoutId: 'layout', blocks: [...blocks].reverse(), candidates })).toEqual(plan);
});
it('round-trips the stored plan into independent immutable geometry and rejects corrupt or foreign rows', () => {
  const stop = transit.canonicalTransitStop('A', { x: 10, y: 20 }, 'E');
  const stored = { schemaVersion: 1, layoutId: 'layout', processedBlockIds: ['A'], stops: [stop] };
  const raw = JSON.parse(JSON.stringify(stored)), read = transit.readCityTransitStopPlan(raw, 'layout');
  expect(read).toEqual(stored);expect(read).not.toBe(raw);expect(Object.isFrozen(read)).toBe(true);expect(Object.isFrozen(read.stops)).toBe(true);
  raw.stops[0].queue[0].x = 500;expect(read.stops[0]!.queue).toEqual(stop.queue);
  for (const invalid of [
    { ...stored, schemaVersion: 2 }, { ...stored, layoutId: 'another' }, { ...stored, processedBlockIds: [] },
    { ...stored, processedBlockIds: ['A','A'] }, { ...stored, stops: [stop,stop] },
    { ...stored, stops: [{ ...stop, id: 'invented' }] }, { ...stored, stops: [{ ...stop, queue: [] }] },
    { ...stored, stops: [{ ...stop, accessPath: [...stop.accessPath].reverse() }] },
  ]) expect(() => transit.readCityTransitStopPlan(invalid, 'layout')).toThrow(RangeError);
});
it('protects the physical stop and its approach separately from its directed road corridor', () => {
  const plan = { schemaVersion: 1 as const, layoutId: 'layout', processedBlockIds: ['A'], stops: [transit.canonicalTransitStop('A', { x: 10, y: 20 }, 'E')] };
  expect(transit.cityTransitStopReservations(plan, 'PARCEL')).toEqual([{ minX: 2, minY: 21, maxX: 12, maxY: 24 }]);
  expect(transit.cityTransitStopReservations(plan, 'ROAD')).toEqual([{ minX: 2, minY: 17, maxX: 18, maxY: 24 }]);
});
it('rejects sparse stored block identities instead of admitting undefined ownership', () => {
  expect(() => transit.readCityTransitStopPlan({ schemaVersion: 1, layoutId: 'layout', processedBlockIds: Array(1), stops: [] }, 'layout')).toThrow(RangeError);
});
it('bounds density locally while new regions keep receiving stops', () => {
  const positions = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 32, y: 0 }, { x: 48, y: 0 }, { x: 0, y: 32 }, { x: 64, y: 64 }];
  const blocks = positions.map((_,i) => ({ id: `block-${i}`, sequence: i }));
  const plan = transit.extendCityTransitStopPlan({ layoutId: 'layout', blocks,
    candidates: block => [transit.canonicalTransitStop(block.id, positions[block.sequence]!, 'E')] });
  expect(plan.stops.map(stop => stop.blockId)).toEqual(['block-0','block-1','block-2','block-3','block-5']);
  expect(plan.processedBlockIds).toHaveLength(6);
  expect(transit.readCityTransitStopPlan(JSON.parse(JSON.stringify(plan)), 'layout')).toEqual(plan);
});
it('cancels cooperative planning before candidates run and never publishes a partial plan', async () => {
  let calls = 0, published = false, ticks = 0;const controller = new AbortController();
  const steps = transit.cityTransitStopPlanSteps({ layoutId: 'layout', blocks: Array.from({ length: 100 }, (_,i) => ({ id: `b-${i}`, sequence: i })),
    candidates: () => { calls++;return []; } });
  const preparation = prepareCooperatively(steps, { signal: controller.signal, budgetMs: 1, now: () => ticks++, yieldTask: async () => { controller.abort(); } })
    .then(() => { published = true; });
  await expect(preparation).rejects.toMatchObject({ name: 'AbortError' });expect(calls).toBe(0);expect(published).toBe(false);
});
it('recognizes fully served positive and negative regions with a bounded capacity query', () => {
  const admission = new transit.CityTransitStopAdmission();
  const area = { minX: 0, minY: 0, maxX: 63, maxY: 63 };
  expect(admission.hasCapacityIn(area)).toBe(true);
  for (let i = 0; i < 4; i++) admission.add(transit.canonicalTransitStop(`A-${i}`, { x: i*16, y: 0 }, 'E'));
  expect(admission.hasCapacityIn(area)).toBe(false);expect(admission.hasCapacityIn({ ...area, maxX: 64 })).toBe(true);
  for (let i = 0; i < 4; i++) admission.add(transit.canonicalTransitStop(`N-${i}`, { x: -64+i*16, y: -64 }, 'E'));
  expect(admission.hasCapacityIn({ minX: -64, minY: -64, maxX: -1, maxY: -1 })).toBe(false);
  expect(() => admission.hasCapacityIn({ ...area, maxX: 1000000 })).toThrow(RangeError);
});
it('protects the curb neighbours outside the route so furniture cannot turn a queue endpoint into a blind spur', () => {
  const stop = transit.canonicalTransitStop('A', { x: 10, y: 20 }, 'E');
  const walkway = transit.canonicalTransitStopWalkway(stop);
  expect(walkway).toEqual(Array.from({ length: 11 }, (_,i) => ({ x: 2+i, y: 21 })));
  expect(stop.accessPath).toHaveLength(7);expect(Object.isFrozen(walkway)).toBe(true);
  const bounds = transit.cityTransitStopReservations({ schemaVersion: 1, layoutId: 'layout', processedBlockIds: ['A'], stops: [stop] })[0]!;
  for (const p of walkway) expect(p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY).toBe(true);
});
